# Tasks

## 1. 升级 MCP SDK

- [ ] 1.1 `packages/core/package.json`：`@modelcontextprotocol/sdk` 从 `1.31.0` 改为 `1.32.0`
- [ ] 1.2 运行 `bun install` 更新 lockfile

## 2. 验证

- [ ] 2.1 在 `packages/core` 跑 `bun typecheck` 通过
- [ ] 2.2 在 `packages/core` 跑 `bun test` 通过（MCP 相关测试）

## Workflow follow-up

- 用 `git log --grep "OpenSpec-Change: fix-mcp-sdk-vulnerabilities" --format="%h %s"` 收集实现提交写入本文件 `## Implementation Commits`。
- 运行 `npx openspec validate fix-mcp-sdk-vulnerabilities`。
- 用 `npx openspec archive fix-mcp-sdk-vulnerabilities --yes` 归档。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送。
- 通知用户验收。
