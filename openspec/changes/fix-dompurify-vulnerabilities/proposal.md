# Proposal: fix-dompurify-vulnerabilities

## Why

Dependabot 在 `packages/ui` 和 `packages/session-ui` 中检测到 dompurify 3 个安全漏洞：

| # | 严重度 | GHSA | 摘要 |
|---|--------|------|------|
| 78 | **critical** | GHSA-pcvr-42fw-5jfr | SAFE_FOR_TEMPLATES bypass: split template expressions survive in attached shadow root content |
| 79 | **high** | GHSA-vhxf-7vqr-m22g | IN_PLACE: hook that removes parent/sibling leaves detached subtree's event handlers armed |
| 80 | **low** | GHSA-mmhx-hmjr-r674 | SMIL attributeName=href guard skipped when PARSER_MEDIA_TYPE=application/xhtml+xml |

当前版本 `3.4.16` 在漏洞范围 `<= 3.4.16` 内，需升级到 `>= 3.4.17` 修复。

## What Changes

- `packages/ui/package.json`：`dompurify` 从 `3.4.16` 升级到 `3.4.17`
- `packages/session-ui/package.json`：`dompurify` 从 `3.4.16` 升级到 `3.4.17`
- 运行 `bun install` 更新 lockfile
- 验证 `bun typecheck` 通过

## 非目标

- 不修改 dompurify 的使用代码（API 兼容，无需改动）
- 不处理其他包的依赖漏洞（由其他提案处理）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——纯依赖升级，无行为变更）

## Impact

- **packages/ui**：`dompurify` 版本升级
- **packages/session-ui**：`dompurify` 版本升级
- **风险**：低——dompurify 3.4.16 → 3.4.17 是补丁版本升级，API 完全兼容
