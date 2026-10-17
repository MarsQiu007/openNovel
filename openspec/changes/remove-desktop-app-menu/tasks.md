# Tasks

## 1. 移除应用菜单组件与渲染点（packages/app）

- [x] 1.1 移除 `titlebar.tsx` 中 v2 与 legacy 两个变体的 `<WindowsAppMenu>` 渲染分支及配套 `<Show when={windows() || linux()}>` 包裹（仅删包菜单的那一处；v2 分支中服务于 tauri 窗口装饰的 `<Show when={windows() && !electronWindows()}>` 保留），清理仅服务于菜单的 import（`./windows-app-menu`）；验证：`packages/app` 下 `bun typecheck` 通过
- [x] 1.2 删除 `packages/app/src/components/windows-app-menu.tsx`，清理 `index.css:33-88` 中仅被该组件使用的 `.desktop-app-menu` / `desktop-app-menu-heading` / `desktop-app-menu-keybind` / `desktop-app-menu-chevron` 死样式（注意 :76 与 :84 两个 data-slot 选择器紧邻其他存活样式，只删这两个规则块），全仓检索确认无残留引用；验证：`packages/app` 下 `bun typecheck` 通过且 `bun test --preload ./happydom.ts ./src` 中既有用例（含 `desktop-menu.test.ts`）全部通过

## 2. 清理平台接口（app 接口 + desktop renderer 实现）

- [x] 2.1 移除 `app/context/platform.tsx` 中 `runDesktopMenuAction` 字段及其对 `DesktopMenuAction` 类型的导入；验证：`packages/app` 下 `bun typecheck` 通过
- [x] 2.2 移除 `desktop/src/renderer/index.tsx` 中 createPlatform 的 `runDesktopMenuAction` 实现（含 Platform 对象上 :301 附近的字段挂载点），并清理仅被该实现使用的 import（`webview-zoom.ts` 的 `zoomIn` / `zoomOut` / `resetZoom`；`webviewZoom` / `setPinchZoomEnabled` 保留）；验证：`packages/desktop` 下 `bun typecheck` 通过

## 3. 清理 desktop IPC 死通道

- [x] 3.1 移除 `desktop/src/preload/types.ts` 与 `desktop/src/preload/index.ts` 中的 `runDesktopMenuAction` 类型与桥接方法；验证：`packages/desktop` 下 `bun typecheck` 通过
- [x] 3.2 移除 `desktop/src/main/ipc.ts` 中对应 `ipcMain.handle`，确认 `main/menu.ts` 对 `desktop-menu-actions.ts` 与 `@opennovel-ai/app/desktop-menu` 的直接 import 全部仍可解析（macOS 链路不受影响）；验证：`packages/desktop` 下 `bun typecheck` 通过

## 4. 回归与人工验收

- [x] 4.1 运行 `packages/app` 全量单测（`bun test --preload ./happydom.ts ./src`）确认无回归；验证：全部通过
- [x] 4.2 从仓库根目录对全部改动文件运行 oxlint（子包目录直接跑会触发 typeAware 报错）；验证：无新增告警
- [x] 4.3 以 `bun run dev:desktop` 启动桌面端人工验收：titlebar 无菜单按钮；输入框内 Ctrl+Z / Ctrl+V 生效；右键输入框出现含复制/粘贴的上下文菜单；Ctrl+滚轮缩放与 F11 全屏生效；页面空白处右键可 Inspect 打开 DevTools；验证：逐项观察符合预期
- [x] 4.4 以浏览器访问 Web 端（`bun run dev:all` 或等价方式）人工验收：Windows 浏览器下 titlebar 无菜单按钮，首页按钮为左侧首个入口；验证：观察符合预期
- [x] 4.5 复核 macOS 保留边界：`git diff` 确认 `desktop/src/main/menu.ts`、`desktop/src/main/desktop-menu-actions.ts`、`app/src/desktop-menu.ts` 无任何改动；验证：diff 为空

## Implementation Commits

- `8dce82be` feat(app): 移除 Windows/Linux titlebar 应用菜单入口
- `3f84a677` refactor(desktop): 清理 runDesktopMenuAction IPC 死通道

## Workflow follow-up

- 实现提交遵循仓库约定：conventional commit + `OpenSpec-Change: remove-desktop-app-menu` footer，一个提交一个 change-id。
- 合并前刷新本地 `main`，优先 `git merge --ff-only`；推送后确认 CI 全绿再归档。
- 归档时运行 `openspec validate remove-desktop-app-menu --strict`，同步主 specs 后归档，归档移动单独提交。
