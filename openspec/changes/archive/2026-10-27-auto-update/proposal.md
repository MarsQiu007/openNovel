# Proposal: auto-update

## Why

桌面 app 目前「检查更新」是手动触发（用户点设置面板按钮），且 `electron-updater` 的 `autoDownload` 和 `autoInstallOnAppQuit` 都为 `false`——检查到更新后需要用户手动点下载、再手动点重启安装。这导致大部分用户不会及时更新，错过新功能和修复。本提案把更新链路改为「自动检查 → 后台自动下载 → titlebar 圆点轻提示 → 下次启动时自动应用」，让用户零操作即可保持最新。

## What Changes

- **桌面 main 进程自动下载**（desktop）：`autoUpdater.autoDownload` 从 `false` 改为 `true`，检查到更新后立即后台下载，无需用户确认。
- **桌面 main 进程退出时自动安装**（desktop）：`autoUpdater.autoInstallOnAppQuit` 从 `false` 改为 `true`，下次用户正常退出 app 时自动应用已下载的更新。
- **titlebar 圆点提示**（app）：当 updater 状态进入 `ready`（下载完成待重启）时，在 titlebar 显示一个小圆点标记；点击圆点弹出确认对话框，用户确认后立即重启安装。
- **设置面板加「启动时检查更新」开关**（app）：i18n 文案已存在（`settings.updates.row.startup.*`）但 UI 未实现，本次接上。

## 非目标

- 不做 Web 端（非桌面）的自动更新（用户已确认只有桌面 app）。
- 不加「自动下载更新」用户开关（用户确认默认开启即可）。
- 不做强制重启（用户选择「下次启动时应用」策略，不打扰当前工作）。
- 不改动 electron-updater 的检查频率（保持启动时 + 每 10 分钟）。
- 不实现「下载进度条」UI（`UpdaterState` 已有 `percent` 字段，titlebar 圆点不显示进度，未来需要再做）。

## Capabilities

### New Capabilities

- `auto-update`: 桌面 app 的自动更新语义——自动下载、退出时自动安装、下载完成后的轻量可见性（titlebar 圆点）、以及启动时检查的开关。

### Modified Capabilities

（无——既有 spec 无需求级行为变更）

## Impact

- **packages/desktop**：`src/main/updater.ts`（两个布尔值翻转）、`src/main/index.ts`（启动时恢复 ready 状态的通知逻辑）。
- **packages/app**：titlebar 圆点组件（新增文件）、设置面板「启动时检查更新」开关（`components/settings-v2/general.tsx`）、i18n 文案（`i18n/{zh,en,zht}.ts` 已有部分，补圆点 tooltip）。
- **零协议变更**：不改 HttpApi 形状，无需 `bun run generate`。
- **风险**：`autoInstallOnAppQuit: true` 在用户正常退出时静默应用更新，如果用户有未保存的工作，标准退出流程（用户主动关闭窗口）已隐含「放弃未保存工作」语义，与现有行为一致；`before-quit` 钩子会正常触发，sidecar 清理不受影响。
