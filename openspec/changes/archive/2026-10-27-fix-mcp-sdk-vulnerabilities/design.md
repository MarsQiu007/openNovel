# Design

## Context

Dependabot 检测到 MCP SDK 4 个漏洞（2 high + 2 medium），当前版本 1.31.0 在漏洞范围内。MCP SDK 用于 `packages/core` 的 MCP 客户端和服务端实现，涉及工具注册、资源访问、prompt 管理等功能。

## Goals / Non-Goals

**Goals:**
- 升级 MCP SDK 到 >= 1.32.0，修复所有已知漏洞
- 确保 MCP 客户端/服务端功能正常

**Non-Goals:**
- 不修改 MCP 客户端/服务端代码（API 兼容）
- 不处理其他 core 依赖漏洞

## Decisions

### D1：升级到 1.32.0（最小修复版本）

**选择**：`1.31.0` → `1.32.0`

**理由**：
- 1.32.0 是修复所有 4 个漏洞的最低版本
- 补丁版本升级，API 兼容
- 避免跨大版本升级的风险

**注意**：MCP SDK 1.32.0 可能引入新的 API 变更，需验证 typecheck 和现有测试通过。

## Risks / Trade-offs

- **风险**：MCP SDK 1.32.0 可能引入 API 变更 → 缓解：补丁版本通常向后兼容，typecheck 可验证；如有问题，可回滚到 1.31.0 并寻找替代方案

## Migration Plan

无数据迁移。升级后重新 `bun install` 即可。

## Open Questions

无。
