# Tasks

## 1. desktop main 进程自动下载 + 退出时安装

- [x] 1.1 `packages/desktop/src/main/updater.ts`：`autoUpdater.autoDownload` 从 `false` 改为 `true`；`autoUpdater.autoInstallOnAppQuit` 从 `false` 改为 `true`；验证 `bun typecheck`（在 `packages/desktop`）通过

## 2. titlebar 圆点提示

- [x] 2.1 复用现有 titlebar `TitlebarUpdate` pill 组件（`titlebar.tsx:129-140` 已根据 `platform.updater.state()` 显示/隐藏）；在 `layout-new.tsx` 和 `layout.tsx` 的 `install()` 中加确认对话框（`DialogUpdaterConfirm`），用户确认后才调 `platform.updater.install()`；验证 `bun typecheck`（在 `packages/app`）通过

## 3. 设置面板「启动时检查更新」开关

- [x] 3.1 `packages/app/src/context/settings.tsx`：`Settings` 接口和 `defaultSettings` 新增 `checkUpdatesOnStartup: boolean`（默认 `true`），并暴露 getter/setter
- [x] 3.2 `packages/app/src/components/settings-v2/general.tsx`：在 UpdatesSection 加「启动时检查更新」开关（i18n key 已存在：`settings.updates.row.startup.*`），状态绑定到 `settings.general.checkUpdatesOnStartup`；验证 `bun typecheck` 通过
- [x] 3.3 `packages/desktop/src/main/index.ts`：启动时从 `electron-store` 读 `checkUpdatesOnStartup`，为 `false` 时跳过 `updater.start()`；验证 `bun typecheck`（在 `packages/desktop`）通过
- [x] 3.4 无需新增 IPC channel：renderer 通过现有 `storeGet`/`storeSet` IPC 读写 electron-store，main 直接 `getStore().get("checkUpdatesOnStartup")` 读取

## 4. i18n 文案

- [x] 4.1 `settings.updates.row.startup.*` 三语已存在，无需新增；补 `dialog.updaterConfirm.*` 三语文案

## 5. 集成验证

- [x] 5.1 在 `packages/desktop` 跑 `bun typecheck` 通过
- [x] 5.2 在 `packages/app` 跑 `bun typecheck` 通过
- [x] 5.3 未涉及 ui 包改动，跳过
- [ ] 5.4 手动验证：启动 dev 桌面 app，在 DevTools Console 执行 `require("electron").ipcRenderer.send("updater:simulate-ready", { version: "9.9.9" })`（或等效手段）模拟 `ready` 状态，确认 titlebar 圆点显示、点击弹出确认对话框、确认后触发安装流程

## Implementation Commits

- `ad5174af11` feat(desktop): 自动下载更新、退出时自动安装、titlebar 圆点确认重启、启动检查开关

## Workflow follow-up

- 用 `git log --grep "OpenSpec-Change: auto-update" --format="%h %s"` 收集实现提交写入本文件 `## Implementation Commits`。
- 运行 `npx openspec validate auto-update`。
- 用 `npx openspec archive auto-update --yes` 归档。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送。
- 通知用户验收。
