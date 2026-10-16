# Design

## Context

见 proposal.md - Why。技术现状：

- 审查详情现为 `approval-bar.tsx` 内部的 `ReviewPanel` 组件，经审批栏「展开审查/收起」内嵌渲染在阅读区与审批按钮之间：全栏宽横条、无独立滚动、无高度约束；内容为轮次 SegmentedControl + 9 大类 37 维（detail/evidence）+ 人工评审记录，信息密度高。
- 右栏检视面板体系成熟：`workspace-frame.tsx` 的 `RAIL_PANELS` 注册表（key/icon/label）+ 图标列互斥切换（`openRailPanel`）+ peek/expand 双态（`?tab=panel:<key>` 承载 expand，`exitExpand`/`peekMemo` 负责返回恢复）+ 按需挂载。结构面板有「默认 expand」先例（`openRailPanel` 内对 `structure` 特判）。
- 收起态右栏的恢复入口已存在：`restoreRailPanel`（清 `railManual`）经边缘热区触发；审批栏入口可直接复用同一布局状态写入。
- 数据流：`useChapterReviews`（TanStack Query，`["novel","chapter-reviews",dir,novelID,chapterID]` 缓存）→ `GET novel.chapter-reviews` → `listChapterReviews` 纯读持久化评审行。UI 全程无审计触发；批注面板（`AnnotationPanel`）是章节作用域面板的直接先例。

## Goals / Non-Goals

- Goal：审查详情进入右栏面板词汇表（图标入口 + 互斥 + 双态 + 章节联动）；审批栏只留审批操作；阅读区不再被详情横条侵入。
- Non-Goal：见 proposal.md 非目标。设计层面不改动 `expandedPanel`/`openRailPanel` 的通用机制，只对「审查」追加默认 expand 特判；不改动 `ReviewPanel` 的信息结构（轮次/维度/证据/人工记录的呈现内容原样迁移，仅容器与宽度语境变化）。

## Decisions

**D1：抽取 `ReviewPanel` 为独立面板组件并注册进 `RAIL_PANELS`，而不是在审批栏保留内嵌副本。**

- 理由：规格「任意面板只有一个入口」要求单一宿主；内嵌副本 + 面板双份会引入状态同步与双查询（虽被缓存去重，但语义上两份宿主）。迁移后审批栏的 `showReview` 状态整体删除。
- 备选：内嵌横条加 max-height 滚动——只治高度不治阅读体验，且仍违反面板词汇表一致性，否决。

**D2：审查面板默认 expand（对齐结构面板先例），在 `openRailPanel` 以同样模式特判 `review`。**

- 理由：37 维报告的深读场景与结构视图同档；peek 态 380px 栏宽适合清单速览，但 detail/evidence 长文本在 expand 主区宽度下才可读。Esc/返回回到 peek 的行为由既有 `exitExpand`/`peekMemo` 机制免费获得。
- 备选：默认 peek、二次点击才 expand——多一步操作，且与「打开审查=读报告」的意图不符，否决。

**D3：审批栏「审查详情」入口（硬编码中文标签）= `setRailPanel("review")` + 清 `railManual` + 设 `?tab=panel:review`。**

- 理由：与 `openRailPanel("review")` 语义等价（收起态恢复 = `restoreRailPanel` 的 `setLayout("railManual", false)`），直接复用既有布局状态写入，不新增状态通道。
- 命名避让：审批栏既有 i18n 按钮「查看审查」（`novel.approval.viewReview`）跳转绑定写作会话，语义与入口不同；新入口改用「审查详情」硬编码标签，避免同栏两个「查看审查」混淆，且无需改动 i18n locale 文件。
- 边界：expand 生效依赖主区当前处于阅读视图承载链；用户在其他主区 tab 点击「审查详情」时行为与结构面板入口一致（expand 视图替换主区），不做特判（见 proposal 非目标）。

**D4：面板标签硬编码中文「审查」，沿用「技法库」「AI 产出」的既有先例，不改 i18n locale 文件。**

- 理由：仓库约定明确 i18n locale 文件不动；检视面板标签已有两个硬编码先例。

## Risks / Trade-offs

- [审查面板在 expand 态占据主区，用户切主区 tab 时期望与现实的落差] → 与结构面板现状完全一致（非目标明确不做额外约束），用户已有同构经验。
- [删除内嵌展开后，用户旧习惯「审批栏展开审查」路径消失] → 「审查详情」按钮位于原展开按钮处，文案变化在界面内自解释；e2e 在 tasks 3.2 补充入口覆盖。
- [默认 expand 使打开动作改变主区内容，可能打断阅读上下文] → Esc/返回一步恢复，且这是结构面板已建立的双态语义，非新交互。
- [e2e 旅程用例的审批步骤只断言按钮可见性，不覆盖新入口] → tasks 增加打开审查面板的用例级断言。

## Migration Plan

无需迁移：纯前端组件归属调整，无数据、无 API、无持久化结构变化；`novel.workspace.layout.v1` 的 `railPanel`/`expanded` 枚举追加新 key，旧持久化值不含 `review` 时按既有降级规则回落对话面板，零迁移。

## Open Questions

无。
