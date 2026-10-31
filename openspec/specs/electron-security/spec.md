# electron-security Specification

## Purpose
定义桌面壳的安全版本基线约束：Electron 版本不得低于 42.11.16，把上游安全修复固化为硬性下限，依赖升级与发版检查据此拦截不安全版本。

## Requirements

### Requirement: electron 版本不低于 42.11.16

`packages/desktop` 的 `electron` 依赖版本 SHALL 不低于 `42.11.16`，以修复 compromised eMudhra intermediate certificates（GHSA-jr5w-w6x2-84p9）和 pointer lock permission（GHSA-x562-297c-g43g）相关漏洞。

#### Scenario: 升级后版本检查

- **WHEN** 检查 `packages/desktop/package.json` 的 `electron` 版本
- **THEN** 版本号 SHALL 为 `42.11.16` 或更高

#### Scenario: 桌面应用正常启动

- **WHEN** 启动打包后的桌面应用
- **THEN** 应用 SHALL 正常启动，无 Electron API 兼容性问题
- **AND** auto-updater 功能 SHALL 正常工作
