# Spec Delta

## RENAMED Requirements

- FROM: ### Requirement: 退出时自动安装已下载的更新
  TO: ### Requirement: 退出时确认后安装已下载的更新

## MODIFIED Requirements

### Requirement: 退出时确认后安装已下载的更新

当 updater 状态为 `ready`（已下载完成）时，用户正常退出 app（关闭窗口或菜单退出），SHALL 先弹出确认对话框（含新版本号），提供「立即重启」与「稍后」两个选项；只有用户确认后立即退出并应用更新，下次启动时运行新版本。用户选择「稍后」时正常退出，不执行安装，已下载的更新包与就绪状态保留（titlebar 圆点保留），留待下次启动处理。updater 状态不是 `ready` 或更新功能被禁用时，退出不弹确认框。

#### Scenario: 已下载更新，用户退出

- **WHEN** updater 状态为 `ready` 且用户正常退出 app
- **THEN** 弹出确认对话框，包含新版本号与「立即重启」「稍后」两个选项
- **AND** 不直接执行安装

#### Scenario: 用户选择立即重启

- **WHEN** 用户在退出确认对话框中选择「立即重启」
- **THEN** app 退出并应用已下载的更新
- **AND** 下次启动时运行新版本
- **AND** titlebar 圆点与就绪持久化记录被清除

#### Scenario: 用户选择稍后

- **WHEN** 用户在退出确认对话框中选择「稍后」
- **THEN** app 正常退出，不执行安装
- **AND** 已下载的更新包与就绪持久化记录保留
- **AND** titlebar 圆点保留，下次启动仍可见

#### Scenario: 未下载更新，用户退出

- **WHEN** updater 状态不是 `ready`（比如 `up-to-date` / `idle` / `checking`），或更新功能被禁用
- **THEN** 正常退出，不弹确认框，不执行安装
