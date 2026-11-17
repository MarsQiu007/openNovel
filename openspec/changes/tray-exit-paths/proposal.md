# Proposal: tray-exit-paths

## Why

2026-11-17 打包版冒烟（v0.1.5/v0.1.6）实证：Windows 产物上系统托盘从未出现，且「关闭挂起」默认开启，用户点击关闭按钮后窗口被隐藏，应用在系统中无任何可见图标、无找回入口、无退出入口，只能通过任务管理器结束进程。这违反既有 `desktop-tray` spec 的承诺（「托盘图标可见」「托盘提供显示、设置与退出入口」），也让「关闭挂起」从便利特性变成应用死角。

根因有两处：一是 electron-builder 配置缺 `extraResources`，`resourcesPath/icons` 目录不在打包产物中（本机取证 `resources/` 仅含 app-update.yml、app.asar、elevate.exe），托盘创建时图标加载失败即静默放弃；二是关闭挂起判定不感知托盘可用性，托盘不存在时窗口仍被挂起。

## What Changes

- electron-builder 配置补 `extraResources`，将 `resources/icons` 目录随包分发到 `process.resourcesPath/icons`（三平台统一；macOS 的 `.icns` 由 builder 的 `icon` 字段单独引用，不受影响）。
- 托盘创建失败时关闭挂起降级为真退出：托盘不可用即无挂起资格，`shouldHideOnClose` 增加「托盘已创建」前置条件；托盘缺失时点关闭走真退出，`before-quit` 链路保持原样（`updater-install-prompt` 的退出确认拦截照常生效）。
- delta spec 修改 `desktop-tray`：新增「托盘不可用时的关闭兜底」Requirement，并把「托盘图标资源随包分发」纳入可验证场景，使 spec 承诺可兑现、可验证。

## Capabilities

### New Capabilities

（无——本变更不引入新能力域。）

### Modified Capabilities

- `desktop-tray`: 现有 Requirement「关闭窗口时挂起到系统托盘」与「托盘提供显示、设置与退出入口」的前提补上「托盘已创建且图标加载成功」；新增 Requirement「托盘不可用时的关闭兜底」（托盘未创建时关闭 SHALL 走真退出，不得隐藏窗口制造无出口死角）与「托盘图标资源随包分发」可验证场景（打包产物 `resources/icons` 含所需图标文件）。

## Impact

- 受影响包：`packages/desktop`（electron-builder.config.ts 打包配置、tray.ts 托盘创建、tray-controller.ts 关闭判定与对应单测）。
- 平台影响：Windows/Linux 行为变化点在「托盘创建失败」这一此前未覆盖的分支——托盘正常创建时行为完全不变；macOS 不创建托盘，仅获得图标资源分发（无行为变化）。
- 关联面：`tray-controller` 单测需覆盖托盘可用性条件；`updater-install-prompt` 的退出确认拦截在新增真退出形态下行为不变（已由其既有单测覆盖 ready/非 ready 分支）。
- 与现有本地数据的兼容性：不涉及持久化数据模型变更；`close-to-tray` 开关存储键与语义不变。
- 用户数据风险：无（纯壳层行为修复，不触碰小说数据与配置语义）。
