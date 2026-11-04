# Design: desktop-tray

## Context

- 主进程已有 `quitting` 标志纪律：`window-registry.ts` 内部持有标志，`windows.ts` 经 `setAppQuitting()` 暴露；真退出路径全部先置标志——更新器 `quitAndInstall` 前置置位、`session-end`（windows.ts 窗口接线）、重启恢复对话框走 `app.relaunch()+app.exit(0)`（不经 close 事件）。`registry.closed()` 依赖该标志区分「主动关最后一个窗口」与「退出流程」。
- 窗口 ID 注册表持久化窗口列表供下次启动恢复；`hide()` 不触发 `closed`，注册表与窗口状态文件天然不受影响。
- 无 `window-all-closed` handler：Windows/Linux 默认最后窗口关闭即退出，macOS 默认驻留。macOS 当前无 `activate` handler（Dock 点击无法重建窗口，属既有缺口）。
- `desktop-native-locale` 已落地主进程三语取词模块（`t()` 绑定 electron-store 同一缓存实例，renderer 语言切换经 main IPC 写入后立即生效）；托盘文案直接复用。
- 图标资产齐备：`resources/icons/icon.ico`（多尺寸 ICO）、`32x32.png` 等，electron-builder 打包配置已覆盖，托盘可直接引用。
- 桌面端设置行模式成熟：`store-keys.ts` 常量 + `ipc.ts` get/set handler + preload 三件套 + `settings-v2/general.tsx` 与旧版 `settings-general.tsx` 的 `desktop()` 守卫区块（pinch zoom 即此模式）。
- 托盘关闭期间后端、PTY、agent 任务存活——与最小化同构，无新增运行时风险。

## Goals / Non-Goals

**Goals:**

- 关闭语义按「开关开启且非真退出 → 挂起」判别，判别逻辑纯函数化、可单测。
- Windows/Linux 托盘菜单为首个原生退出入口，文案三语本地化。
- 设置开关两处设置界面（v2 与旧版）均可达，平台默认值正确。

**Non-Goals:**

- 不引入任何新二进制图标资产；不动 electron-builder 配置。
- 不改动 macOS 关闭语义之外的 mac 行为；不建 macOS 托盘。
- 不触碰 `updater-install-prompt` 提案目录（并行在途）；托盘菜单不含「检查更新」。

## Decisions

### 1. 关闭拦截：hide 而非 destroy

`registerWindow` 中给每个主窗口接 `close` 事件：当「开关开启 && `!registry.isQuitting()`」时 `event.preventDefault()` + `win.hide()`；否则放行销毁。

- 选 hide：渲染进程、页面状态、终端会话零成本保留，恢复即时；`closed` 不触发，注册表/状态文件零改动。
- 备选 destroy + 重建：需要走注册表删除再登记、窗口状态丢失、恢复慢，且无收益。
- 备选 minimize：任务栏仍残留窗口入口，与「挂在后台」语义不符。

### 2. 真退出判别复用既有 quitting 标志（单一真相）

拦截判定读 `registry` 的标志。`registry` 目前只有 `setQuitting` 写口，新增 `isQuitting()` 读口并直注 `tray-controller` 的 `isQuitting` 注入（`windows.ts` 不再二次出口，避免长期无人引用的导出）；托盘「退出」菜单走既有 `setAppQuitting()` + `app.quit()`，与 Cmd+Q、更新器、session-end、SIGINT/SIGTERM 同一条纪律。

- 备选托盘自带独立标志：两套真相必然漂移（如更新器重启时被拦截器误挡），否决。

### 3. 组件切分：tray-controller（纯逻辑）+ tray.ts（Electron 壳）

`tray-controller.ts` 零 Electron 依赖，持有：隐藏窗口集合（泛型句柄）、`shouldHideOnClose()` 判定、`hide()` / `restoreAll()` / 菜单项模型（经注入的 `t` 取词）；`tray.ts` 只做 Tray 图标、Menu 构建、事件转发。测试对齐 `window-registry.ts` 风格（bun:test，假句柄）。关闭拦截接线在 `windows.ts`（`registerWindow` 内调 `controller.shouldHideOnClose()`），恢复出口 `restoreHiddenWindows()` 由 `windows.ts` 实现：取 controller 全部隐藏句柄 → `show()` + `focus()`。

- 备选全部塞进 `tray.ts`：Electron 壳无法单测，事件矩阵（关闭/恢复/退出 × 开关 × quitting）失去廉价验证手段。

### 4. 平台策略与 activate 补丁

`index.ts` 在 `whenReady` 后按平台创建托盘（win32/linux）；darwin 跳过托盘，仅新增 `app.on("activate")`：`BrowserWindow.getAllWindows().length === 0` 时 `restoreMainWindows()`。不新增 `window-all-closed` handler——开关开启时该事件不会触发（窗口只藏不销），关闭时沿用默认退出；macOS 默认驻留语义不变。

