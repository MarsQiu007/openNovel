# Proposal: setting-center-tree

## Why

设定类信息目前散在五处：世界观条目在左栏「设定」分段、角色在右栏随行面板、写作风格/灵魂/整理是中央阅读器的子 tab、关系图与地图占着章节模式的主区 tab、书籍信息（书名/简介/类型）又和风格规则混编在头部编辑表单里。书级管理数据没有统一的家，写到几十章后条目一多，查找与维护成本持续上升。业界主流写作工具（NovelCrafter Codex、Campfire、LegendKeeper）的成熟形态是「左侧少数可收纳板块 + 中间 master-detail + 条目详情内按类型切换显示标签」，本变更按此形态重构设定中心。

## What Changes

- **设定树**：左栏「设定」分段内部改为三节可收纳树——书籍内容（书籍信息 / 世界观条目分类子树 / 伏笔）、AI 设定（写作风格 / 灵魂 / 技法库 / 整理）、角色（角色列表）；树顶统一搜索框跨条目与角色过滤；三节的展开/收纳状态按书记忆；新建世界观条目入口由树承接（原表单在被替换的 world-sidebar 中），新建角色沿用角色列表内既有表单。
- **节点路由与显示标签**：中央区按树选中节点渲染；每个节点类型声明自己的显示标签组——世界观条目为「内容 / 编辑」，角色为「内容 / 编辑 / 图（该角色 ego 关系图）」，世界观节 root 为「列表 / 地图」，角色节 root 为「列表 / 关系图」，其余节点（书籍信息 / 伏笔 / 风格 / 灵魂 / 技法库 / 整理）为单页形态。「图」在 v1 是可视化视图（关系图、地图），标签框架为后续图片画廊预留位置。
- **主区 tab 收缩（BREAKING）**：章节模式主区视图从「阅读 / 写作 / 关系 / 地图 / 画布」收缩为「阅读 / 写作 / 画布」；关系图迁入设定树角色节、地图迁入世界观节。旧 `?tab=relations` / `?tab=map` 书签以 replace 重定向到设定树对应节点。
- **书籍信息归位（BREAKING）**：头部「编辑」按钮改为跳转到设定树「书籍信息」节点；原头部编辑表单拆分为「书籍信息（书名/简介/类型）」与「写作风格（tone/pov/tense/rules/篇幅限制）」两个单一数据源节点，消除同一字段两处可改的重复；篇幅限制复选框随风格字段迁入写作风格节点（`chapter-length-limit` 的 UI 落点需求同步修订）。
- **右栏双镜头保留**：角色 / 技法库 / 伏笔的右栏随行面板（章节上下文镜头）保持原样不动；设定中心是书级管理镜头。两侧复用同一组件与查询缓存，无逻辑重复。
- **按书状态迁移**：`perBookState` 新增 `settingsNode`（树选中节点）与 `settingsCollapsed`（板块收纳）字段；旧 `worldEntryId` / `relationCharacterId` 读取时迁移，失效补校验逻辑随新字段重写。
- **生态位预留**：「整理」节点为 setting-review-hub 的收件箱入口与数量徽标预留位置（其实现仍在该提案内完成）；「图」标签框架为二期图片画廊预留。

## 非目标

- 不做图片存储与画廊视图（schema 现无任何图片字段；列为二期独立提案 `setting-entry-gallery`，本变更仅留标签框架）。
- 不删除、不改动右栏任一随行面板（角色/技法库/伏笔/张力/结构/批注/审查/AI 产出/对话）的行为。
- 不改动设定数据模型、Protocol/HttpApi 契约与 SDK（本变更为纯 app 层信息架构重构，不运行 `bun run generate`）。
- 不实现 setting-review-hub 的收件箱与成果审阅页（仅预留树节点与徽标位；该提案的 app 部分随后 rebase 到设定树）。
- 不改动左栏「章节」「大纲」两个分段与章节阅读/写作/画布视图本身。
- 不治理世界观分类自由文本的脏数据（沿用既有设定整理通路）。

## Capabilities

### New Capabilities

- `setting-center-tree`：设定中心的信息架构——三节可收纳设定树（书籍内容 / AI 设定 / 角色）、跨实体统一搜索、树节点到中央区的路由、按节点类型声明的显示标签组（内容 / 编辑 / 图）、树板块收纳状态的按书记忆。

### Modified Capabilities

- `novel-workspace-layout`：主区视图集合从五视图收缩为三视图（关系/地图迁出）；左栏「设定」分段内部结构由「列表 + 中央子 tab」改为设定树 + 节点路由；头部编辑入口由就地表单改为跳转设定树。
- `novel-workspace-per-book-state`：按书记忆的内容选择状态新增设定树选中节点与树板块收纳状态；旧 `worldEntryId` / `relationCharacterId` 存档的读取迁移与失效回落语义；「布局状态保持全局」需求显式切出树板块收纳（属内容现场而非布局）。
- `chapter-length-limit`：篇幅限制复选框的 UI 落点从「书籍编辑弹窗」（头部就地表单）迁到设定树「写作风格」节点表单，回填与写入语义不变。

## Impact

- **packages/app**：唯一受影响包。左栏设定分段（world-sidebar / world-reader 拆解替换为设定树与节点路由）、workspace-frame 主区 tab 与头部编辑入口、perBookState 持久化结构与恢复 effect、RelationsView / MapView / PanelCharacters / PanelTechniques / PanelForeshadow / StyleGuideEditor / NovelSoulEditor / SettingOrganizationPanel 的容器适配（组件本体复用）、WorldEntryDetail / CharacterDetail 编辑态改受控（向后兼容，relations-view 抽屉用法不变）、i18n 三语新增树节点标签、相关 unit 测试（workspace-data.test.ts 等）与 e2e（`book-open-transition.spec.ts` 的 `data-slot="world-sidebar"` 探针）随迁移更新。
- **packages/desktop**：无独立改动（随 app 生效）。
- **packages/novel-store / plugin / opennovel / schema / protocol / client**：无改动。
- **兼容性**：本地数据零迁移——perBookState 旧字段读取时迁移、失效安全回落语义不变；旧 `?tab=relations|map` URL 重定向而非报错；所有设定数据（世界观条目、角色、关系、伏笔、风格、灵魂、技法）读写通路不变。
