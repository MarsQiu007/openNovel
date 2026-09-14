## Context

`packages/core` 测试套件有 3 个持续失败，本地与 CI 均可复现：

1. **SessionRunnerLLM > interrupts a source Location runner after a Session moves**：测试在 `SessionEvent.Moved` 发布后断言 `SessionContextEpochTable` 无该 session 的行，但行仍存在。`SessionContextEpoch.reset` 已实现（删除 epoch 行）但从未被调用；`SessionEvent.Moved` projector 只更新 `SessionTable` 的目录/路径/workspace 字段。
2. **cross-spawn spawner > captures stdout via .all when no stderr**：断言 `echo hello from stdout` 输出为 `hello from stdout`，但 Windows `cmd /c echo` 输出 `"hello from stdout"`（含引号）。同文件中 stderr 测试已用 `node -e` 脚本规避了该平台差异。

> 注：Snapshot 测试在 `bun run test`（`--timeout 30000`）下已全部通过；初始调查时使用裸 `bun test`（默认 5s 超时）导致误报。

## Goals / Non-Goals

**Goals:**
- 让 `packages/core` 测试套件在 Windows 和 Linux 上稳定通过
- 修复会话迁移后 context epoch 未重置的真实缺陷
- 消除平台相关的测试假失败

**Non-Goals:**
- 不改变 Session 运行时的调度、恢复或位置语义（只补一个已有的清理调用）
- 不重构 Snapshot 或 cross-spawn-spawner 的实现
- 不为通过测试放宽产品质量要求

## Decisions

1. **Moved projector 调用 SessionContextEpoch.reset**
   - 在 `projector.ts` 的 `SessionEvent.Moved` 处理中，更新 `SessionTable` 后调用 `SessionContextEpoch.reset(db, sessionID)`。
   - 理由：会话迁移到新 Location 后，旧 epoch 的 baseline/snapshot 不再有效，必须让下一次 `prepare` 从新 Location 重新初始化。`reset` 函数已存在且签名匹配。
   - 备选：在 `SessionContextEpoch.prepare` 中比较 location 并自动失效——需要增加 location 跟踪，复杂度不成比例。

2. **echo 测试改用 node -e 输出**
   - 将 `ChildProcess.make("echo", [...])` 改为 `node -e "process.stdout.write(...)"`，与同文件 stderr 测试保持一致模式。
   - 理由：`echo` 的引号行为是 shell 内建差异，不适合在测试中断言；`node -e` 跨平台行为一致。

## Risks / Trade-offs

- [reset 在 Moved projector 中同步执行] → 如果未来有大量 session 批量迁移，每行一个 DELETE 可接受；SQLite 单行删除开销极低。

## Migration Plan

1. 提交修复，运行 `packages/core` 全量测试验证 3 个失败全部消除。
2. 推送后观察 CI `test` workflow 的 linux/windows unit job。
