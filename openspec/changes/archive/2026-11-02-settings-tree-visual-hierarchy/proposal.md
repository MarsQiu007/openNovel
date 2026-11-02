# Proposal: settings-tree-visual-hierarchy

## Why

设定树的层级只靠每级 12px 的纯缩进区分，无引导线、无类型图标、选中与悬停共用同一色块；滚动或长标题截断后，用户无法判断条目挂在哪个分类下，也扫视不到「当前在哪」。设定树是设定中心的高频导航入口，层级可读性直接决定设定管理效率。

## What Changes

- 设定树行结构改为 **VS Code 式三段行**：行首逐级引导线槽 + 收纳控件列 + 语义图标列 + 文本；可收纳节点渲染 chevron 与语义图标（书籍 / 世界观 / 分类 / 伏笔 / 风格 / 灵魂 / 技法库 / 整理 / 记忆 / 角色），叶子节点以语义图标占据父级收纳控件同列，同层级行控件列起点一致
- 每级缩进渲染 **1px 浅色引导线**（indent guide），缩进从 12px/级加大到 16px/级，深层级（板块 → 世界观 → 分类 → 条目）的父子关系视线可循
- 节点**选中态与悬停态分离**：选中节点用 accent 左侧 2px 指示条 + 微色块，悬停保持浅灰背景
- 板块头弱化 uppercase 排版（中文语境无大小写差异，改为加粗 + 层级色），分类组标题同步收敛为一致的分隔风格
- 在 `@opennovel-ai/ui` v2 图标注册表新增上述语义图标（内联 svg 条目），复用已有 `chevron-down` / `folder`
- 既有能力全部保留：待办 badge、退场角色 faded 态、搜索命中自动展开、新建入口、板块/分类收纳行为、节点路由

### 非目标

- **不做拖拽**与手动重排序——设定更新主要由 AI 通过流水线完成，树的职责是导航
- 不改三节信息架构、节点清单与归属关系（`setting-center-tree` 既有 requirement 全部不动）
- 不改搜索、新建、收纳、节点路由的交互行为与语义
- 不改中央区按节点渲染的任何行为
- 不新增数据模型、协议字段或 API

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `setting-center-tree`: 新增「设定树层级可视化」requirement，声明树行的引导线、图标列与选中/悬停状态分离的展示契约；既有 requirement 不修改

## Impact

- **packages/app**：`src/pages/novel/settings-tree.tsx` 为主要改动点（行组件 `SectionHeader` / `GroupRow` / `NodeRow` 的结构与样式重排），`settings-node.ts` 不变
- **packages/ui**：`src/components/icon.tsx`（设定树实际使用的 `@opennovel-ai/ui/icon` 注册表）新增 6 个语义图标条目（`book` / `map` / `zap` / `fire` / `library` / `user`），复用已有 `chevron-right` / `chevron-down` / `folder` / `pencil-line` / `checklist` / `brain`
- **packages/desktop**：无代码改动，随 app 界面共同受益
- **数据兼容性**：纯展示层变更，不涉及数据模型与持久化；i18n 仅在图标 aria-label 需要时补 key（en / zh / zht 三 locale 同步）
