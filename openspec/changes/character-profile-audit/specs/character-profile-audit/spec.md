# Spec Delta

## Purpose

让角色档案（character-profile 一期产物）真正参与写作一致性把关：正文与档案的矛盾（外貌冲突、对话丢失语癖）由确定性审计检出并进入既有修订闭环，LLM 深度审计逐角色对照档案形成双保险，避免档案沦为只写不读的死数据。

## ADDED Requirements

### Requirement: 外貌描述档案矛盾比对

确定性审计的「外貌描述」维度 SHALL 支持档案矛盾比对：档案 appearance 非空且本章出场的角色，其本章正文叙述与档案 appearance 存在方位/否定类硬矛盾（如档案写「左脸」正文写「右脸」同部位特征）时，该维度 SHALL 记 FAIL 并在详情中给出角色名与矛盾证据；矛盾仅出现在台词（引号内）时 SHALL NOT 记为矛盾（视为角色转述或引用）。无档案、appearance 为空或本章未出场的角色 SHALL NOT 参与比对。

#### Scenario: 正文与档案方位矛盾检出

- **WHEN** 角色档案 appearance 为「左脸旧疤」，本章正文叙述出现该角色「右脸的疤」
- **THEN** 确定性审计「外貌描述」维度记 FAIL，详情含角色名与两处矛盾描述

#### Scenario: 台词内提及不判矛盾

- **WHEN** 档案 appearance 为「左脸旧疤」，本章某角色台词说「你右脸上的疤挺深」
- **THEN** 不记矛盾，「外貌描述」维度按无矛盾处理

#### Scenario: 无档案角色不受影响

- **WHEN** 角色 appearance 为空且 description 非空，本章正常出场
- **THEN** 「外貌描述」维度行为与一期一致（按 description 填充率判定），不产生档案比对噪音

### Requirement: 语癖一致校验

确定性审计的「性格一致」维度 SHALL 追加语癖子检查：档案 speech 非空且本章有台词的活跃出场角色，其本章全部台词均不含档案 speech 中的可字面匹配线索（如引号标注的口癖词）时，该维度 SHALL 记 WARN 并列出角色名；speech 为空、本章无台词或线索不可字面化的角色 SHALL 跳过且不产生噪音。语癖子检查 SHALL NOT 记 FAIL（字面缺失不等于必然违规，最终判定由 LLM 审计兜底）。

#### Scenario: 台词丢失语癖告警

- **WHEN** 角色档案 speech 为「句尾总带『哼』」，本章该角色有 3 句台词且均不含「哼」
- **THEN** 「性格一致」维度记 WARN，详情列出该角色名与语癖线索

#### Scenario: 体现语癖则通过

- **WHEN** 同一角色的台词中出现「哼」相关口癖
- **THEN** 不记 WARN，语癖子检查按通过处理

#### Scenario: 无台词角色跳过

- **WHEN** 角色 speech 非空但本章无台词，或 speech 为空
- **THEN** 语癖子检查跳过该角色，不产生 WARN

### Requirement: LLM 审计档案对照

auditor 深度审计 SHALL 逐角色对照档案：维度「外貌描述」的判定 SHALL 引用档案 appearance 与正文描写比对，维度「性格一致」的判定 SHALL 引用档案 speech/tone/personality 校验言行与对话；档案行经既有 `check_novel_settings(scope="characters")` 返回获取，审计指示 SHALL 要求档案非空时以其为对照源。档案为空的角色 SHALL 按既有方式仅凭 description 审计。

#### Scenario: 深度审计引用档案判定

- **WHEN** auditor 执行全量审计且某活跃角色档案 speech/tone 非空
- **THEN** 审计指示要求其对话判定引用该档案的说话习惯与语气，违反时「性格一致」维度可记 FAIL/WARN

#### Scenario: 轻量模式同样生效

- **WHEN** auditor 以设定聚焦模式审计（含角色连续性维度子集）
- **THEN** 档案对照指示在角色维度子集内同样生效

### Requirement: 修订闭环与误报边界

档案相关违规 SHALL 沿用既有修订闭环：确定性「外貌描述」FAIL 进入既有「FAIL → auditor 深审 → reviser 修订 → 重验」路径，语癖 WARN 进入既有 auditor 轻量审计路径，SHALL NOT 新增独立旁路或阻断逻辑。档案校验 SHALL NOT 把角色动态情绪变化（character_states 记录的章节间情绪差异）判为档案违规——档案是静态设定，情绪演进不是矛盾。

#### Scenario: 外貌矛盾触发修订

- **WHEN** 确定性审计因档案外貌矛盾记 FAIL
- **THEN** 流水线按既有路径 dispatch auditor 深审，确认后 dispatch reviser 修订，修订后重验

#### Scenario: 动态情绪不算违规

- **WHEN** 角色档案 personality 为「外冷内热」，character_states 记录其本章 mood 从「平静」变为「暴怒」
- **THEN** 不作为档案矛盾报告，既有 mood 突变检查行为不变
