# Design: settings-tree-visual-hierarchy

## Context

设定树由 `packages/app/src/pages/novel/settings-tree.tsx` 单文件渲染，三个行组件 `SectionHeader`（板块头）、`GroupRow`（分类组）、`NodeRow`（普通节点）各自独立排布：层级仅靠 `margin-left: 12 + depth * 12px` 表达，可收纳控点的 chevron 散落在不同列，选中与悬停共用 `bg-v2-background-bg-layer-02`。样式全部走 Tailwind 工具类 + v2 主题 token（`v2-*`），无自定义 CSS。图标来自 `@opennovel-ai/ui/icon` 的内联注册表（`packages/ui/src/components/icon.tsx` 的 `icons` map，20×20 viewBox），已有 `chevron-right` / `chevron-down` / `folder` / `pencil-line` / `checklist` / `brain` 可复用。

spec `setting-center-tree` 现有条款只约束信息架构与交互（三节结构 / 分类子树 / 搜索 / 路由），展示样式无既有条款，本次为纯新增 delta，无既有 requirement 修改。

## Goals / Non-Goals

- Goals：行结构统一为「收纳控件列 + 语义图标列 + 文本」三段式；逐级引导线；选中/悬停状态分离；全部用现有 v2 主题 token 表达，深浅色主题自动成立
- Non-Goals：不做拖拽与重排序；不改任何交互行为（收纳 / 搜索 / 新建 / 路由）；不改中央区；不引入第三方图标库

## Decisions

### D1: 引导线用伪元素/绝对定位竖线而非字符或图片

每行以 `relative` 容器 + 绝对定位 1px 竖线（`bg-v2-border-border-base` 或更浅 token）实现，位置由 depth 计算。备选：字符 `│`（对不齐、随字体漂移）、SVG 背景图（深浅色需双份资源）。绝对定位线随行高自适应，纯 CSS token，无额外资源。

### D2: 行结构改为「逐级引导线槽 + 控件列 + 图标列 + 文本」VS Code 式三段

- 每行行首渲染 depth 个 16px 引导线槽（每槽内绝对定位 1px 竖线，贯穿行高），行缩进由槽撑出，不再用 margin-left
- 控件槽：可收纳节点放 chevron 按钮（aria-expanded 语义保留），语义图标紧随 chevron；叶子节点以其语义图标占据父级 chevron 同列（VS Code 文件行式），同层级行控件列起点一致；板块头 chevron 居第一槽，标题前以空槽保持节奏
- 备选：chevron 悬停才显示（Notion 风格）——放弃，探索已确认引导线 + 常驻图标的 VS Code 风格更贴合「层级明确」诉求

### D3: 语义图标注册在 `@opennovel-ai/ui/icon`（legacy 注册表），风格对齐现有 stroke 图标

设定树实际导入 `@opennovel-ai/ui/icon`（`src/components/icon.tsx`，20×20 viewBox、`stroke-linecap="square"`），不是 v2 注册表。新注册 6 个：`book`（书籍信息，借 v2 book 的 16×16 形状并走既有 viewBox 特判先例）、`map`（世界观条目 root 与叶子共用）、`zap`（伏笔）、`fire`（灵魂）、`library`（技法库）、`user`（角色列表与角色叶子共用）。复用已有 6 个：`chevron-right` / `chevron-down`（收纳）、`folder`（分类组）、`pencil-line`（写作风格）、`checklist`（整理）、`brain`（记忆）。全部 `stroke="currentColor"` 单色 muted 色，视觉重量与现有图标一致；不引入彩色图标（树是导航不是装饰）。

### D4: 选中态 = 左侧 2px accent 指示条 + 微色块；悬停 = 浅灰

选中：`border-left`（或绝对定位 2px 竖条）用 `v2-background-bg-accent` 系 token，背景用比 hover 更深一档的 layer token；悬停：保持现有 `bg-layer-02`。状态分离后 active 不再依赖 `font-medium` 独撑。

### D5: 缩进阶梯 12px → 16px，引导线起止坐标由 depth 推导

每级缩进 = 16px；每行的引导线在其所有祖先层级的缩进位置各画一条（自顶延伸到本行中部或底部，VS Code 通栏画法简化版）。depth 语义沿用现有（板块 0 / 一级节点 1 / 分类 2 / 条目 3），不重排数据结构。

### D6: 板块头与分类组去掉 uppercase/tracking，改字重与颜色分层

中文语境下 `uppercase tracking-wider` 无效果且拉大字距；板块头改为 `text-xs font-semibold` + muted 色（保留现有），分类组从 uppercase 12px 改为 `text-sm` 常规 + folder 图标区分（图标已承担「这是组」的语义）。仅样式调整，不改收纳行为与 aria。

### D7: 板块模块化容器（实现迭代，来自目测反馈）

三个一级板块各包为独立容器：`rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01`，容器间距 gap-2，容器内节点区 `px-1 pb-1` 让行高亮不贴边。板块头呈现语义图标（书籍内容 `book` / AI 设定 `settings-gear` / 角色 `user`）+ hover 背景；折叠态容器仅剩头部行（头部整行圆角），展开态头部圆角只开顶部——展开/收纳两态对比一目了然。全树 chevron 统一为 `chevron-right` 旋转 90° 的动画切换（`transition-transform duration-150`），替代图标硬切，强化展开/收纳感知。引导线槽与控件列在容器内继续工作，容器边框不截断槽结构。

## Risks / Trade-offs

- [行密度上升，视觉更「重」] → 引导线用最浅 border token，图标 muted 色；如仍嫌重，引导线只在 depth ≥ 1 的行渲染（实现时目测定）
- [6 个新图标的手绘一致性] → 20×20 viewBox / currentColor / `stroke-linecap="square"` 对齐现有风格，写进同一 PR 便于横向校对；不追求一次性完美，后续可单独替换 path
- [引导线在窄侧栏下与文本挤压] → 侧栏宽度现状不变；引导线位置固定在各级缩进中点（16px 阶梯内），文本起点在图标列之后，无重叠
- [i18n aria-label] → 图标为装饰性（`aria-hidden`），不新增文案 key；若实现中需要区分图标语义再按三 locale 同步补 key

## Migration Plan

单 PR 展示层重构，无数据迁移、无协议变更、无生成物再生成；回滚即还原 `settings-tree.tsx` 与 `packages/ui/src/components/icon.tsx` 两个文件。验证路径：`packages/app` 下 `bun typecheck` + 单测 + 用户目测深浅色两主题。e2e 探针（`setting-gallery` / `book-open-transition` / `isolated-character-graph`）按 `[data-slot="settings-tree"]` 容器与节点按钮的可访问名称定位，不断言行内部结构，重构须保留这些锚点。

## Open Questions

（无——视觉密度取舍（引导线是否全层级渲染）留实现时目测定夺，不影响 spec 与任务拆分）
