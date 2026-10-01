# Proposal: event-arc-planning

## Why

设计章纲时，outliner 每次无状态地为"第 N 章"做局部决策：看到当前开着的大场景（事件段），最自然的吸引子是在本章内把它完结掉——因为提示词要求"剧情推进必须有实质内容"。但作者的实际意图往往是把一个大事件拆成多章连载，而且事先并不确定要拆几章。现在的系统里卷和章之间缺少"进行中"的持久规划单位：快照虽然带出了活跃结构线（activeArcs），但节点不标注落地状态，outliner 提示词也完全没提结构线，更没有任何"不得完结进行中事件"的规则，导致大场景总是提前收场。

## What Changes

- 快照「结构线/弧光（本章需推进）」段 SHALL 标注每个节点的落地状态（✅已落地 / ○未落地），并突出显示下一个未落地节点；进行中（active）且尚有未落地节点的叙事结构线/支线 SHALL 附带"本章不得完结"提示。
- outliner 提示词 SHALL 新增跨章事件段规划规则：存在进行中事件时，本章目标是推进到下一个未落地节点，显式禁止落地其高潮/结局节点（仅剩最后一个未落地节点时除外）；章纲 continuity SHALL 记录事件剩余进度。
- author_intent 逃生门：作者在创作意图中声明事件的跨章安排（如"此事件再写 2-3 章，不要提前结束"）时，outliner SHALL 遵守，且与默认规则冲突时以 author_intent 优先。
- writer 提示词章末钩子规则微调：处于进行中事件内的章节，钩子允许是事件内部的悬念升级，不要求事件级收束。

非目标：

- 不新建"事件段"数据表——复用现有 story_arcs / arc_beats 作为事件段载体。
- 不修改 8 步写作流水线的阶段结构，不新增审计维度。
- 不修改 app / desktop 界面（结构线可视化已有独立能力承载）。
- 不重算 architect 开书时的预估章节区间（planned range 保持静态预估，实际进度以 beat 落地为准）。
- 不处理 observer 提取偏离导致的事件进度偏差回滚（syncArcProgress 幂等语义保持不变）。

## Capabilities

### New Capabilities

- `event-arc-planning`: 跨章事件段规划——outliner 基于活跃结构线的节点进度做跨章规划，进行中事件不得提前完结，以节点（里程碑）而非章数作为计划单位。

### Modified Capabilities

（无——快照渲染与提示词规则的变更均由新能力的 requirements 覆盖，既有能力的需求文本不变。）

## Impact

- **packages/plugin**：`context.ts`（快照结构线段渲染节点状态与下一节点）、`agents/outliner.ts`（跨章规划硬规则）、`agents/writer.ts`（章末钩子规则微调）。全部为提示词与确定性渲染逻辑变更，无数据模型变更。
- **数据兼容性**：story_arcs / arc_beats 表结构不变，既有本地数据无需迁移；旧快照渲染格式仅在结构线段内新增状态标注，其他段不变。
- **受影响包**：plugin（唯一实现包）；不涉及 novel-store / app / desktop / protocol。


