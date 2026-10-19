# Design: setting-center-tree

## Context

现状代码事实（动机见 proposal.md）：

- 左栏「设定」分段 = `world-sidebar.tsx`（世界观条目列表）+ `world-reader.tsx`（中央四子 tab：条目 / 风格 / 灵魂 / 整理）；`workspace-frame.tsx` 以 `leftMode`（chapters/outlines/world）切换左栏，主区按 `leftMode` + `?tab=` 渲染。
- 角色（`panel-characters.tsx`）、技法库（`panel-techniques.tsx`）、伏笔（`panel-foreshadow.tsx`）挂在右栏 rail；关系图（`relations-view.tsx`）、地图（`map-view.tsx`）占章节模式主区 `?tab=relations|map`；头部「编辑」就地展开书名/简介/类型与风格字段的混合表单（workspace-frame L968-1018）。
- 按书选择态存于 `perBookState`（`novel.workspace.state.v1`）：`leftMode` / `outline` / `worldEntryId` / `relationCharacterId` / `sessionId`；恢复与失效补校验在 workspace-frame「首帧收敛」区块（L362-461）。
- `RelationsView` 已支持以某角色为中心的 ego 图（`selectedCharacterId` 受控）；`CharacterDetail`、`SettingOrganizationPanel`、`PanelTechniques`、`PanelForeshadow`、`MapView` 均为可整体搬迁的现成组件；`WorldEntryDetail` / `StyleGuideEditor` / `NovelSoulEditor` 是 world-reader.tsx 的内部组件，需先抽出为独立模块再挂载；条目详情内含段落批注链路（AnnotationPanel + onExecute/onSessionFocused），必须原样平移。

## Goals / Non-Goals

**Goals:**

- 设定树（三节可收纳 + 分类子组 + 统一搜索）替换 world-sidebar；中央区改为「按节点路由 + 按节点类型显示标签」的单一路由组件，替换 world-reader 的四子 tab 套娃。
- 关系图、地图迁入设定树标签位；主区 `?tab` 视图集合收缩为 reading/writing/canvas，旧地址 replace 重定向。
- 头部编辑入口收敛为跳转；书籍信息与写作风格表单拆分。
- perBookState 新增 `settingsNode`，旧字段读取迁移；全部既有组件与查询通路复用，零协议变更。

**Non-Goals:**

- 不改 rail 面板的任何行为（双镜头：rail = 章节随行，设定树 = 书级管理）。
- 不做条目/角色的图片字段与画廊（二期 `setting-entry-gallery`）。
- 不实现 setting-review-hub 收件箱（仅「整理」节点留位）。
- 不调整「章节」「大纲」分段与画布视图。

## Decisions

### D1 设定树为新组件 `settings-tree.tsx`，节点用判别联合建模

```
type SettingsNode =
  | { kind: "book-info" }
  | { kind: "world" }                       // 世界观板块 root → 列表/地图标签
  | { kind: "world-entry"; entryId: string }
  | { kind: "foreshadow" }
  | { kind: "style" } | { kind: "soul" }
  | { kind: "techniques" } | { kind: "organization" }
  | { kind: "characters" }                  // 角色板块 root → 列表/关系图标签
  | { kind: "character"; characterId: string }
```

判别联合保证「按节点类型声明显示标签组」在类型层可穷尽（`switch (node.kind)` 全分支覆盖，新增节点类型时编译器逼出所有挂接点）。树的渲染数据（世界观分类子组、角色列表）来自既有 `useWorldEntries` / `useCharacters` 查询缓存，不新增请求；分类子组沿用 world-sidebar 的 grouped 逻辑（自由文本原样、未分类兜底、计数）。

备选：扁平字符串 id（`"world:<id>"`）——被否：可穷尽性差、标签组声明要另建映射表；但 `settingsNode` 的**持久化形态**仍序列化为字符串（见 D4）。

### D2 中央区单一路由组件 `settings-main.tsx`，显示标签组为节点类型的纯函数

`displayTabs(node): ["content","edit"] | ["content","edit","graph"] | ["list","map"] | ["list","graph"] | null`，组件按 node.kind 挂载既有组件：

