# Spec Delta

## MODIFIED Requirements

### Requirement: 开启后按预算注入 writer prompt

注入开关开启时,系统 SHALL 将场景匹配的技法候选(含未验证新品曝光位)交给 pipeline agent 逐条评估与当前章节大纲及标题的相关性;agent MAY 通过检索工具发起多轮召回(调整场景类型、名称关键词或层级)后再确认最终列表;仅 agent 确认的技法(默认不超过 3 条)经 1000 token 预算裁剪后以"写作技法指导"段落注入 writer prompt,未确认候选 MUST NOT 注入;每条注入 MUST 同时计入该技法的使用次数与最近使用时间。检索与确认 SHALL NOT 按置信度或状态过滤候选;置信度与 verified/unverified 状态仅作为排序权重,不构成注入门槛。

#### Scenario: 开启注入后写作

- **WHEN** 注入开关开启且存在场景匹配技法
- **THEN** writer prompt 中出现"写作技法指导"段落,且仅包含 agent 评估后确认的技法
- **THEN** 被注入技法的使用次数与最近使用时间被更新

#### Scenario: agent 确认后注入

- **WHEN** 注入开关开启且快照候选非空
- **THEN** pipeline agent 评估后确认的技法出现在 writer prompt 的"写作技法指导"段落,未确认候选不出现在 writer prompt

#### Scenario: 多轮召回后再确认

- **WHEN** 首轮候选与章节内容相关性不足
- **THEN** agent 发起新一轮检索(不同场景类型/关键词/层级)并基于新候选重新确认最终列表

#### Scenario: 超预算裁剪

- **WHEN** 确认列表的预估 token 总量超过 1000
- **THEN** 仅保留预算内、匹配分最高的技法注入

#### Scenario: 新提取技法不被置信度拦截

- **WHEN** 候选包含刚入库的 `unverified`/0.5 技法
- **THEN** 该技法不被置信度门槛拦截,正常参与评估与确认
