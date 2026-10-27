# Proposal: fix-electron-vulnerabilities

## Why

Dependabot 在 `packages/desktop` 中检测到 electron 2 个安全漏洞：

| # | 严重度 | GHSA | 摘要 | 修复版本 |
|---|--------|------|------|---------|
| 74 | **high** | GHSA-jr5w-w6x2-84p9 | Mitigation for compromised eMudhra intermediate certificates | >= 42.11.16 |
| 73 | **medium** | GHSA-x562-297c-g43g | Pointer lock permission requests can be attributed to the wrong frame | >= 42.11.9 |

当前版本 `42.11.8` 在漏洞范围内，需升级到 `>= 42.11.16` 修复。

## What Changes

- `packages/desktop/package.json`：`electron` 从 `42.11.8` 升级到 `42.11.16`
- 运行 `bun install` 更新 lockfile
- 验证 `bun typecheck` 通过

## 非目标

- 不修改 Electron 主进程/渲染进程代码（补丁版本兼容）
- 不处理 electron-updater、electron-builder 等其他 Electron 生态依赖

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——纯依赖升级，无行为变更）

## Impact

- **packages/desktop**：`electron` 版本升级
- **风险**：低——electron 42.11.8 → 42.11.16 是补丁版本升级，API 完全兼容
