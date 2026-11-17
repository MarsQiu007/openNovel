# Design: tray-exit-paths

## Context

见 proposal.md。核心事实：

- `iconsDir()` 打包版读 `join(process.resourcesPath, "icons")`（windows.ts:94-96），托盘图标取 `icon.ico`（Windows）/`32x32.png`（Linux），macOS Dock 图标取 `dock.png`（windows.ts `setDockIcon`，darwin-only）。
- electron-builder 配置（electron-builder.config.ts）只有 `files: ["out/**/*", "resources/**/*"]`（打进 app.asar），没有任何 `extraResources`，因此 `resourcesPath/icons` 在产物中不存在；`tray.ts` 的 `nativeImage.createFromPath(...)` 返回空图后直接 return，托盘静默不创建。
- 关闭挂起判定在 `tray-controller.ts`：`shouldHideOnClose() = closeToTrayEnabled() && !isQuitting()`，Windows 默认开启；该判定不感知托盘是否存在，托盘缺失时窗口照样被隐藏，且托盘缺失导致唯一的找回/退出入口消失。
- `menu.ts` 的应用菜单是 darwin-only 既有设计；Windows 无应用菜单、无 renderer 退出按钮，托盘是唯一全局出口。
- `tray-controller.ts` 是零 Electron 依赖的纯逻辑模块（单测友好），Electron 接线在 `tray.ts` / `windows.ts`；`tray.ts` 反向 import `windows.ts`（`sendMenuCommand` 等），依赖方向不可倒置。`trayController` 为 `windows.ts` 模块级单例（windows.ts:65，未导出），消费方穷举：`shouldHideOnClose`（close handler，windows.ts:276）、`restoreAll`（:162）、`menu`（:174）、`hide`（:279）全部在 windows.ts 内；设置页 IPC（ipc.ts get/set-close-to-tray-enabled）只读写开关值，不触 controller。
- 启动时序：`app.whenReady()` 后 `restoreMainWindows()`（index.ts:397）与 `createTray()`（index.ts:398）同批同步执行，`new Tray` 为同步构造；用户可感知的窗口关闭最早发生在渲染完成后，不存在「托盘创建前用户点击关闭」的可感知窗口期。

## Goals / Non-Goals

**Goals:**
- 打包产物包含托盘图标资源，三平台统一分发（Windows 托盘 `.ico`、Linux 托盘 `.png`、macOS Dock 图标 `dock.png` 一并受益）。
- 托盘创建失败时关闭行为自动降级为真退出，保证任何状态下都存在可用的退出路径。
- delta spec 的全部场景可通过「安装打包产物后直接启动」实测验收。

**Non-Goals:**
- 不恢复 Windows 应用菜单（`menu.ts` darwin-only 是有意设计）。
- 不新增 renderer 退出按钮或设置页入口（托盘 + 关闭兜底已构成双出口）。
- 不改动 `updater-install-prompt` 的退出确认拦截逻辑与 auto-update 行为。
- 不改动 macOS 托盘语义（macOS 本就不创建托盘）。
- 不重构 `files`/asar 打包结构。

## Decisions

### D1: 用 `extraResources` 分发 `resources/icons` 到 `resourcesPath/icons`

在 electron-builder 配置的 `getBase` 中加入：

```ts
extraResources: [{ from: "resources/icons", to: "icons" }],
```

三平台 base 配置统一生效。分发的是 `icons` 子目录而非整个 `resources`（后者含 linux desktop entry、entitlements 等构建输入，不属于运行时资源）；目录体积为 KB 级，全量子目录无害。

**备选与弃用理由**：
- 改 `iconsDir()` 指向 asar 内路径：`nativeImage` 从 asar 读取存在平台差异与已知限制，且涉及打包结构重构，改动面大于收益。
- 用 `icon` 字段让 builder 顺手拷贝：`icon` 字段只决定应用图标构建输入，不保证 `icons/` 目录结构落到 `resourcesPath`，托盘代码的路径约定会被打破。

### D2: 托盘可用性作为关闭挂起的前置条件，状态由 tray-controller 持有

`tray-controller.ts` 的 controller 增加 `trayCreated` 状态：

- `createTrayController` 内部维护 `let trayCreated = false`（controller 私有状态，非 opts 注入——状态由 markTrayCreated 生命周期管理，构造签名不变，既有测试 setup 无需适配）。
- `shouldHideOnClose()` 变为 `closeToTrayEnabled() && trayCreated && !isQuitting()`。
- controller 增加 `markTrayCreated()`（setter，幂等）。

接线通道：`trayController` 是 windows.ts 未导出的模块级单例，为让 tray.ts 可置位，windows.ts 导出 `trayController` 实例（`trayMenuItems()` 已有同向导出先例）；`tray.ts` 在 `new Tray(image)` 成功后调用 `trayController.markTrayCreated()`，`image.isEmpty()` 分支保持提前返回（托盘未创建，状态保持 false）。

**状态放 tray-controller 而非 tray.ts 导出 getter 的理由**：`tray.ts` 已 import `windows.ts`，反向导出 getter 会形成模块循环；tray-controller 是双方共同依赖的纯逻辑模块，作为状态宿主无环且单测可直接覆盖（托盘可用性 × 开关 × quitting 三条件组合）。

**备选与弃用理由**：托盘创建失败时弹原生对话框告警——告警不消除死角（窗口还是丢），且引入启动期打断，兜底行为本身已让「隐藏窗口」在托盘缺失时不可能发生。

### D3: 兜底真退出复用既有 before-quit 链路，不新增退出分支

托盘缺失时关闭 = 真退出，走 `before-quit`（index.ts:276）→ `interceptInstallOnQuit`（更新就绪确认）→ `will-quit` 清理。零新增逻辑；与「托盘存在但用户手动关闭挂起开关」形态完全一致，无需差异化处理。

## Risks / Trade-offs

- [icons 子目录混入非运行时文件] → 现目录仅图标文件（KB 级）；tasks 中包含分发内容核查（产物内 icons 目录清单）。
- [仅 CI 打包才能端到端验证] → 本机 Windows 可直接 `bun run package:win` 产出 dist 并检查 `dist/win-unpacked/resources/icons`，再用 NSIS 静默安装实测托盘；tasks 已含该验证项。
- [Linux 桌面环境无法在本机验证] → CI 打包链路产出 Linux 产物后按既有 beta 验证节奏覆盖；spec 场景在三平台上的验收以 Windows 实测为准，Linux 行为由单测与配置统一性保障。

## Migration Plan

无数据迁移。合并后下一次 `release.yml` 打包自动生效；回滚即 revert 对应提交，无残留状态（托盘可用性是运行期内存状态，不落盘）。

## Open Questions

无——根因已由冒烟与产物取证实证，方案封闭。
