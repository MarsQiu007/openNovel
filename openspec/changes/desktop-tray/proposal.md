# Proposal: desktop-tray

## Why

桌面端（Electron）目前在 Windows / Linux 上点击关闭按钮即直接退出整个应用：后端、终端会话、agent 任务全部终止，误触代价高。用户希望「关闭」只是把窗口收到系统托盘，应用在后台继续运行，通过托盘菜单才是真正的退出。这与最小化行为同构（renderer、后端、PTY 在最小化时都存活），运行时风险低，主要风险集中在「真退出」与「假关闭」的判别上，而代码里已有一套 `quitting` 标志纪律可以直接复用。

## What Changes

- Windows / Linux 新增系统托盘（Electron `Tray`）：托盘菜单提供「显示主窗口」「设置」「退出 OpenNovel」三项；左键点击托盘图标恢复全部被隐藏的窗口；点击「设置」恢复窗口并打开设置页（复用 renderer 既有 `settings.open` 命令通道）；tooltip 为 OpenNovel。
- 新增「关闭时最小化到系统托盘」开关（设置 → 常规），持久化到桌面端 electron-store；Windows 默认开启，Linux 默认关闭，macOS 不提供该设置。
- 开关开启时拦截主窗口 `close` 事件：仅当「开关开启且当前不是真退出流程」时 `preventDefault()` 并 `hide()` 窗口；隐藏窗口的渲染进程、后端与终端会话全部保留，窗口 ID 注册表不变（`hide` 不触发 `closed`，无需恢复逻辑）。
- 真退出路径统一走既有 `quitting` 标志（`setAppQuitting`），托盘「退出」、macOS Cmd+Q、更新器 `quitAndInstall` 前置标志、`session-end`（Windows 关机）、SIGINT/SIGTERM、重启恢复对话框均已被覆盖；拦截器先检查该标志，真退出时放行销毁。
- 多窗口各自独立隐藏；托盘恢复时一次性恢复全部被隐藏窗口并聚焦。
- 托盘菜单与 tooltip 以外的原生文案（菜单两项）接入全局语言设置，复用 `desktop-native-locale` 落地的 `native-locale` 模块（三语字典新增 `tray.*` 键，简体中文为源文案）。
- macOS 不建托盘：保持现有「关闭即销毁窗口、应用驻留」语义，仅补齐缺失的 `activate` 事件处理（点击 Dock 图标时若无窗口则重建主窗口）。
- 设置界面新增开关行（`settings-v2` 与旧版 `settings-general` 两处桌面区块均加入，复用同一 IPC 与文案键）。

## Capabilities

### New Capabilities

- `desktop-tray`: 桌面端关闭到系统托盘与托盘退出的行为约定——关闭拦截（开关开启且非真退出时隐藏窗口）、托盘恢复全部被隐藏窗口、托盘菜单为 Windows / Linux 的首个原生退出入口、真退出路径判别（quitting 标志纪律）、平台差异（macOS 无托盘、activate 重建窗口）、关闭到托盘开关的持久化与平台默认值。

### Modified Capabilities

（无。`desktop-native-locale` 的三语字典完整性要求对新键同样适用，属既有要求的自然延伸，不改其需求文本。）

## Impact

- **packages/desktop**：主进程新增 `tray.ts`（Electron 壳）与 `tray-controller.ts`（纯逻辑内核）；`windows.ts` 接线关闭拦截与隐藏集合；`index.ts` 接线托盘生命周期与 macOS `activate`；`ipc.ts` / `preload` / `store-keys.ts` 新增开关读写通道（沿用 pinch zoom 模式）；`native-locale.ts` 字典新增 `tray.*` 键。
- **packages/app**：设置界面两处桌面区块新增开关行；i18n 字典按「按键值增量走提案」约定新增 `settings.general.row.closeToTray.*` 三语键（不改动既有键内容）。
- **图标资产**：托盘图标复用既有 `resources/icons/icon.ico`（Windows，多尺寸 ICO）与 `32x32.png`（Linux），不新增二进制资产，打包配置不变。
- **兼容性**：与既有本地数据完全兼容——新增 store 键带平台默认值，旧版本写入的数据不受影响；隐藏窗口期间窗口 ID 注册表与窗口状态文件保持不变。
- **不在本次范围（非目标）**：macOS 托盘；托盘菜单「检查更新」等扩展项；关闭到托盘时的气泡通知；托盘图标角标（如运行中会话数）；TUI / Web 端任何行为。
