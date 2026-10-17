# Design

## Context

现状链路（探索已核实，详见 proposal.md 的动机）：

```
Windows / Linux（含浏览器访问）
  titlebar.tsx  v2 分支 :413 与 legacy 分支 :515
    -> <WindowsAppMenu>（windows-app-menu.tsx）
         -> DESKTOP_MENU 数据（desktop-menu.ts，openCode 遗留词汇）
         -> command 系统（session.new / settings.open 等，路由作用域注册）
         -> platform.runDesktopMenuAction（action 项）

platform.runDesktopMenuAction 链路：
  app/context/platform.tsx（接口定义）
    -> desktop/renderer/index.tsx createPlatform（view.resetZoom/zoomIn/zoomOut 本地走 webview-zoom.ts，其余转发）
      -> preload runDesktopMenuAction（IPC handle）
        -> main/ipc.ts -> main/desktop-menu-actions.ts

macOS（本次不动）：
  main/menu.ts（仅 darwin 构建）直接消费 DESKTOP_MENU + desktop-menu-actions.ts，不经 IPC
```

命令注册是组件作用域的（`command.register` 随组件卸载注销）：novel 工作台与书架路由下，File/View/Go 菜单的命令项注册方不存在，菜单整排灰显；action 项在纯 Web 端为哑点击。`desktop-menu.test.ts` 仅断言 DESKTOP_MENU 数据（logs.export 条目），不依赖组件。

## Goals / Non-Goals

**Goals:**

- Windows / Linux titlebar（v2 与 legacy 两变体）不再渲染应用菜单按钮；浏览器端同。
- 移除 `runDesktopMenuAction` 整条 renderer 平台接口与 desktop IPC 死通道，消费者清零后无残留。
- macOS 原生菜单链路（`menu.ts` / `desktop-menu-actions.ts` / `DESKTOP_MENU` 表）零改动。

**Non-Goals:**

- 不删除 `windows-app-menu.tsx` 以外的组件；titlebar 其余区域（首页按钮、书架菜单、书籍标签、右侧窗口控制/更新指示）不动。
- 不清理 `DESKTOP_MENU` 中 Windows 专属条目（数据表声明不动；macOS 消费的表结构保持原样）。
- 不为 Reset Zoom 补新入口；不迁移 Help 外链（见 proposal.md 非目标）。

## Decisions

### D1：组件与其渲染点一并删除，不做「保留隐藏」

删除 `windows-app-menu.tsx`，同时移除 titlebar 两处 `<Show when={windows() || linux()}>` 包裹的 `<WindowsAppMenu>` 渲染分支，并清理仅被该组件使用的样式残留（`index.css` 中 `.desktop-app-menu` 等六个规则块与 `desktop-app-menu-keybind` / `desktop-app-menu-chevron` 两个 data-slot 规则块）。

- 理由：组件无任何其他消费者；保留隐藏组件是无谓的技术债。删除后 `commandDisabled` / `rememberFocus` 等辅助逻辑随之消失，无外部引用。
- 替代方案：保留组件仅以 feature flag 关闭——被否，flag 没有重新开启的合理场景。

### D2：`runDesktopMenuAction` 平台接口与 IPC 通道整体移除

随菜单移除，该接口的消费者清零，四端一并清理：

1. `app/context/platform.tsx`：移除 `runDesktopMenuAction` 字段及 `DesktopMenuAction` 类型导入；
2. `desktop/renderer/index.tsx`：移除 createPlatform 中的 `runDesktopMenuAction` 实现，并清理仅被该实现使用的 import（`webview-zoom.ts` 的 `zoomIn` / `zoomOut` / `resetZoom`——`webviewZoom` / `setPinchZoomEnabled` 仍被 Platform 其他字段使用，保留）；
3. `desktop/preload`（`index.ts` + `types.ts`）：移除桥接方法与类型；
4. `desktop/main/ipc.ts`：移除对应 `ipcMain.handle`。

- 理由：死通道保留会继续误导后续开发者以为存在合法调用方。
- 保留边界：`desktop/main/desktop-menu-actions.ts` 不删——macOS `menu.ts` 直接 import 使用（不经 IPC）。
- 替代方案：标记 deprecated 保留——被否，本仓库无 deprecation 流程，死代码直接删除。

### D3：macOS 链路零改动的验证方式

`menu.ts` 对 `DESKTOP_MENU` / `desktopMenuVisible` / `DesktopMenuRole` 等的消费方式不变；D2 清理的 preload 通道 macOS 本来就不经过（macOS action 由 main 进程直接派发）。

- 验证：`bun typecheck`（desktop 包）确认 `menu.ts` 的 import 全部仍解析；无运行时验证条件（Windows 开发机），接受静态验证。

### D4：不动公开 Protocol / HttpApi

本次仅触及 desktop 私有 preload 契约与 app 内部平台接口，不涉及 `packages/protocol` 或 Server HttpApi。

- 结论：无需在 `packages/client` 运行 `bun run generate`，`src/generated*` 不受影响。

## Risks / Trade-offs

- [dev 构建打开 DevTools 的入口从菜单变为右键 Inspect] → 实施验收时以 `bun run dev:desktop` 实测右键 Inspect 可打开 DevTools（electron-context-menu 开发模式默认提供 Inspect 项，当前 `main/index.ts` 初始化未覆盖该默认）。
- [菜单 Reload 无替代入口] → dev 有 electron-vite HMR，生产 reload 无必要场景；接受损失，记录在 proposal 非目标。
- [移除 import 时误删 `webviewZoom` / `setPinchZoomEnabled` 的存活引用] → 以 `bun typecheck`（desktop 包）兜底；tasks 中列专项检查步。
- [`desktop-menu.test.ts` 误伤] → 该测试只读 `DESKTOP_MENU` 数据表，D1/D2 均不动数据表；app 包测试跑一轮确认。
- [浏览器端 Windows titlebar 布局变化] → 菜单按钮移除后首页按钮成为左侧首个元素，属预期变更（spec 已约束无菜单入口）。

## Migration Plan

无数据迁移，纯代码删除；回滚策略为 revert 对应提交。

## Open Questions

（无——所有决策点已在 Decisions 落定，验证项全部进入 tasks。）