| node.kind | 标签 | 挂载 |
|---|---|---|
| world-entry | 内容 / 编辑 | WorldEntryDetail（含批注链路原样；编辑态改受控，见下） |
| character | 内容 / 编辑 / 图 | CharacterDetail（编辑态改受控）/ RelationsView（selectedCharacterId 受控为该角色） |
| world | 列表 / 地图 | 世界观概览列表（新轻组件）/ 现 MapView |
| characters | 列表 / 关系图 | 现 CharacterList（加 `hideSearch` props，搜索由树顶统一承载）/ 现 RelationsView |
| book-info | 无 | 书籍信息表单（头部编辑态拆分出的元数据部分） |
| foreshadow / style / soul / techniques / organization | 无 | 现 PanelForeshadow / StyleGuideEditor / NovelSoulEditor / PanelTechniques / SettingOrganizationPanel |

**受控编辑态改造**：WorldEntryDetail 与 CharacterDetail 的 `isEditing` 目前内部自持，标签条无法从外切换。两组件增加可选受控 props（`editing` + `onEditingChange`）；不传时回落内部自持——relations-view 抽屉对 CharacterDetail 的既有用法与 rail 用法零改动。受控时「内容/编辑」标签直接驱动该 props，草稿的条目切换重置语义保持现状。

**标签选中态持久化边界**：标签态是 `settings-main` 内局部 signal，按节点 id reset，不进 URL、不进 perBookState；唯一的跨组件诉求（旧地址重定向要落在 graph/map 标签）由一次性内存 `pendingTab` 解决（见 D3），刷新后恢复永远落默认标签，恢复矩阵不膨胀。

备选：标签态入 perBookState——被否：恢复维度 ×标签 ×节点 组合爆炸，收益低。

### D3 主区 tab 收缩与旧地址重定向放在 activeTab 解析层

`activeTab()` 遇 `relations` / `map` 时返回既有默认值，另设一个重定向 effect（首帧收敛区块内）：检测旧值 → 写入 `settingsNode`（relations→characters 板块、map→world 板块）→ 置一次性内存 `pendingTab`（分别为 graph / map，settings-main 首帧消费后清除，不落盘、不进恢复矩阵）→ `changeLeftMode("world")` → `setSearchParams({tab: undefined}, {replace: true})`。replace 保证历史无中间条目；重定向发生在首帧门关闭期间，用户不可见旧视图闪现。

备选：保留 relations/map 作为合法 tab 值做「兼容别名」长期共存——被否：两个渲染同一视图的入口会让 perBookState/URL 同步逻辑长期双写。

### D4 perBookState 增量演进：新增 `settingsNode` 字符串，旧字段只读迁移

```ts
type PerBookState = {
  leftMode?: "chapters" | "outlines" | "world"
  outline?: OutlineTarget
  settingsNode?: string        // "book-info" | "world" | "world-entry:<id>" | "character:<id>" | ...
  settingsCollapsed?: string[] // 已收纳的一级板块 key 列表
  worldEntryId?: string        // 遗留只读
  relationCharacterId?: string // 遗留只读
  sessionId?: string
}
```

- 写入只写新字段；读取 `settingsNode ?? migrate(legacy)`；迁移命中后下次写入自然覆盖，不做启动时全量重写（与既有「全 optional 增量写入」模式一致，零迁移成本）。
- 解析安全：`settingsNode` 无法解析为合法节点（损坏存档、未知 kind）时按未选中处理并忽略该值，与「存档数据损坏或缺失」既有回落语义一致。
- 失效补校验 effect 重写：settingsNode 指向的 entryId/characterId 不在查询数据中时清节点并清存档（沿用 L431-461 同模式，删除针对 worldEntryId/relationCharacterId 的旧 effect）。
- `leftMode` 枚举不变（world 仍代表「设定」分段），避免动持久化键版本。

### D5 头部编辑拆分：按钮变跳转，表单拆两半

头部「编辑」按钮 onClick 改 `changeLeftMode("world") + selectSettingsNode({kind:"book-info"})`，删除 isEditing 就地表单区块（L703-711 信号、L770-820 startEdit/saveEdit、L968-1018 表单 JSX 中元数据与风格的混合渲染）。元数据部分（书名/简介/类型）落入 `settings-main` 的 book-info 节点；风格部分本就由 StyleGuideEditor 承载（现 world-reader 子 tab 平移），篇幅限制 checkbox 并入 StyleGuideEditor（它本就读写同一 style_guide.rules）。

