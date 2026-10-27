# Tasks

## 1. desktop main 进程自动下载 + 退出时安装

- [ ] 1.1 `packages/desktop/src/main/updater.ts`：`autoUpdater.autoDownload` 从 `false` 改为 `true`；`autoUpdater.autoInstallOnAppQuit` 从 `false` 改为 `true`；验证 `bun typecheck`（在 `packages/desktop`）通过

## 2. titlebar 圆点提示

- [ ] 2.1 `packages/app/src/components/titlebar/updater-dot.tsx`：新增 `UpdaterDot` 组件，订阅 `platform.updater.state()`，`status === "ready"` 时显示圆点；点击后弹确认对话框，用户确认后调 `platform.updater.install()`；验证 `bun typecheck`（在 `packages/app`）通过
- [ ] 2.2 `packages/app/src/components/titlebar/index.ts`：导出 `UpdaterDot`；验证 import 路径正确
- [ ] 2.3 `packages/app/src/app.tsx` 或 `session-header.tsx`：在 titlebar 右侧 mount `UpdaterDot`；验证 `bun typecheck` 通过

## 3. 设置面板「启动时检查更新」开关

- [ ] 3.1 `packages/app/src/context/global-sync/` 相关文件：在 `settings.general` 配置结构中新增 `checkUpdatesOnStartup: boolean` 字段（默认 `true`），确保 electron-store 跨进程同步；验证 `bun typecheck` 通过
- [ ] 3.2 `packages/app/src/components/settings-v2/general.tsx`：在 UpdatesSection 加「启动时检查更新」开关（i18n key 已存在：`settings.updates.row.startup.*`），状态绑定到 `settings.general.checkUpdatesOnStartup`；验证 `bun typecheck` 通过
- [ ] 3.3 `packages/desktop/src/main/index.ts`：启动时从 `electron-store` 读 `checkUpdatesOnStartup`，为 `false` 时跳过 `updater.start()`；验证 `bun typecheck`（在 `packages/desktop`）通过
- [ ] 3.4 `packages/desktop/src/main/ipc.ts` + `preload`：加 IPC channel 让 renderer 写入开关状态时同步到 main 进程的 `electron-store`；验证 `bun typecheck` 通过

## 4. i18n 文案

- [ ] 4.1 `packages/app/src/i18n/zh.ts`、`en.ts`、`zht.ts`：确认 `settings.updates.row.startup.title/description` 三语已存在（经 grep 确认已有），无需新增；若 typecheck 报缺失则补齐

## 5. 集成验证

- [ ] 5.1 在 `packages/desktop` 跑 `bun typecheck` 通过
- [ ] 5.2 在 `packages/app` 跑 `bun typecheck` 通过
- [ ] 5.3 在 `packages/ui` 跑 `bun typecheck` 通过（若第 2 步涉及 ui 包改动）
- [ ] 5.4 手动验证：启动 dev 桌面 app，在 DevTools Console 执行 `require("electron").ipcRenderer.send("updater:simulate-ready", { version: "9.9.9" })`（或等效手段）模拟 `ready` 状态，确认 titlebar 圆点显示、点击弹出确认对话框、确认后触发安装流程

## Workflow follow-up

- 用 `git log --grep "OpenSpec-Change: auto-update" --format="%h %s"` 收集实现提交写入本文件 `## Implementation Commits`。
- 运行 `npx openspec validate auto-update`。
- 用 `npx openspec archive auto-update --yes` 归档。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送。
- 通知用户验收。
