# Proposal

## Why

openNovel 的风格体系（`style-authoring-flow` / `style-rules-pipeline`）今天只覆盖**显式定义**：用户或 AI 主动声明基调、视角、时态与规则。但作者的真实偏好更多体现在**反馈行为**里——批注、审批驳回、逐句修改模式。这些事件目前只服务当下这一次修订（`writing-feedback-intent`、`approval-reject-handoff`），修订完成后偏好即被丢弃，下一章 AI 照样重犯。「作者写得越多，AI 越懂怎么写」缺少一个把反馈事件沉淀为持久偏好的机制。`memory-panel` 已为事实型记忆卡证明了「AI 提取 + 人审门 + 生命周期」模式在产品里可行，风格偏好可以用同一范式补齐。

## What Changes

- 新增书籍级**作者风格偏好卡**（style preference card）：从批注、审批驳回、人工修改模式中蒸馏出的作者专属写法偏好（如「对话少用动作链」「章节结尾必须留钩子」），每张卡携带偏好维度、偏好陈述与 provenance（源事件类型 + 章节 + 原文引句锚点）。
- 新增偏好卡**人审生命周期**：候选卡进入 pending，作者批准（approved）后才参与起草注入；可驳回（rejected）与退休（retired，留痕不删除）；长期未复现的卡标记 stale，退休需作者确认。面板交互复用 `memory-panel` 既有模式（计数徽标、状态过滤、合并留痕恢复）。
- 起草上下文注入：approved 偏好卡与 `style_guide.rules` 并列进入写作上下文快照的风格段，受同一快照预算约束；优先级上显式规则高于偏好卡，裁剪从最早的卡开始。
- 保鲜机制：偏好卡记录「最近复现章节」；超过 N 章未在正文或批注中复现的卡进入 stale，作者确认后退休。
- 新数据表（书籍库）：偏好卡表 + 全文检索索引，幂等建表 + 存量库迁移；不改动既有 `style_guide`、记忆卡、技法表。

**非目标**：

- 不做正文示例片段库或向量检索：偏好卡只存陈述与引句锚点，与 `technique-library` 的证据条目保持不同形态。
- 不替代 38 维连续性审计：偏好卡只影响起草与修订的风格面，不参与逻辑/时间线等维度的判定。
- 不做全自动免审注入：任何卡必须经作者批准才生效。
- 不做跨书共享：偏好卡先按本书生效；跨书归纳留待后续提案。
- 不改变既有技法库（`technique-*` 家族）的任何行为。

## Capabilities

### New Capabilities

- `style-preference-ledger`: 从作者反馈事件蒸馏、人审、注入与保鲜「作者风格偏好卡」的书籍级账本能力；覆盖偏好卡的提取来源、生命周期状态机、起草上下文注入位置与预算优先级、stale/退休保鲜规则。

### Modified Capabilities

（无——不改既有 spec 的需求；与 `style-rules-pipeline`、`memory-panel`、`technique-library` 的边界在本能力的新需求中显式约束，三者行为保持不变。）

## Impact

- `packages/novel-store`：偏好卡新表（含 FTS）及幂等迁移；状态过滤、计数、全文检索的数据访问。
- `packages/plugin`：反馈事件钩子（批注/驳回/修改模式三类信号源）→ 候选卡蒸馏；写作快照组装时注入 approved 卡。
- `packages/opennovel`：偏好卡 HttpApi（列表/批准/驳回/退休/恢复）；新增端点须同 PR 注册 httpapi-exercise 场景。
- `packages/app`：偏好卡面板（挂设定树「AI 设定」节，与「记忆」「技法库」并列），入口计数徽标；用户可见文案全部进既有 locale 体系。
- `packages/desktop`：无直接改动（随 app 与后端发版）。
- 数据兼容性：纯新增表 + 迁移，不动任何既有表；旧版本程序遇到新表无感（SQLite 忽略未知表，新表访问均为按需）。
