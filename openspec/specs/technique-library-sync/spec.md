# technique-library-sync Specification

## Purpose
全局通用技法库随云同步：用户学到的通用技法跨机器、跨设备可用，与书同步共用同一连接、同一仲裁机制，无需额外配置。

## Requirements

### Requirement: 全局库同步单元退役清理

建立云同步连接后，同步运行 SHALL 把远端 `@library` 视为待清理的退役单元：若远端存在该单元，SHALL 删除其远端目录与全部快照；同时 SHALL 清理本地 `@library` 独立配对登记。清理 MUST NOT 下载恢复远端 `@library`，MUST NOT 删除或回滚任何书籍库项目；同步状态 MUST NOT 再展示 `@library`。

#### Scenario: 远端旧库被清理

- **WHEN** 远端存在 `@library` 单元且用户执行同步
- **THEN** 同步删除远端 `@library` 目录及其快照，并清理本地独立登记
- **THEN** 书籍库项目照常上传、下载或进入既有冲突流程

#### Scenario: 仅剩旧登记

- **WHEN** 远端没有 `@library` 但本地仍保留其独立配对登记，且用户执行同步
- **THEN** 同步清理该登记，同步状态不出现 `@library`

#### Scenario: 远端清理失败

- **WHEN** 删除远端 `@library` 时网络或权限错误导致清理失败
- **THEN** 同步报告该清理失败，不把失败伪装成同步成功
- **THEN** 书籍库项目不因本次失败被回滚或误删