备选：保留头部就地编辑作为「快捷入口」——被否：违背单一数据源，proposal 已列为 BREAKING。

### D6 rail 面板零改动，组件双向复用

PanelCharacters / PanelTechniques / PanelForeshadow 保持 rail 挂载不变，组件本体不改。设定树复用的是更细粒度的既有组件：CharacterList（本就接受 `onSelect`，新增可选 `hideSearch` props 关闭内嵌搜索，rail 内的 PanelCharacters 不传、行为不变）、CharacterDetail、PanelForeshadow、PanelTechniques。组件内查询走 tanstack 缓存，两处挂载无重复请求。角色详情的「当前章节状态横幅」属于 PanelCharacters 容器层（章节随行镜头），设定树不挂载该横幅。

### D7 新建与删除入口的承接

- **新建世界观条目**：原表单随 world-sidebar 一起退役，在「世界观条目」节点头部提供「+ 新建」入口，展开内联表单（分类/标题/内容，字段与校验沿用原实现）；提交成功 `selectSettingsNode({kind:"world-entry",entryId})` 选中新条目。
- **新建角色**：沿用 CharacterList 内既有新建表单（角色板块「列表」标签内），提交成功选中对应 character 节点。
- **删除**：条目/角色删除统一走详情区既有删除按钮（WorldEntryDetail / CharacterDetail 均有）；world-sidebar 的每行删除按钮不再保留——有意简化：删除是低频高危操作，集中进详情区与确认对话框，避免树上误触。

## Risks / Trade-offs

- [首帧收敛恢复矩阵变复杂（节点 × 标签 × 迁移来源）] → 标签态不持久化（D2），恢复矩阵只增 `settingsNode` 一个维度；迁移逻辑纯函数化，配套单测。
- [ ?tab=relations|map 外部深链语义变化 ] → replace 重定向到等价视图，无功能损失；已验证 e2e 无主区 tab 硬依赖。
- [e2e 依赖 `[data-slot="world-sidebar"]`（book-open-transition.spec.ts 首帧探针）] → 新树根节点使用 `data-slot="settings-tree"`（沿用旧名会让探针语义失真），同步更新该 e2e 的两处探针。
- [CharacterList 内嵌搜索与树顶统一搜索职责重叠] → CharacterList 加 `hideSearch` props：设定树内关闭内嵌搜索，rail 内保持原样。
- [详情组件编辑态受控改造波及 relations-view 抽屉] → 受控 props 可选、缺省回落内部自持，抽屉与 rail 调用点不传即零影响；typecheck + 既有单测兜底。
- [setting-review-hub 随后 rebase 的接口漂移] → 「整理」节点的挂载契约就是现有 SettingOrganizationPanel props（novelID），review-hub 只需替换该节点内容与加徽标；本提案归档后同步修订其 design 的 UI 段落。
- [删除头部 isEditing 区块波及会话状态条等相邻 JSX] → 拆分按整块 Show 边界删除，相邻区块（导出、ModeBadge、pipeline bar）不动，typecheck + 既有单测兜底。

## Migration Plan

1. 纯前端增量：新旧结构只经 perBookState 新字段衔接，旧本地数据直接可用；回滚 = 还原代码（`settingsNode` 残留字段无害，旧版本读取时忽略未知键）。
2. 实施顺序与 tasks.md 一致：树骨架 → perBookState 迁移 → 中央路由与节点接入 → tab 收缩 + 重定向 + 头部收敛 → 旧文件删除与 i18n、验证。
3. 验证：packages/app 下 `bun typecheck`、unit 测试（迁移纯函数、workspace-data 既有用例更新）、e2e（book-open-transition 探针更新）、手测四条主路径（设定树管理、rail 双镜头、旧书签重定向、篇幅限制复选框迁移）。

## Open Questions

- 世界观板块 root「列表」标签的内容形态：v1 用「分类概览 + 条目计数 + 点击下钻」轻列表即可，是否需要全局统计（条目总数/最近更新）可在实施时按成本决定，不影响 spec 与任务拆分。
