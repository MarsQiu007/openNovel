# Proposal

## Why

对话学习流程（technique-chat-learn）成功入库的技法在写作时**一条都召回不了**：实测《金牌》（C:\Novels\audits）库中 63 条已入库技法（全部 `unverified`/0.5）的场景标签全部是自由中文短语（如 `["性感场景","约会场景"]`），而写作流水线的场景召回用 `sceneTypes.includes(query.sceneType)` 精确匹配（`technique-store.ts`），`query.sceneType` 是章节标题关键词正则推断的 7 个固定值之一（`action/dialogue/description/suspense/emotion_shift/transition/general`，见 `context.ts` inferSceneType）。63 条中**无一条包含任一规范值**，每章候选恒为空：

- **写作侧**：快照"技法候选"段落恒为空 → 注入模式下 pipeline agent 首轮候选为空，多轮 `search_techniques` 只能靠名称关键词碰巧撞中（场景过滤同样精确匹配失效）→ 技法对写作的指导价值为零；
- **验证侧**：候选为空 → 不写 shadow log → auditor 无候选可评 → `record_technique_feedback` 永不触发 → 贝叶斯状态机空转 → 63 条永远卡在 `unverified`，"未验证"状态无法通过正常写作自愈。

根因是**词表断层**：CLI 提取管线的 LLM prompt（`technique-extract.ts`）明确要求使用规范词表，而对话学习流程的 director 提示词只写"适用场景(scene_types)"未给词表，`save_technique` 工具 schema 也只是无约束的 `array(string)`；`normalizeTechnique`（`technique-normalize.ts`）只对 `undefined` 回退 `["general"]`，**不校验已提供的值**。三处都没有拦住自由文本。

## What Changes

- **入库收敛（治本，增量）**：`normalizeTechnique` 增加场景标签收敛——`sceneTypes` 与规范词表求交，交集为空则回退 `["general"]`。因所有入库路径（CLI 提取、对话学习、种子导入）都经规范化层，一处改动全覆盖；确定性规则，不依赖 LLM 自觉。
- **提示词补词表（增量质量）**：director 技法学习流程提示词与 `save_technique`/`search_techniques` 工具描述补充规范场景词表（7 值、可多选、不确定用 `general`），让 LLM 直接产出可精确匹配的标签，减少全部回退 general 造成的场景区分度损失。
- **检索回退（兜底，存量）**：`queryTechniques` 匹配逻辑改为先求交规范词表，交集为空的技法（历史自由文本数据）按 `general` 身份参与匹配——不做数据迁移也能立即恢复存量 63 条的召回能力。
- 验证：plugin 单测（规范化/匹配/检索）、既有技法测试全量通过；用《金牌》真实数据验证一条自由文本标签技法能进入"对话"章节候选。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `technique-library`：入库规则新增场景标签收敛——所有入库路径的 `sceneTypes` MUST 收敛至规范词表，空交集回退 `["general"]`，不依赖单条路径的 LLM 自觉。
- `technique-shadow-loop`：检索匹配新增空交集回退——场景标签与规范词表无交集的技法 MUST 按 `general` 参与候选匹配，不得因标签词表问题被静默过滤。

## Non-Goals（非目标）

- 不做存量数据的 LLM 语义重打标签（检索回退已恢复可召回性；提升标签质量留待后续变更）。
- 不引入 embedding 向量语义检索/语义匹配（沿用规则精确匹配 + general 回退）。
- 不改变场景推断逻辑（`inferSceneType` 标题关键词正则维持原样）。
- 不改变层级（level）词表与状态机规则（置信度 ≥0.75 且反馈 ≥5 转 verified 不动）。
- 不改动 App 面板 UI；不动数据库 schema。
- 不改动 `technique-chat-learn` 变更工件（该变更尚未归档；本变更与之无 spec delta 重叠，冲突面仅在 director 提示词文件，实施时以本变更为准合并）。

## Impact

- `packages/plugin`：主影响面——`technique-normalize.ts`（收敛逻辑）、`novel-writer.ts`（工具描述）、`agents/director.ts`（学习流程提示词）、`technique-store.ts`（匹配回退）及对应测试。
- 数据兼容：无 schema 变更；存量自由文本标签数据经检索回退立即可召回，不经迁移。
- 行为变化：入库技法的非规范场景标签被丢弃（回退 general）——对存量数据零影响（本就不参与匹配），对增量数据是行为收紧。
- 用户可见：《金牌》63 条技法在后续写作中能进入候选（以 general 身份），shadow 反馈闭环开始积累，达到阈值后自动转 `verified`。