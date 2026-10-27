# Tasks

## 1. 升级 MCP SDK

- [x] 1.1 `packages/core/package.json`：`@modelcontextprotocol/sdk` 从 `1.31.0` 改为 `1.32.0`
- [x] 1.2 运行 `bun install` 更新 lockfile

## 2. 验证

- [x] 2.1 在 `packages/core` 跑 `bun typecheck` 通过
- [x] 2.2 在 `packages/core` 跑 `bun test` 通过（1191 pass / 3 fail 为既有 flake，MCP 测试通过）

## Implementation Commits

- `821f3cd47` fix(core): 升级 @modelcontextprotocol/sdk 1.31.0 → 1.32.0 修复 4 个安全漏洞

## Workflow follow-up

- 用 `git log --grep "OpenSpec-Change: fix-mcp-sdk-vulnerabilities" --format="%h %s"` 收集实现提交写入本文件 `## Implementation Commits`。
- 运行 `npx openspec validate fix-mcp-sdk-vulnerabilities`。
- 用 `npx openspec archive fix-mcp-sdk-vulnerabilities --yes` 归档。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送。
- 通知用户验收。
