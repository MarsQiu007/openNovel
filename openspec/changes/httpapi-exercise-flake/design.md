# Design

## Context

动机与证据见 `proposal.md · Why`。本设计聚焦"如何"：

现状重置流程（`packages/opennovel/test/server/httpapi-exercise/runner.ts`）：

- `withContext` 的 `Effect.ensuring(scenario.reset ? resetState : ...)` 在**场景 scope 内**执行；
- `resetState` = 恢复 auth flags → `disposeApps()` → `disposeAllInstances()` → `resetDatabase()`（rm `Database.path()` 及 `-wal`/`-shm`）→ `Bun.sleep(25)`；
- 不关闭 novel-store 连接缓存、不停止同步 worker、rm 后无可验证的确定性重建。

连接持有者盘点（决定了必须静默谁）：

| 持有者 | 生命周期 | 重置时的现状 |
| --- | --- | --- |
| core `Database` 层 | 按场景 `Layer.buildWithMemoMap(modules.AppLayer, modules.memoMap, scope)` | rm 时仍在 scope 内，未释放 |
| novel-store `_dbCache` | 进程级按路径缓存，跨场景存活 | 从不 close |
| novel-store 同步 worker | 每 5s 轮询已登记目录（`registerSyncDirectory` 由 workspace-routing 中间件触发） | 可在 rm 与 core 迁移之间率先重建文件 |
| 模块级 AppRuntime（`ManagedRuntime` 单例） | 进程级，首次构建后永久持有 core 连接 | 删除方案下 Windows 必然 EBUSY；原地清空方案下与其余连接同代可见 |
| novel-reader `fresh: true` 连接 | 单请求、未缓存也未关闭（既有问题，非目标） | 不参与重置正确性 |

约束：core「库非空且无 session 表即 die」守卫**保持**；`packages/opennovel/test/fixture/db.ts` 的 `resetDatabase()` 被 87 处测试调用，语义不得变；风格遵循 AGENTS.md（少 try/catch、无 any、Bun API 优先、不为单次使用提取 helper）。

## Goals / Non-Goals

Goals：

- 重置后共享库处于**确定状态**：core 迁移已先行、novel-store 建库/补列已完成；
- 重置不依赖时序运气：对可识别的残余竞态有一次有界重试，其余错误立即暴露；
- 未来同类问题**快速失败**：schema 不完整时给出单一、可读的错误，而不是数十个散点失败。

Non-Goals（设计层）：

- 不重构 novel-store 连接模型（单连接缓存、env 优先级、`fresh` 语义保持）；
- 不改场景 DSL 与断言集；
- 不为 `fixture/db.ts` 增加新语义（exercise 专属逻辑走新模块）。

## Decisions

### D1. 新增 exercise 专属 reset 模块，而不是改 `fixture/db.ts`

`packages/opennovel/test/server/httpapi-exercise/reset.ts` 导出 `resetExerciseDatabase()` 与 `assertExerciseSchemaReady()`，内部动态 import（沿用 `environment.ts`/`runtime.ts` 的 env 隔离模式）。`fixture/db.ts` 保持原语义。

备选：直接给 `resetDatabase()` 加 close/warm —— 被否：87 处调用方共享语义，爆炸半径大；且 warm/assert 是 exercise 专属需求。

### D2. 重置顺序：静默 → 原地清空 → 确定性重建 → 冒烟断言

1. `stopSyncWorker()`：先停轮询，防止新周期在清空后抢先建库；`directories` 会被清空，在途一轮最多残留一次 `processSyncQueue` 调用（由 D4 重试覆盖）；
2. `disposeApps()`：关闭请求处理器；
3. `closeDb(null)`：驱逐 exercise 库的 novel-store 缓存连接（`OPENNOVEL_DB` 已由 `environment.ts` 指向 exercise 库，`null` 即该路径）；
4. 用裸 `bun:sqlite` 连接**原地清空**共享库：`foreign_keys=OFF` 后 DROP 全部非 `sqlite_%` 表/视图，再做 `wal_checkpoint(TRUNCATE)`；**不删文件**——模块级 AppRuntime 首次构建后永久持有连接，删除在 Windows 上必然 EBUSY，且删除造成的跨代 inode 正是原始抖动根因；清空后库为空（`tables.length === 0`），core 守卫放行全量重建，语义等价于新库；
5. `disposeAllInstances()`：关闭实例。经模块级 AppRuntime 触达 core 层，首次构建会打开库文件并跑迁移，**必须发生在清空之后**——确保在空库上全量重建，而不是撞上 NS 先建库的坏形态（否则守卫 die）；
6. `warmExerciseDatabase()`（见 D3）；
7. `assertExerciseSchemaReady()`（见 D5）。

不关闭全局技法库连接：它从不参与重置、也不会被删除；技法接口的红态失败疑为书本库（exercise 库）代际错位，静默共享库即可覆盖。

### D3. warm：core 先行（全新 memoMap），再由 novel-store 补齐并缓存

