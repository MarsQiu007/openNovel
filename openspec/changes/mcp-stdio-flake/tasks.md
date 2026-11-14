# Tasks

## 1. 测试侧确定性门控

- [x] 1.1 `test/mcp.test.ts` 新增 `waitTools` 助手（`Effect.filterOrElse` + `Schedule.spaced("100 millis") + recurs(200)`，失败信息附带 `Object.keys` 快照），三个用例改走门控：`connects` 用 `waitTools` 返回值替换裸 `mcp.tools()` 调用、`disconnect` 与 `reconnects` 的 `toContain` 一行断言替换为 `yield* waitTools(mcp, "fixture_echo")`；`cd packages/core && bun typecheck` 通过
- [x] 1.2 `cd packages/core && bun test test/mcp.test.ts` 通过，且连续 20 跑全绿（`for /l` 或等价循环，记录命中 flake 的次数——预期 0）

## 2. 收尾

- [x] 2.1 `openspec validate mcp-stdio-flake --strict` 通过且 tasks 勾选完整
- [ ] 2.2 推送后 CI `test` workflow 观察期（后续 3 次 push/run）内 `unit (linux)`/`unit (windows)` 不再出现 `Mcp >` 失败签名；若再现，按 design.md Open Questions 升级为生产瞬态收敛提案

## Workflow follow-up

- 提交实现改动（带 `OpenSpec-Change: mcp-stdio-flake` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 归档（skip_specs 无需同步主 specs）→ ff 合并 `main` → 推送 → 确认 CI `test` workflow 全绿 → 清理本地分支

## Implementation Commits

- `c94117c843` fix(test/core): mcp stdio 用例改 waitTools 确定性门控
