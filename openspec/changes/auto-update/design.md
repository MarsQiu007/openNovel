# Design

## Context

参见 proposal.md。补实现所需的现状：

- `packages/desktop/src/main/updater.ts:18-19`：`autoUpdater.autoDownload = false`、`autoUpdater.autoInstallOnAppQuit = false`——本次都改为 `true`。
- `packages/desktop/src/main/updater-controller.ts`：状态机 `idle → checking → downloading → ready → installing`。`ready` 状态已通过 `UpdaterReadyRecord` 持久化到 `electron-store`（key `"opennovel.updater"`），重启后可恢复。
- `packages/desktop/src/main/index.ts:303-305`：`updater.start()` + `setInterval(() => updater.check(), 10 * 60 * 1000)`。`updater.start()` 已会读持久化的 ready 记录并恢复状态。
- `packages/app/src/updater.ts`：`UpdaterState` 类型已含 `downloading` / `ready` 状态。
- `packages/app/src/components/updater-action.ts`：renderer 已通过 IPC 订阅 updater 状态。
- i18n 已有 `settings.updates.row.startup.title/description`（启动时检查更新），UI 未接上。
- titlebar 现有右侧 mount 点（`session-header.tsx` 用 `useTitlebarRightMount`），可复用。

## Goals / Non-Goals

**Goals:**

- 检查到更新后自动后台下载，无需用户确认。
- 用户退出时自动应用已下载的更新。
- 下载完成后 titlebar 显示圆点，点击可重启安装。
- 设置面板加「启动时检查更新」开关。

**Non-Goals:**

- 不改动检查频率。
- 不实现下载进度条。
- 不加用户开关关闭自动下载。
- 不改 Web 端更新逻辑。

## Decisions

### D1：autoDownload / autoInstallOnAppQuit 直接改 updater.ts 的默认值

**选择**：直接修改 `packages/desktop/src/main/updater.ts:18-19` 两个布尔值。

**理由**：这两个标志是 electron-updater 的内置语义，`true` 时行为完全符合需求（自动下载、退出时自动安装）。无需新增代码逻辑，改默认值即可。

**注意**：`autoDownload: true` 时 electron-updater 内部会在 `checkForUpdates` 返回 `update-available` 后自动调 `downloadUpdate`，与 `updater-controller.ts` 的 `check()` 流程兼容——`controller.check()` 里的 `downloadUpdate()` 调用会成为 no-op（因为已在下载），需要验证 controller 状态机不因此卡死。

**风险缓解**：electron-updater 的 `downloadUpdate` 在已在下载时返回相同的 Promise（不会重复下载），controller 里的 `await input.backend.downloadUpdate()` 会正常 resolve。状态机从 `downloading` 进入 `ready` 由 `update-downloaded` 事件触发，controller 里已通过 `persistence.set` 持久化。

### D2：titlebar 圆点用现有 updater 状态订阅机制

**选择**：在 `app` 包新增 `UpdaterDot` 组件（小圆点），订阅 `platform.updater.state()`，`status === "ready"` 时显示。点击调 `platform.updater.install()`。

**理由**：renderer 已通过 `updater-subscriptions` IPC 收到状态推送，无需新增 IPC channel。复用现有 `UpdaterPlatform` 接口。

**挂载点**：复用 `useTitlebarRightMount`（与 `session-header.tsx` 相同模式），在 titlebar 右侧 mount 一个绝对定位的小圆点。

**替代**：新增 IPC channel 推送圆点显示事件——被否，因为现有状态订阅已够用，新增 channel 增加耦合。

### D3：启动时检查更新开关用 settings.general 存储

**选择**：开关状态存到 `settings.general.checkUpdatesOnStartup`（命名与现有 `releaseNotes` 等一致），设置面板用现有 `Switch` 组件。

**理由**：与现有 `settings.general.releaseNotes` 等开关一致；`serverSync` 已管理 `general` 配置段，无需新增存储机制。

**默认**：`true`（开启）。

**接线**：desktop main 启动时读 config（通过 sidecar 或独立存储），决定是否调 `updater.start()`。目前 `index.ts:303` 是无条件调 `updater.start()`，需要改为条件判断。

**注意**：desktop main 不直接访问 `serverSync`（它在 renderer）。启动时检查的开关需要通过 electron-store 或环境变量传给 main。

**简化**：把开关状态通过 `electron-store` 存到 main 进程的 store，renderer 设置面板写入时通过 IPC 同步到 main。这与现有 `electron-store` 用法一致。

### D4：圆点点击后的确认对话框用现有 dialog 系统

**选择**：点击圆点后调 `platform.updater.install()`（已有接口），它内部已处理 `quitAndInstall`。

**理由**：现有 `UpdaterController.install()` 已实现完整流程（stop sidecars → quitAndInstall）。无需新增确认对话框组件——直接调 `install()`，electron-updater 内部会处理重启。

**但**：现有 `install()` 是无确认的——点击就立即重启。需要加确认步骤。

**修正**：在 `UpdaterDot` 组件里用现有的 `showToast` + 确认对话框模式（参考 `dialog-release-notes.tsx` 的交互），用户确认后才调 `install()`。

## Risks / Trade-offs

- **风险**：`autoInstallOnAppQuit: true` 时，用户退出可能延迟（应用更新需要时间）。→ 缓解：electron-updater 的 quitAndInstall 在 `before-quit` 钩子中执行，通常 < 5s，可接受。
- **风险**：`autoDownload: true` 增加网络流量（每次检查到新版本都下载）。→ 缓解：检查频率 10 分钟，下载仅在发现新版本时发生，流量可忽略。
- **风险**：titlebar 圆点可能遮挡其他 UI。→ 缓解：圆点直径 8px，绝对定位在 titlebar 右侧，z-index 低，不影响其他元素交互。

## Migration Plan

无数据迁移。改动后现有用户下次启动时自动生效（如果已有 ready 状态的持久化记录，启动后会直接显示圆点）。

## Open Questions

无。
