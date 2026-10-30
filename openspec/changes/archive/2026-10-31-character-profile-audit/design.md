# Design: character-profile-audit

## Context

一期 `character-profile` 已归档：`characters.profile` 列存 JSON（空串=未建档），`parseCharacterProfile` 容错解析（novel-store），`check_novel_settings(scope="characters")` 已输出档案维度行。确定性审计在 `packages/plugin/src/novel-writer/continuity-check.ts`（38 维白名单 + 各维度检查函数），LLM 审计在 `agents/auditor.ts`，修订衔接在 `agents/pipeline.ts` 步骤 4/5。

## Decisions

### D1 并入现有维度，不新增维度编号

「语癖一致」不作为第 39 维，并入「性格一致」维度作为档案子检查；「外貌矛盾比对」直接升级「外貌描述」维度的实现。理由：38 维编号在多处硬编码——auditor prompt 的编号清单（维度 2/3、轻量模式「23/24/25/26/27 + 1-5 + 6-9 + 35-38」）、`submit_chapter_review` 的维度名逐字校验、`CONTINUITY_DIMENSIONS` 白名单、pipeline prompt 的维度数文案（director/pipeline/review/feedback-intent 多处「38 维」）。新增编号引发全链路位移，收益仅为维度名单多一行；speech/tone 校验与「性格一致（行为符合性格设定）」语义同族，并入自然。

### D2 出场角色按正文文本判定

比对对象是「本章出场的角色」。不能按 character_states 判定——审计在流水线步骤 4，本章状态提交在步骤 6，审计时本章尚无状态记录。实现按角色名在本章正文出现判定出场（与快照按 name 检索同级可靠；别名/称号场景由 LLM 审计兜底）。

### D3 外貌矛盾比对：特征短语 × 方位反义 × 台词排除

- 档案 appearance 按标点切特征短语（如「左脸旧疤；右手持剑」→ 两条）。
- 短语内识别方位词（封闭词表：左/右、上/下、前/后、内/外），去掉方位词后的剩余部分为特征核心（如「脸旧疤」「手持剑」→ 再取部位词「脸」）。
- 正文先剔除引号内台词（『』「」""''），再按句切分；某句同时含同一角色的特征核心与反义方位词 → 矛盾，FAIL，detail 附角色名 + 档案短语 + 正文原句。
- 否定类矛盾（档案「无 X」正文「有 X」）本期不做，词表留扩展位。
- 维度原有 description 填充率检查保留：全部角色无档案时行为与一期完全一致；有档案角色同时参与两检查，矛盾优先（矛盾检出时 detail 以矛盾为主）。

### D4 语癖子检查：字面线索 × 台词命中

- 线索抽取：speech 值中引号内容逐个（『哼』→ 哼）为强线索；无引号时按标点切分取长度 ≥2 的片段为弱线索（宽松召回，WARN 本就是低置信信号，误报由 LLM 兜底）。
- 命中判定：角色本章台词（引号内文本按说话人归属困难，简化为——正文全部台词文本拼接后包含任一线索即算该角色体现；不做说话人精确归属，多人对话互有语癖传染时宁可漏报不误报）。
- 全部线索均未命中 → 「性格一致」维度 WARN，detail 列角色名与线索。
- 范围：speech 非空且本章正文出现（按 D2 判定）的角色；无台词或线索不可字面化 → 跳过。
- 只 WARN 不 FAIL：字面缺失 ≠ 必然违规（语癖可能是语气型不可字面化），进 auditor 轻量审计路径由 LLM 终判。

### D5 auditor prompt 档案对照指示

- 前置动作 2（读取角色）：注明返回中的档案维度行（身体特征/说话习惯/语气/个性/习惯动作/扩展）是角色外貌与言行对照的权威来源。
- 维度 2 说明：补「档案 appearance 非空时，正文外貌描写与档案身体特征矛盾（部位/方位冲突）→ FAIL」。
- 维度 3 说明：补「档案 speech/tone/personality 非空时，对话丢失语癖语气或言行崩设 → FAIL/WARN；动态情绪变化不算档案违规」。
- 轻量模式（settings_focus）维度子集含角色连续性 1-5，无需改清单，指示自动生效。
- 静态断言固化关键句（一期 agent-prompts 测试先例）。

### D6 修订闭环零改动

档案相关违规全部落进既有 ContinuityResult 通道：「外貌描述」FAIL → pipeline 步骤 4 FAIL 分支 → auditor full → 步骤 5 reviser → 重验；「性格一致」WARN → WARN 分支 → auditor settings_focus。pipeline/director/reviser prompt 均不改——它们消费的是维度名与状态，不感知维度内部实现升级。

## 非目标（实现层）

- 不改存储层、协议、UI；不新增 package 依赖。
- 不做 personality 与正文的确定性语义比对。
- 不做否定类外貌矛盾（无↔有）检出。
