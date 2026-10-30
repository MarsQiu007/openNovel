# Proposal: character-profile-audit

## Why

`character-profile` 一期把角色设定结构化后，数据前提就绪，但写作一致性校验仍存在裸奔面：确定性审计的「外貌描述」维度只是字段填充率检查、「性格一致」维度只是 mood 突变检查——正文与档案的矛盾（外貌前后不一、对话丢失语癖）没有任何机制拦截，LLM 深度审计对档案维度也只是软性引用（读取 characters 时档案行已返回，但审计指示未要求逐角色对照档案）。

## What Changes

- 「外貌描述」确定性维度升级：从字段填充率检查升级为正文与档案 appearance 的矛盾比对——档案写了「左脸旧疤」正文却写「右脸」这类硬矛盾确定性检出，记 FAIL 并附证据；台词内提及不算矛盾。
- 「性格一致」确定性维度追加语癖子检查：speech 非空的活跃出场角色，其台词中完全找不到档案语癖的可字面线索时记 WARN；speech 为空或本章无台词的角色天然跳过（灰度）。
- LLM 审计（auditor）prompt 逐角色对照档案：维度 2 外貌描述、维度 3 性格一致的判定指示明确引用档案字段（appearance/speech/tone/personality），与确定性检查形成双保险。
- 修订循环衔接：档案相关违规沿用既有「确定性 FAIL → auditor 深审 → reviser 修订 → 重验」路径，不新增旁路。
- 明确误报边界：档案是静态设定，角色动态情绪归 character_states（既有 mood 检查不变）；不做档案 personality 与正文叙述的确定性比对（语义比对交 LLM 审计）。

## Capabilities

### New Capabilities

- `character-profile-audit`: 角色档案写作一致性校验——正文与档案矛盾的确定性检出与审计闭环。

### Modified Capabilities

## 非目标

- 不新增审计维度编号（保持 38 维）：语癖校验并入「性格一致」维度实现，避免维度编号在 auditor prompt、轻量模式维度清单与提交白名单多处硬编码引发的全链路位移。
- 不做档案 personality 与正文叙述的确定性语义比对（不可字面化，误报不可控），该职责归 LLM 审计。
- 不改动审批 UI、协议与存储层——审计结果结构（ContinuityResult/submit_chapter_review）不变，纯维度内部实现升级。
- 不处理「角色成长导致语气变化」作为违规——那是剧情演进，不是档案矛盾；档案修订走一期塑造操作。

## Impact

- `packages/plugin`：`continuity-check.ts`（「外貌描述」升级为档案矛盾比对、「性格一致」追加语癖子检查）、`agents/auditor.ts`（维度 2/3 判定指示引用档案）。
- 依赖：仅消费一期 `character-profile` 的档案字段与解析 helper（已归档），无新依赖。
- 数据兼容：只读一期 `characters.profile` 列，无 schema/protocol 变更，无迁移；无档案角色全部检查天然跳过，行为与现状一致。
