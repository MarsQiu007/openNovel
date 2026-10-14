# Proposal

## Why

CI `test` workflow 的 `Run HttpApi exerciser gates`（仅 Linux，`bun run test:httpapi`）在 effect 模式间歇失败，门禁信号不可信：

- run `38433874493`（job `115422731216`，sha `b8dadd3e6`）effect 模式 `pass=257 fail=77`；两次失败尝试得到**完全一致的 77 个失败集**，后续重跑转绿 → 竞态而非确定性缺陷，且失败面广（散点 500/建库错），难以排查。
- 该门禁是每次 push 的必过检查，间歇红会持续误伤所有提案收尾（本仓库默认流程的最后一步就是"Actions 全绿"）。

根因（已被 WSL 现场证据与最小实验固化）：exercise 用「删除共享 SQLite 文件」来重置状态，但进程内并存多个**可跨场景存活、且重置不协调**的数据库连接持有者：

- core 层连接：按场景 scope/memoMap 构建；现有重置在场景 scope 内执行，rm 时连接仍存活；
- novel-store 按路径缓存的连接（`_dbCache`）：重置从不调用 `closeDb`/`closeDbPath`；
- novel-store 后台同步 worker：每 5s 轮询 `getDb`，可在「rm 之后、core 迁移之前」率先重建文件；
- 模块级 AppRuntime（`ManagedRuntime` 单例）：首次构建后永久持有 core 连接（执行期确认：`disposeAllInstances()` 触达即建连，此后文件在 Windows 上无法删除，这是删除式重置无法在 Windows 收尾的直接原因）。

由此产生两类观测失效：

1. **novel-store 先建库 → core 迁移守卫 die**：novel-store 的库形态不含 core 的 `session` 表；红态首错即 `lsp.status` 的 `Database is not empty and has no session table`（core `migration.ts` 有意守卫）。已用最小实验确定性复现（NS 先建库 → core 打开即 die）。
2. **查询命中非当前代的旧 schema**：76 个 novel/technique 场景以「`chapters` 缺 `outline`、`characters` 缺 `status`、无 `tension_log`/`annotations`/`world_maps`」等散点错误失败（`createChapter`/`createCharacter` 等 prepare 期错误；技法接口同期出现 500、疑同为书本库源代际问题，未取得内部栈）。WSL 现场抓到进程持有**已删除 inode**的 fd：一份 35 表 core 骨架（与红态错误同型）、一份 68 表完整形态；把 35 表文件喂给 novel-store `getDb()` 会立即补全为 68 表 → 证明 red 状态是「代际错位 + 建库链未在该代运行」，而非迁移逻辑损坏。
3. **锁竞争放大**：novel-store 的 bun 驱动 `busy_timeout=0`（core 侧为 5000），跨连接 DDL 竞争时立即抛「database is locked」；`sqlite.exec` 多语句逐条提交、遇错中止，会留下非事务半成品文件（已实验证实：中途报错时前序语句已提交、后续未执行）。

## What Changes

- **exercise 重置确定性（测试基建）**：
  - 重置前静默所有可影响共享库的后台路径：停止同步 worker、驱逐 novel-store 对 exercise 库的连接缓存、dispose apps/instances；随后原地清空共享库全部表（不删文件——模块级 AppRuntime 首次构建后会永久持有连接，删除在 Windows 上必然 EBUSY，且删除导致的跨代 inode 正是原始抖动根因；清空后由 core 守卫走全量重建）。
  - 清空后**确定性重建**：先用全新 memoMap 构建 core 连接并跑迁移（保证 core schema 先行），再让 novel-store 打开同一文件完成剩余表/补列并缓存；最后做 schema 冒烟断言（表 `session`、`tension_log`、`annotations`、`annotation_rounds`、`world_maps` + 列 `chapters.outline`、`characters.status`、`volumes.outline`），不满足时以清晰错误终止而非散点失败；守卫语义保持不变。
  - 场景重置时机移到场景 scope 关闭之后（当前在 scope 内执行，清空时场景连接仍存活）；warm 失败且错误为守卫语义时重试一次（覆盖已停止 worker 的在途轮询尾巴），仍失败即红且信息明确。
- **novel-store 驱动对齐（生产代码，防御性）**：bun / node 两个 SQLite 驱动补 `PRAGMA busy_timeout = 5000`（与 core 一致），消除共享库跨连接 DDL 竞争时的瞬时失败与半成品建库。
- **回归测试**：opennovel 新增重置管线测试（重置后 schema 完整、陈旧连接被驱逐、同步 worker 停止、core 先行不再触发守卫）；novel-store 新增驱动断言测试（`busy_timeout` 生效）。
- **验证**：Linux（WSL）按 CI 同命令复跑 `test:httpapi` 三连全绿；推送后 CI `test` workflow 全绿。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。本变更为测试基建与缺陷对齐：exercise 重置流程重写 + 驱动级参数对齐，不改变 spec 级产品行为；`.openspec.yaml` 设置 `skip_specs: true`，先例 `2026-10-10-test-suite-hygiene`、`2026-09-10-fix-opennovel-ci-tests`。）

## 非目标

- 不放宽 core「库非空且无 session 表即 die」迁移守卫（保持既有权衡，仅保证重建顺序确定性）。
- 不修改 novel-store `getDb` 的路径优先级（env > directory > cwd）、缓存键与 `fresh` 语义；不改 `_dbCache` 的单连接模型。
- 不修改同步 worker 的业务行为（仅重置时停止轮询；场景请求经 workspace-routing 会重新登记目录并重启 worker）。
- 不改公开 Protocol / Server HttpApi → 无需重新生成 SDK。
- 不治理 `novel-reader` eager `fresh: true` 连接未跟踪/未关闭的历史问题（另开提案）。
- 不重构 exercise 场景集、不断言逐个场景；只保证重置阶段确定性与快速失败。

## Impact

- **packages/opennovel**（测试基建为主）：`test/server/httpapi-exercise/runner.ts`（重置时机与编排）、`runtime.ts`（清理不再使用的导出）、新增 reset 模块与回归测试；复用既有 `src/novel/manual-edit-sync-worker` 的 `stopSyncWorker` 入口。
- **packages/novel-store**：`src/driver.bun.ts`、`src/driver.node.ts` 补 `busy_timeout`；`test/` 新增驱动断言。
- 数据兼容：不改建库结构、不新增迁移；`busy_timeout` 仅连接级行为，对现有本地库文件零影响。
- CI：Linux `HttpApi exerciser gates` 由间歇红转为稳定绿；unit 测试新增两个小测试文件的执行开销（秒级）。