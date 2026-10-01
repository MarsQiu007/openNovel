# Design

## Context

章纲由 outliner 无状态生成：每次只看上下文快照为"第 N 章"做局部规划。快照中已有活跃结构线（activeArcs，P3b 层），渲染为「═══ 结构线/弧光（本章需推进）═══」段，但节点不标注落地状态，outliner 提示词也未引用结构线。节点进度由 `syncArcProgress` 在章节提交后确定性维护（planned → drafted，弧光 planned → active → completed）。writer 提示词要求章末钩子，使每章有收束倾向。参见 proposal.md 的 Why。

## Goals / Non-Goals

**Goals:**

- 让 outliner 看得见"事件写到哪里了"：节点落地状态 + 下一个未落地节点进入快照渲染。
- 让 outliner 有明确约束：进行中事件不得提前完结，以节点而非章数作为计划单位。
- 保持 author_intent 作为人工 override 通道。

**Non-Goals:**

- 不新建数据表、不改 `syncArcProgress` 的幂等语义。
- 不改卷纲模板、不动 architect 的开书预估。
- 本变更不含 UI 改动。

## Decisions

### D1: 复用 story_arcs / arc_beats 作为"事件段"载体，不建新表

备选方案是新建 event_segment 表（含完结条件、里程碑序列、已覆盖章节）。放弃理由：story_arcs + arc_beats 已经承载完全相同的结构（弧光 = 事件段，beat = 里程碑，beat status = 落地状态），且进度同步、结构检查（structure.ts）、快照注入（loadActiveArcs）都已存在。新建表会引入两套并行概念，弧光与事件段的一致性反而成为新的漂移源。

### D2: 快照渲染标注节点状态，outliner 提示词加跨章硬规则

快照结构线段中每个节点前缀落地标注（✅已落地 / ○未落地），下一个未落地节点加「本章推进目标」标记；active 的 narrative/subplot 弧光附「本章不得完结（除非仅剩最后一个未落地节点）」提示。outliner 提示词新增规则引用该段：存在进行中事件时，本章目标 = 推进下一个未落地节点，禁止落地 climax/resolution 节点（最后一个除外），continuity 中记录事件剩余进度。两个实现要点：`loadActiveArcs` 的窗口过滤（±3/+5 章、每弧最多 8 节点）只影响展示范围，"是否仅剩最后一个未落地节点"与"下一个未落地节点"必须按弧光全量节点判定，在加载摘要时一并算出，避免窗口截断导致误判；进度判定只计结构节点（setup/rising/turn/midpoint/crisis/climax/resolution），kind=note 的备注不算未落地节点、不参与“仅剩最后一个未落地节点”与“下一个未落地节点”的判定（备注是作者的注解而非剧情里程碑，计入会让事件永远无法进入“本章可完结”态）；全部节点已 drafted 但无 resolution 节点的弧光（`syncArcProgress` 不会完结它）保持 active 常驻注入，此时不挂"本章不得完结"提示（与规格场景一致）；是否需要补建结局节点或手动完结属于弧光维护流程，不在本变更范围。

备选方案是纯提示词约束（不渲染状态）。放弃理由：快照渲染文本不标注节点状态，outliner 只靠"最近三章摘要"的有损回忆判断事件进度，几章后必然漂移。状态标注是确定性渲染，零模型成本。

### D3: author_intent 优先于默认规则

默认规则与 author_intent 冲突时以 author_intent 为准（延长或压缩均可）。实现上在 outliner 提示词中声明优先级，不需要新的结构化字段——作者意图经 dispatch prompt（用户反馈原文）以自由文本传入，outliner 现有提示词已引用 author_intent 概念，模型可直接理解"这段再写 2-3 章"这类表述。

### D4: writer 钩子规则区分事件内/完结章

writer 提示词的章末钩子规则补充：事件内章节允许以事件内部悬念收尾，不得为收束感提前落地高潮/结局。判定依据是快照中该事件的节点进度标注（D2 已提供），不新增 writer 输入。

## Risks / Trade-offs

- [作者从未用 architect 建结构线，或 beat 划分过粗（一个事件只有一个 resolution 节点）] → 约束退化为只有"本章不得完结"提示而缺少可推进的中间目标；单节点事件一进 active 就等于"本章可完结"，规则自然失效。缓解：提示仅在 active 且存在未落地节点的弧光上生效，无弧光时行为与现状一致；beat 粒度问题属弧光维护流程，不在本变更范围。
- [全部节点已落地但无 resolution 节点的弧光永久保持 active] → "不得完结"提示若误挂会一直悬挂。缓解：按 D2 的全量判定，无未落地节点时不挂提示，实现时以单测固定该行为。
- [observer 提取偏差导致 beat 落地与正文实际进度不符] → syncArcProgress 按锚定关系回填，已有幂等保护；残留偏差由现有 drift-guards / 审计兜底，本变更不新增回滚机制。
- [快照结构线段变长] → 标注只增加固定前缀字符，activeArcs 已有数量与每弧节点数上限，预算影响可忽略。