- core：`Effect.scoped(Layer.build(Database.layerFromPath(Database.path())))` 构建一次并立即关闭 scope（`Layer.build` 自带全新 memoMap）。**必须用全新 memoMap**：memoMap 在旧 scope 未关时会复用旧连接、跳过重建迁移（已实验证实）；全新 memoMap 保证在当次清空后的库上重跑迁移；
- novel-store：`getDb(null)` 打开同一文件，`createDb` 会完成剩余建表与补列（实验证实 35 表 core 形态 → 68 表完整形态可自愈）并写入 `_dbCache`，后续场景直接复用。

备选：依赖下一场景 `AppLayer` 构建来 warm —— 被否：重建顺序不受重置流程控制，正是竞态来源；显式 warm 把"core 先行"编码进重置本身。

### D4. 重置时机移到场景 scope 关闭之后；warm 守卫错误单次重试

- `runScenario` 中把 `Effect.scoped` 前置于重置执行（经 `Effect.flatMap` 串联在场景结果之后），使清空发生时场景自身连接已全部释放（在途 worker 尾巴除外）。
- 重建若以 `Database is not empty and has no session table` 失败（在途 worker 于清空后先建了库），先 `closeDb(null)` 驱逐残留连接，再完整重试一次重建（重新清空 → disposeAllInstances → warm → canary）；其余错误直接抛出。

备选：等待若干毫秒"让在途轮询落地" —— 被否：定时器式等待不可靠且不可证；有界重试以可验证结果为准。

### D5. schema 冒烟断言（canary）

`assertExerciseSchemaReady()` 通过 `getDb(null)` 检查：表 `session`、`tension_log`、`annotations`、`annotation_rounds`、`world_maps` 存在；`chapters` 有 `outline`、`characters` 有 `status`、`volumes` 有 `outline`。缺失集合一次性聚合抛错（`exercise database schema incomplete: ...`）。这些断言覆盖红态全部错误签名，且成本为毫秒级。

### D6. novel-store 驱动补 `PRAGMA busy_timeout = 5000`（bun 与 node 双驱动）

与 core 侧一致；消除跨连接 DDL 竞争下的瞬时「database is locked」与非事务半成品（`sqlite.exec` 逐条提交、遇错中止）。备选：在 `getDb` 层面重试建库 —— 被否：掩盖错误、更复杂，且锁等待正是 busy_timeout 的标准解法。

### D7. 回归测试落点

- `packages/opennovel/test/server/httpapi-exercise-reset.test.ts`（test preload 默认把 `OPENNOVEL_DB` 钉为 `:memory:`，该文件需把 `OPENNOVEL_DB` 与 `Flag.OPENNOVEL_DB` 均指向临时库文件并在 afterAll 恢复，否则 canary 的 `session` 检查在内存库形态下无意义）：
  1) 登记同步 worker + 建立 novel-store 连接 + 写入一条 novel；
  2) `resetExerciseDatabase()`；
  3) 断言 worker 已停止、canary 通过（含 `session`，即 core 先行未触发守卫）；
  4) 再次 `getDb(null)` 看到**已清空重建**的库（novel 计数为 0）——证明缓存连接被驱逐、重建结果对后续查询可见。
  环境隔离：按 test-suite-hygiene 先例保存/恢复 `OPENNOVEL_DB` 与 `Flag.OPENNOVEL_DB`。
- `packages/novel-store/test/driver-busy-timeout.test.ts`：临时目录 `getDb()` 后 `PRAGMA busy_timeout` 返回 5000；`afterEach` 关闭连接并清理目录。

### D8. runner.ts 收敛

`resetState` 变薄：恢复 auth flags + `await resetExerciseDatabase()`（原 `disposeApps`/`disposeAllInstances`/`resetDatabase` 移入模块内部执行；固定 `sleep(25)` 由确定性重建 + 断言取代、不再保留；`runtime.ts` 中不再被使用的导出相应清理）。

## Risks / Trade-offs

- [warm 会预先建全 schema，场景可见的初始状态与"懒建库"略有不同] → 无数据写入、表结构一致；场景只依赖空数据，不受影响。
- [stopSyncWorker 影响 worker 生命周期] → 场景请求经 workspace-routing 会重新登记并重启；既有两个测试已验证 stop/register 幂等。
- [重试可能掩盖真实回归] → 仅限守卫语义的单次重试，且 canary 与后续场景仍会暴露问题。
- [busy_timeout 使加锁路径改为等待] → 上限 5s 与 core 一致；桌面端共享库场景由"立即失败"变为"短暂等待"，更符合预期。
- [原地清空保留同一文件、文件不缩容] → 所有连接不再跨代（消除原始抖动根因），代价仅是测试库文件体积不回收，可接受；Windows 本地不再依赖句柄释放。

## Migration Plan

- 无数据迁移；纯代码变更。回滚 = revert 对应提交。
- 部署顺序：先驱动级 busy_timeout（novel-store），后 exercise 重置改造（opennovel），同分支内两个 commit；随后按仓库流程归档、ff 合并 main、推送、确认 CI 全绿。

## Open Questions

（无。`novel-reader` fresh 连接治理已列为非目标，留待后续提案。）