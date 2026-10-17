# Proposal

## Why

titlebar 左上角的应用菜单按钮（Windows/Linux 下的汉堡菜单，点击展开 File / Edit / View / Go / Window / Help 下拉）是从 openCode 继承的遗留入口：菜单词汇全是编程工作台概念（New Session / Open Project / Toggle Terminal / Toggle File Tree），而 openNovel 主界面早已是书架 + 小说工作台，这些命令项在 novel 路由下因命令注册方缺失而整排灰显；真正还能点的条目（窗口控制、编辑、缩放）全部不经过菜单即可达（Chromium 内建快捷键、右键菜单、系统缩放通道）。该按钮在纯 Web 访问时还会显示、但其 action 点击静默无反应，属于持续的体验负资产。titlebar 已为 novel 场景提供原生入口（首页按钮、书架菜单、书籍标签栏），菜单按钮既冗余又误导，应移除。

## What Changes

- **BREAKING**（用户可见界面变更）：移除 Windows / Linux 桌面端 titlebar 的应用菜单按钮及 File / Edit / View / Go / Window / Help 下拉菜单（v2 与 legacy 两个 titlebar 变体均移除）。
- 移除 renderer 侧 `runDesktopMenuAction` 平台接口及 desktop 侧对应 IPC 通道（preload / ipc handle / renderer createPlatform 实现），其唯一消费者随菜单移除。
- 保留 `DESKTOP_MENU` 菜单数据表与 `packages/desktop/src/main/menu.ts` 原生菜单构建逻辑不动（macOS 仍在消费）。

## Capabilities

### New Capabilities

- `desktop-titlebar-menus`: 桌面端 titlebar 应用菜单入口的呈现约定——Windows / Linux 不渲染应用下拉菜单入口，编辑 / 缩放 / 窗口控制等能力由系统级通道承载；macOS 保留系统原生应用菜单。

### Modified Capabilities

（无）

## Impact

- **packages/app**：
  - `src/components/titlebar.tsx` 移除两处 `<WindowsAppMenu>` 渲染分支（v2 / legacy）
  - 删除 `src/components/windows-app-menu.tsx`，清理 `src/index.css` 中仅服务该组件的 `.desktop-app-menu` 死样式
  - `src/context/platform.tsx` 移除 `runDesktopMenuAction` 接口（desktop renderer 的 createPlatform 实现一并移除）
  - `src/desktop-menu.ts` 数据表保留不动（macOS 原生菜单消费方）
- **packages/desktop**：
  - `src/preload/index.ts`、`src/preload/types.ts` 移除 `runDesktopMenuAction` 桥接
  - `src/main/ipc.ts` 移除对应 `ipcMain.handle`
  - `src/renderer/index.tsx` 移除 createPlatform 中的实现
  - `src/main/desktop-menu-actions.ts` 与 `src/main/menu.ts` 保留（macOS 原生菜单仍使用）
- **无数据模型变更**：不涉及本地数据迁移，无兼容性影响。
- **无 i18n 变更**：菜单文案为数据表内硬编码英文，不走 locale 文件。
- **浏览器端副作用（正向）**：Windows 浏览器访问时 titlebar 不再显示该菜单按钮（此前 action 项点击无反应）。
- **开发入口变化**：开发构建下打开 DevTools 从菜单项改为右键 Inspect（electron-context-menu 开发模式默认提供）；生产环境无影响。

## 非目标

1. 不修改 macOS 原生应用菜单及其词汇（New Session / Open Project 等 openCode 遗留词汇在 macOS 上记录为已知事项，如需 novel 化重写属后续独立提案，且需在 macOS 机器上验收）。
2. 不改动 `DESKTOP_MENU` 数据表的结构与条目。
3. 不为 Reset Zoom 新增独立 UI 入口（系统缩放通道与 pinch 开关保持不变）。
4. 不迁移 Help 菜单中的 Share Feedback / Report a Bug 外链（随菜单一并移除；如后续需要可在设置页补充）。
5. 不改动 titlebar 其他区域（首页按钮、书架菜单、书籍标签栏、右侧窗口控制与更新指示）。
