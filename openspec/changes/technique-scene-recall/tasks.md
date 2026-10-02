# 任务：技法场景标签词表对齐与召回回退

依据：proposal.md（为什么/改什么/非目标）、design.md（决策 D1–D4、风险、验证与回滚）。

## 1. 词表常量与入库收敛（design D1/D2）

- [ ] 1.1 在 `packages/plugin/src/novel-writer/technique.ts` 导出规范词表常量 `CANONICAL_SCENE_TYPES`（7 值：action/dialogue/description/suspense/emotion_shift/transition/general），注释注明唯一事实源（与 `technique-extract.ts` prompt、`context.ts` inferSceneType 输出对齐）（验证：常量内容与两处现有实现逐一比对一致）
- [ ] 1.2 `technique-normalize.ts` 的 `normalizeTechnique` 增加收敛：`sceneTypes` 与词表求交保留规范值，空交集/缺省回退 `["general"]`（design D2；验证：`technique-normalize.test.ts` 新增用例——纯自由文本 `["性感场景"]` → `["general"]`、混合 `["dialogue","约会场景"]` → `["dialogue"]`、纯规范不变、undefined → `["general"]`，全部通过）

## 2. 检索匹配回退（design D4）

- [ ] 2.1 `technique-store.ts` 的 `queryTechniques` 匹配逻辑改为：入库条目的场景标签先与 `CANONICAL_SCENE_TYPES` 求交，空交集按 `["general"]` 参与 `sceneTypes.includes(query.sceneType)` 匹配；非空交集按交集匹配（design D4；验证：`technique-store.test.ts` 新增用例——自由文本标签技法在 `sceneType:"dialogue"` 下入候选、规范不匹配仍排除、曝光位规则与候选上限不变）
- [ ] 2.2 确认收敛逻辑两处（normalize/queryTechniques）引用同一常量、无第二份词表拷贝（design 风险节；验证：代码审查 + `git grep CANONICAL_SCENE_TYPES` 仅一处定义）

## 3. 提示词与工具描述补词表（design D3）

- [ ] 3.1 `agents/director.ts` 技法学习流程"逐章提炼"一步补充规范场景词表说明：从 7 值中多选、不确定/跨场景用 `general`，与 CLI 提取 prompt 词表一致（验证：词表文本与 `technique-extract.ts:37` 逐一比对）
- [ ] 3.2 `novel-writer.ts` 的 `save_technique` 与 `search_techniques` 工具 describe 补充词表说明（学习 agent 与 pipeline 多轮召回共用一套词）（验证：describe 文本含全部 7 个规范值）
- [ ] 3.3 确认 `technique-extract.ts` 现有词表与常量一致，无需改动（验证：比对记录于提交说明）

## 4. 验证矩阵

- [ ] 4.1 `packages/plugin` 既有技法测试全量通过（technique-*.test.ts 全系列，含 store/normalize/learn/extract/inject/e2e）
- [ ] 4.2 `packages/plugin` typecheck 通过
- [ ] 4.3 《金牌》真实数据验证：对 `C:\Novels\audits\.novel\novel.db` 跑一次 `queryTechniques({ sceneType: "dialogue", limit: 5 })`，确认自由文本标签技法按 general 身份进入候选（实施前候选为 0 条，实施后 >0；验证：输出截图/日志记录于 tasks.md）

## 5. 提交

- [ ] 5.1 提交推送，commit message 说明词表对齐与召回回退，footer 带 `OpenSpec-Change: technique-scene-recall`（验证：`git push` 成功）

## 6. 应急预案（仅在前置任务失败时执行）

- [ ] 6.1 若求交回退导致既有 e2e 测试期望大面积失效：核对失效用例是否锁死了"自由文本可入库"旧行为——是则按新规格更新用例（收敛是新规格行为）；否则修复实现缺陷（验证：测试更新 diff 逐条可解释）
- [ ] 6.2 若《金牌》验证后候选仍为空：用 bun:sqlite 直查库中 `scene_types` 与状态，定位是匹配回退未生效还是曝光位/排序问题，记录证据后回到 2.1 修复（验证：queryTechniques 单测覆盖该数据形态）