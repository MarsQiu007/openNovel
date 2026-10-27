# Spec Delta

## Purpose

定义桌面 app 的自动更新语义——自动下载、退出时自动应用、下载完成后的轻量可见性（titlebar 圆点）、以及启动时检查的开关，让用户零操作即可保持最新。

## ADDED Requirements

### Requirement: 检查到更新后自动下载

桌面 app 检查远端 release 发现新版本时，SHALL 立即在后台开始下载，无需用户确认。下载过程中 updater 状态进入 `downloading`，下载完成后进入 `ready` 并持久化到本地存储。

#### Scenario: 检查到新版本自动下载

- **WHEN** 桌面 app 启动时或定时检查（每 10 分钟）发现远端有新版本
- **THEN** 自动在后台开始下载更新包
- **AND** updater 状态从 `checking` 进入 `downloading`
- **AND** 不弹任何对话框打扰用户

#### Scenario: 下载完成后持久化

- **WHEN** 更新包下载完成
- **THEN** updater 状态进入 `ready`（含版本号）
- **AND** `ready` 状态持久化到本地存储（即使 app 重启也能恢复）
- **AND** 在 titlebar 显示圆点标记提示用户

#### Scenario: 下载失败

- **WHEN** 更新包下载失败（网络错误、签名校验失败等）
- **THEN** updater 状态进入 `error`（含错误信息）
- **AND** 不弹错误对话框打扰用户
- **AND** titlebar 不显示圆点

### Requirement: 退出时自动安装已下载的更新

当 updater 状态为 `ready`（已下载完成）时，用户正常退出 app（关闭窗口或菜单退出），SHALL 在退出流程中自动应用更新。下次启动时运行新版本。

#### Scenario: 已下载更新，用户退出

- **WHEN** updater 状态为 `ready` 且用户正常退出 app
- **THEN** 在退出流程中自动应用已下载的更新
- **AND** 下次启动时运行新版本

#### Scenario: 未下载更新，用户退出

- **WHEN** updater 状态不是 `ready`（比如 `up-to-date` / `idle` / `checking`）
- **THEN** 正常退出，不执行安装

### Requirement: titlebar 圆点提示

当 updater 状态为 `ready` 时，SHALL 在 titlebar 显示一个小圆点标记；点击圆点 SHALL 弹出确认对话框，用户确认后立即重启安装更新。

#### Scenario: 下载完成后显示圆点

- **WHEN** updater 状态从其他状态进入 `ready`
- **THEN** titlebar 显示圆点标记

#### Scenario: 点击圆点弹出确认

- **WHEN** 用户点击 titlebar 圆点
- **THEN** 弹出确认对话框（含新版本号）
- **AND** 用户确认后立即重启安装
- **AND** 用户取消后关闭对话框，圆点仍保留（状态不变）

#### Scenario: 安装后圆点消失

- **WHEN** 用户确认重启安装，app 重启后运行新版本
- **THEN** titlebar 不再显示圆点
- **AND** updater 状态重置

### Requirement: 启动时检查更新开关

设置面板 SHALL 提供「启动时检查更新」开关，控制 app 启动时是否自动检查更新。开关默认开启。

#### Scenario: 开关开启

- **WHEN** 用户在设置面板打开「启动时检查更新」
- **THEN** 下次 app 启动时自动执行一次更新检查
- **AND** 检查行为与定时检查一致（自动下载、圆点提示）

#### Scenario: 开关关闭

- **WHEN** 用户在设置面板关闭「启动时检查更新」
- **THEN** 下次 app 启动时不自动检查更新
- **AND** 定时检查（每 10 分钟）仍生效

#### Scenario: 开关默认状态

- **WHEN** 用户首次安装 app 或从未调整过该开关
- **THEN** 开关默认开启