### 5. 设置持久化、IPC 与设置行

- `store-keys.ts` 增 `CLOSE_TO_TRAY_ENABLED_KEY = "closeToTrayEnabled"`；读侧 `getCloseToTrayEnabled()`：`stored === undefined` 时按平台默认（win32 → true，其余 → false），否则取布尔值。判定写成纯函数 `resolveCloseToTrayDefault(platform)` 便于单测。
- IPC 与 preload 镜像 pinch zoom 读写的两件套：`get-close-to-tray-enabled` / `set-close-to-tray-enabled`；`platform.tsx` 增 `getCloseToTrayEnabled?` / `setCloseToTrayEnabled?` 类型，桌面 renderer 平台对象透传 `window.api`。经核查 pinch 的 `onChanged` 广播在本开关无 renderer 订阅者（拦截判定在主进程实时读 store），按「不预留死代码」只建 get/set 两件套，有订阅者时再补广播。
- 设置行同时加入 `settings-v2/general.tsx` 与 `settings-general.tsx`，行渲染条件为 `desktop()` 且平台 `os !== "macos"`（`desktop()` 守卫包含 macOS，而 R5 要求 macOS 无此开关），共用同一键与 IPC。旧版布局用户不加行会在 Windows 默认开启却无开关可关——穷举关联面后两处都加（行成本约十行）。
- app locale 按「按键值增量走提案」约定新增两键三语（`settings.general.row.closeToTray.title` / `.description`），不动任何既有键。

### 6. 托盘图标复用既有资产

win32 用 `resources/icons/icon.ico`（多尺寸 ICO，Windows 托盘按 DPI 自选），linux 用 `32x32.png`（Electron 自动缩放），经 `nativeImage.createFromPath` 加载。tooltip 硬编码 "OpenNovel"（品牌名不翻译）。

- 备选派生专用 tray.ico/tray.png：需要设计资源产出 16px 可读稿，收益与成本不匹配，留作后续打磨。

### 7. 托盘文案进 native-locale 字典

`native-locale.ts` `dict` 新增两键（简体中文源文案，en/zht 并列）：`tray.show`（显示主窗口）、`tray.quit`（退出 OpenNovel）。菜单在每次构建时经 `t()` 取词。语言切换的刷新机制：renderer 写 language 键经 main IPC 落到同一 electron-store 缓存实例，`tray.ts` 用 electron-store 的 `onDidChange("language", …)` 订阅并重建菜单，保证下一次弹出的菜单即为新语言（既有 `desktop-native-locale` 即时生效机制的延伸，其「三语字典完整性」要求对新键自动适用）；若 `store.ts` 封装未暴露 `onDidChange`，在该封装补透传。

## Risks / Trade-offs

- **拦截误吞程序化 close**：main 进程若有内部 `win.close()` 调用点（预期没有，需穷举核实）会被拦截。→ 实现任务含 grep 穷举核实；真退出路径已全部先置 quitting 标志，放行条件与现有 `registry.closed()` 语义同源。
- **Alt+F4 挂起让用户误以为已退出**：托盘图标常驻提示应用在运行，设置可关；用户已在探索阶段明确接受。
- **Linux 托盘图标缺失**（无 AppIndicator 的桌面环境）：托盘默认关闭降低暴露面；单实例 second-instance 的既有 show+focus 可作为唤回通道，托盘恢复全量窗口不受影响。
- **隐藏窗口与 updater 交互**：更新器重启前置置 quitting 标志，隐藏窗口被正常销毁，安装后下次启动经注册表恢复——与现状一致。
- **并行提案冲突**：`updater-install-prompt` 在途，若其触碰退出路径接线，与本 change 的冲突面集中在 quitting 标志使用点，合并时人工对齐。

## Migration Plan

纯增量：新 store 键无历史数据；回滚版本读不到该键，行为退化为「无托盘、关闭即退出」，无数据损失。

## 文案键位表

| 键 | zh | en | zht |
| --- | --- | --- | --- |
| tray.show | 显示主窗口 | Show Main Window | 顯示主視窗 |
| tray.quit | 退出 OpenNovel | Quit OpenNovel | 結束 OpenNovel |
| settings.general.row.closeToTray.title | 关闭时最小化到系统托盘 | Minimize to system tray on close | 關閉時最小化到系統匣 |
| settings.general.row.closeToTray.description | 关闭窗口后应用继续在后台运行，可从系统托盘恢复或退出 | Keep the app running in the background after closing; restore or quit from the system tray | 關閉視窗後應用繼續在背景執行，可從系統匣復原或結束 |
