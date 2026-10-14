# Tasks

## 1. novel-store 驱动 busy_timeout 对齐

- [x] 1.1 `src/driver.bun.ts` 与 `src/driver.node.ts` 在 `foreign_keys` 之后补 `PRAGMA busy_timeout = 5000`（与 core 侧一致），注释说明共享库跨连接 DDL 竞争语义；`cd packages/novel-store && bun typecheck` 通过
- [x] 1.2 新增 `test/driver-busy-timeout.test.ts`：临时目录 `getDb()` 后读回 `PRAGMA busy_timeout` 为 5000，`afterEach` 关闭连接并清理目录；`cd packages/novel-store && bun test test/driver-busy-timeout.test.ts` 通过

## 2. exercise 重置管线重写

- [x] 2.1 新增 `test/server/httpapi-exercise/reset.ts`（动态 import 的 env 隔离模式）：实现 `resetExerciseDatabase()`（stopSyncWorker → disposeApps → closeDb(null) → 原地清空全部表（DROP 非 `sqlite_%` 对象 + wal_checkpoint(TRUNCATE)，不删文件）→ disposeAllInstances → warm → canary，守卫语义错误单次重试）与 `assertExerciseSchemaReady()`（表 `session`、`tension_log`、`annotations`、`annotation_rounds`、`world_maps` + 列 `chapters.outline`、`characters.status`、`volumes.outline` 缺失时聚合抛错）；`cd packages/opennovel && bun typecheck` 通过
- [x] 2.2 `runner.ts`：`resetState` 收敛为「恢复 auth flags + 调用 `resetExerciseDatabase()`」；`Effect.scoped` 前置于重置执行（经 `Effect.flatMap` 串联在场景结果之后）使重置发生在场景 scope 关闭之后；清理 `runtime.ts` 中不再使用的导出（以 grep 为准）；`bun typecheck` 通过
- [x] 2.3 小窗口实测重置路径：用 `--start-at`/`--stop-at`（按场景名匹配）限定覆盖含 reset 的相邻场景区间运行 effect 模式，确认重置不触发 canary 或守卫错误；`cd packages/opennovel && bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip --start-at <起点场景名> --stop-at <终点场景名>` 输出 fail=0 且无 reset 相关报错

## 3. 回归测试

- [x] 3.1 新增 `test/server/httpapi-exercise-reset.test.ts`：将 `OPENNOVEL_DB` 与 `Flag.OPENNOVEL_DB` 指向临时库文件（test preload 默认钉为 `:memory:`，需按先例保存原值并在 afterAll 恢复）→ 登记同步 worker + 建立 novel-store 连接并写入一条 novel → `resetExerciseDatabase()` → 断言 worker 已停止、canary 通过（含 `session`）、再次 `getDb(null)` 看到已清空重建的空库（novel 计数 0）；`cd packages/opennovel && bun test test/server/httpapi-exercise-reset.test.ts` 通过
- [x] 3.2 同文件补 `assertExerciseSchemaReady()` 失败路径：先原地清空并构造 novel-store 先行建库（无 `session`）后断言抛出且错误信息含缺失项 `session`，随后重新 `resetExerciseDatabase()` 恢复干净状态；`bun test test/server/httpapi-exercise-reset.test.ts` 通过

## 4. 集成验证

- [x] 4.1 `cd packages/opennovel && bun typecheck && bun test test/server/httpapi-exercise-reset.test.ts test/manual-edit-sync-worker.test.ts test/novel/sync-worker-composition.test.ts` 通过；根目录 `bun run lint` 0 错误
- [x] 4.2 Linux 全量门禁：WSL 下以与 CI 相同命令跑 `bun run test:httpapi`（coverage → auth → effect 三连），最终 `summary pass=334 fail=0 skip=0 missing=0 extra=0`（本地实测 EXIT=0，日志零 FAIL）
- [x] 4.3 `openspec validate httpapi-exercise-flake --strict` 通过且 tasks 勾选完整

## Workflow follow-up

- 提交全部实现改动（按包拆分 commit，每个带 `OpenSpec-Change: httpapi-exercise-flake` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 归档（skip_specs 无需同步主 specs）→ ff 合并 `main` → 推送 → 确认 CI `test` workflow 全绿 → 清理本地与远端分支并 prune