# Proposal: fix-mcp-sdk-vulnerabilities

## Why

Dependabot 在 `packages/core` 中检测到 `@modelcontextprotocol/sdk` 4 个安全漏洞：

| # | 严重度 | GHSA | 摘要 | 修复版本 |
|---|--------|------|------|---------|
| 70 | **high** | GHSA-22jm-h49p-29qw | Experimental tasks were not tied to the session that created them | >= 1.32.0 |
| 71 | **medium** | GHSA-rvq5-wwqv-78pq | Server bearer authentication accepted tokens issued for another service | >= 1.32.0 |
| 69 | **medium** | GHSA-6prh-2h8m-c8cw | HTTP client transports and OAuth requests followed cross-origin redirects and re-sent custom headers and request bodies | >= 1.32.0 |
| 72 | **high** | GHSA-46jr-4wx8-v453 | One HTTP request within the default size limit could exhaust server memory during validation | >= 1.32.0 |

当前版本 `1.31.0` 在漏洞范围内，需升级到 `>= 1.32.0` 修复。

## What Changes

- `packages/core/package.json`：`@modelcontextprotocol/sdk` 从 `1.31.0` 升级到 `1.32.0`
- 运行 `bun install` 更新 lockfile
- 验证 `bun typecheck` 和 `bun test` 通过

## 非目标

- 不修改 MCP 客户端/服务端代码（API 兼容）
- 不处理其他 core 依赖漏洞

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——纯依赖升级，无行为变更）

## Impact

- **packages/core**：`@modelcontextprotocol/sdk` 版本升级
- **风险**：中——MCP SDK 1.31.0 → 1.32.0 是补丁版本升级，但涉及网络通信和认证，需验证 MCP 功能正常
