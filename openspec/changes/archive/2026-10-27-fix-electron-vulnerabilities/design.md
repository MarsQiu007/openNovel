# Design

## Context

Dependabot 检测到 electron 2 个漏洞（1 high + 1 medium），当前版本 42.11.8 在漏洞范围内。Electron 是桌面应用的核心运行时，涉及窗口管理、auto-updater、IPC 等关键功能。

## Goals / Non-Goals

**Goals:**
- 升级 electron 到 >= 42.11.16，修复所有已知漏洞
- 确保 electron-updater、electron-builder 等生态依赖兼容

**Non-Goals:**
- 不修改 Electron 主进程/渲染进程代码
- 不升级 electron 大版本（如 43.x）

## Decisions

### D1：升级到 42.11.16（最小修复版本）

**选择**：`42.11.8` → `42.11.16`

**理由**：
- 42.11.16 是修复 GHSA-jr5w-w6x2-84p9 的最低版本
- 补丁版本升级，API 完全兼容
- 避免跨大版本升级的风险

**兼容性确认**：electron-updater 6.8.9 无 peerDependencies 限制，兼容任意 electron 版本。

## Risks / Trade-offs

- **风险**：electron 42.11.16 可能与 electron-builder 26.15.2 不兼容 → 缓解：补丁版本通常无 API 变更，且 typecheck 可验证

## Migration Plan

无数据迁移。升级后重新 `bun install` 即可。

## Open Questions

无。
