# Design

## Context

Dependabot 检测到 dompurify 3 个漏洞（1 critical + 1 high + 1 low），当前版本 3.4.16 在漏洞范围内。dompurify 用于 `packages/ui` 和 `packages/session-ui` 的 HTML 清理，主要场景是 markdown 渲染后的 XSS 防护。

## Goals / Non-Goals

**Goals:**
- 升级 dompurify 到 >= 3.4.17，修复所有已知漏洞
- 不破坏现有 markdown 渲染和 HTML 清理功能

**Non-Goals:**
- 不修改 dompurify 的使用代码（API 兼容）
- 不处理其他依赖漏洞

## Decisions

### D1：直接升级补丁版本

**选择**：`3.4.16` → `3.4.17`（补丁版本升级）

**理由**：
- 3.4.17 是 3.4.16 的直接后续补丁版本，修复了这 3 个漏洞
- API 完全兼容，无需修改使用代码
- 风险最低

**替代**：
- 升级到 3.5.x：被否，引入不必要的大版本变更风险

## Risks / Trade-offs

- **风险**：3.4.17 可能引入未知回归 → 缓解：补丁版本通常只含安全修复，且 typecheck + 现有测试可验证

## Migration Plan

无数据迁移。升级后重新 `bun install` 即可。

## Open Questions

无。
