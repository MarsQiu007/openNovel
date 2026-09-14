## 1. Session 迁移 epoch 清理

- [x] 1.1 在 `packages/core/src/session/projector.ts` 的 `SessionEvent.Moved` projector 中，更新 `SessionTable` 后调用 `SessionContextEpoch.reset(db, sessionID)`。
- [x] 1.2 运行 `packages/core` 的 `bun test test/session-runner.test.ts -t "interrupts a source Location runner"` 确认通过。

## 3. cross-spawn echo 平台修复

- [x] 3.1 将 `test/effect/cross-spawn-spawner.test.ts` 中 `.all` stdout 测试的 `echo` 命令改为 `node -e` 脚本输出。
- [x] 3.2 运行 `bun test test/effect/cross-spawn-spawner.test.ts` 确认全部通过。

## 4. 全量自查

- [x] 4.1 在 `packages/core` 运行完整 `bun test`，确认 0 失败。
- [x] 4.2 在 `packages/core` 运行 `bun typecheck`。
- [x] 4.3 运行 `openspec validate fix-core-test-failures`。

## Implementation Commits

- `74eb4fe09` fix(core): 修复会话迁移 epoch 清理与跨平台测试失败
