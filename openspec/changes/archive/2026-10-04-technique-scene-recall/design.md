# 设计：技法场景标签词表对齐与召回回退

## Context

召回链路与词表现状（详见 proposal.md — Why）：

```
入库侧两条路径：
  CLI 提取（technique-extract.ts）—— prompt 写明 7 值词表 ✅
  对话学习（director.ts 技法学习流程）—— prompt 只写"适用场景(scene_types)"，无词表 ❌
  收敛点 normalizeTechnique —— 仅 undefined 回退 ["general"]，不校验给定值 ❌

召回侧：
  inferSceneType（context.ts）—— 标题关键词正则 → 7 个固定值之一
  queryTechniques（technique-store.ts）—— sceneTypes.includes(sceneType) 精确匹配，无回退

实测数据（《金牌》audits 库，63 条，2026-10-02）：
  场景标签全部自由中文短语，0 条命中规范词表 → 候选恒空 → shadow 闭环空转
```

规范场景词表（唯一事实源，两处实现均已锚定这 7 值）：
`action | dialogue | description | suspense | emotion_shift | transition | general`

## Goals / Non-Goals

**Goals:**

- 增量：任何入库路径产出的技法，场景标签收敛至规范词表（空交集 → `["general"]`）
- 存量：不做数据迁移，历史自由文本标签技法恢复可召回（general 回退）
- 召回匹配逻辑对"无规范标签"数据永不再整体静默过滤
- plugin 既有测试全量通过 + 《金牌》真实数据验证候选恢复

**Non-Goals:**

- 见 proposal.md Non-Goals（语义重打标签、embedding、场景推断改动、level 词表、schema 变更等）

## Decisions

### D1：收敛放在 `normalizeTechnique`（规范化层），而非各入库路径分别校验

- 所有入库路径（CLI 提取、对话学习 `save_technique`、种子导入、面板新建的服务端路径）最终都经 `normalizeTechnique` 落库——单点收敛即全覆盖；
- 确定性规则（与规范词表求交，空则 `["general"]`），不依赖 LLM 自觉，测试可锁定；
- 备选（各路径 prompt 自律 + save_technique schema 枚举）被放弃：prompt 自律已被证不可靠（本次事故成因），schema 枚举只能拦工具路径、拦不住 CLI/种子，且 LLM 看到枚举报错后换自由文本重试照样入库——治标。

### D2：入库收敛是"求交 + 回退"，不是"映射"

- 把 `["性感场景","约会场景"]` 映射到规范值需要语义判断，规则层做不了（映射错比丢弃更糟——假匹配污染反馈数据）；
- 求交保留 LLM 已产出的规范值（如 `["dialogue","约会场景"]` → `["dialogue"]`），非规范值丢弃，空则 `["general"]`；
- 提升 LLM 直接产出规范值的比例靠 D3 的提示词补词表，而非规则猜测。语义重打标签作为后续变更（Non-Goal）。

### D3：提示词与工具描述补词表——增量质量，不承载正确性

- `director.ts` 技法学习流程第 2 步"逐章提炼"补充：场景类型从规范 7 值中多选（不确定/跨场景用 `general`），与 CLI 提取 prompt 词表一致；
- `save_technique` / `search_techniques` 工具 describe 补充词表说明——学习 agent 与 pipeline 多轮召回 agent 用同一套词，召回评估时 `search_techniques` 的场景过滤才有意义；
- `technique-extract.ts` 现有词表确认一致，无需改动。

### D4：检索回退——`queryTechniques` 匹配前先做规范交集，空交集视为 general

- 匹配函数从 `entry.sceneTypes.includes(query.sceneType)` 改为：先算 `canonical = entry.sceneTypes ∩ 词表`，`canonical` 为空时按 `["general"]` 参与匹配；非空时按 `canonical` 匹配（与现状对规范数据行为完全一致）；
- 存量 63 条无需迁移即恢复召回（对"对话"等章节按 general 身份参与排序，曝光位逻辑不受影响）；
- 同时兜住未来任何绕过规范化层写入的自由文本数据（面板直建、手工 SQL 等）；
- 注意与 `UNVERIFIED_SPOTS` 曝光位的交互：回退只改"是否匹配"，不改排序与曝光位规则，新品曝光语义不变。

## Risks / Trade-offs

- [全部回退 general 造成场景区分度下降（LLM 无视词表时，一批技法挤在 general 池）] → D3 提示词约束降低概率；general 池按置信度排序仍然有序；可在后续语义重打标签变更中精细化
- [丢弃非规范标签对个别已习惯自由标签的用户造成信息损失] → 检索回退（D4）保证自由标签数据仍可召回；面板展示不受影响（原样显示 sceneTypes 字段——收敛发生在入库时，已入库数据不动）
- [求交逻辑若复制在两处（normalize / queryTechniques）存在漂移风险] → 词表常量抽到一个模块（如 `technique.ts` 导出 `CANONICAL_SCENE_TYPES`），两处引用同一常量
- [回退让 general 池变大，候选 top5 竞争激烈] → 曝光位 2 条规则不变；unverified 新品按入库时间轮替，长期看是想要的反馈积累

## Migration Plan

1. 抽规范词表常量 → `normalizeTechnique` 收敛逻辑 + 单测
2. `queryTechniques` 匹配回退 + 单测（重点场景：纯自由文本 / 混合 / 纯规范 / 空数组）
3. director 提示词 + 工具描述补词表
4. 验证：plugin 测试全量 + typecheck；用《金牌》真实库跑一次 `queryTechniques({sceneType:"dialogue", limit:5})` 确认自由文本技法以 general 身份入候选
5. 提交推送

回滚策略：单 commit revert；无 schema/数据迁移，存量数据不受影响。

## Open Questions

（无——词表唯一事实源已锚定、收敛与回退规则确定、存量处置明确为"不迁移靠回退"。）