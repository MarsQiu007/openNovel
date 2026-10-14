# Proposal: agent-dispatch-routing

## Why

用户向主 agent（director）请求生成类工作时（章节大纲、新设定、创意灵感），director 经常自己把活干了，而不是调度专职子 agent（@outliner / @architect / @ideator）。调查发现这不是模型不听话，而是 director 提示词自相矛盾：调度表把活派给专职 agent，路由段却写着"你自己做"，且 director 拥有全部写工具（`*` 通配 allow），自己动手零摩擦。后果包括：event-arc-planning 挂在 @outliner 上的跨章事件段规则在用户日常用法下完全不生效（director 手写大纲不经过这些规则），产出质量回退。

## What Changes

- 修改 director 提示词"生成大纲"路由：章节大纲（含重新生成、批量生成）改为 dispatch @outliner，由 outliner 组装快照并落库；director 不再自撰大纲内容。卷大纲保留 director 直写（无专职 agent，显式例外）。
- 修改 director 提示词设定路由：新增设定实体（无中生有、成批生成内容）dispatch @architect；已存在实体的字段修改仍由 director 自己完成（确认门与级联不变），判定以 list_settings 存在性为准；"临时灵感采纳"段的采纳后路由同步改写（新增设定走 architect、修改既有设定走 director 直改）。
- 修改 director 提示词创意路由与"临时灵感采纳"段：@ideator 触发从固定关键词表改为意图判定——只要用户要多个候选方案/灵感发散（无论措辞）即调度；闲聊、单一建议、设定查询仍由 director 直接回答。
- 收敛 director 权限：`generate_chapter_outline` 从 allow 改为 deny（exact rule 优先于通配 allow），强迫章纲必须经 @outliner 产线；同步把工具描述中"director 根据小说设定生成的完整章纲"的归属措辞中性化。
- 新增静态一致性测试：扫描 director 提示词与权限表，断言路由-调度一致（大纲→@outliner、创意→意图判定、deny 权限），防止提示词回退。

## Capabilities

### New Capabilities

- `agent-dispatch-routing`: director 生成类任务的调度契约——章节大纲必须经 @outliner 产线、新设定实体必须经 @architect、创意发散按意图调度 @ideator，配套权限收敛与静态一致性校验。

### Modified Capabilities

- `novel-ideation`: "director 路由明确创意请求" requirement 从固定关键词触发改为意图判定触发，覆盖关键词表之外的措辞变体；"临时灵感采纳必须二次确认" requirement 的"新增设定"分支改为调度 architect 落库（新实体），修改既有设定保留 director 直改流程。

## Impact

- **packages/plugin**：`src/novel-writer/agents/director.ts`（路由段重写）、`src/novel-writer.ts`（director 权限表 + generate_chapter_outline 工具描述）；新增 `test/novel-writer/agent-dispatch-routing.test.ts`。
- 无数据模型变更，与现有本地数据完全兼容；不改 writer/pipeline 内部调度，不改 @outliner/@ideator/@architect 子 agent 自身提示词。

## 非目标

- 不收敛 director 的 `save_novel_settings` / `manage_characters` 等其余写工具权限（设定小改路径仍需要）。
- 不改变 pipeline 8 步流程与 writer/reviser/observer/reflector 的调度关系。
- 不新增 event_segment 等数据模型，不修改卷大纲直写路径。
- 不在本变更中改动 @ideator/@outliner/@architect 的 system prompt 内容。


