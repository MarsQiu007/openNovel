# 技法注入(technique-injection)

## Purpose

以项目级开关门控技法向 writer prompt 的实际注入:默认关闭保持纯 shadow;开启后按 token 预算将场景匹配的技法以"写作技法指导"段落注入,使技法真正影响正文生成,同时保留检索日志与使用统计。

## Requirements

### Requirement: 注入开关缺省开启

技法注入开关 SHALL 为项目级配置,缺省值为开启:仅显式 boolean `false` 关闭注入;配置键缺失、JSON 损坏或值非法均按开启处理。关闭时,写作流水线 MUST 保持在纯 shadow 行为:候选可见、反馈可用、但不向 writer prompt 注入任何技法内容。

#### Scenario: 默认新项目

- **WHEN** 新建小说项目且未配置注入开关
- **THEN** 注入按开启处理,场景匹配的技法可进入 writer prompt

#### Scenario: 显式关闭保持 shadow

- **WHEN** 项目配置显式写入 `technique_injection: false`
- **THEN** 流水线保持纯 shadow 模式,writer prompt 中无技法内容

#### Scenario: 配置损坏按缺省开启

- **WHEN** 项目配置文件损坏或 `technique_injection` 值非法(如字符串 `"false"`)
- **THEN** 注入按开启处理,不静默降级为 shadow

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

### Requirement: 开关关闭立即回退 shadow

注入开关从开启切回关闭后,下一次组装上下文起,系统 MUST 不再注入技法,且 shadow 检索与反馈闭环照常运行。

#### Scenario: 切回关闭

- **WHEN** 注入开关由开转关后运行流水线
- **THEN** writer prompt 无技法内容,shadow log 仍正常记录

### Requirement: general 场景查询按跨场景召回

召回评估的场景查询为 `general`（章节场景无法从标题与梗概推断、按跨场景处理）时，系统 SHALL NOT 按场景标签过滤候选：全部技法按跨场景候选参与置信度排序与未验证新品曝光位竞争；内容性质分级闸门不受影响，仍按原规则作用于本书池。携带具体场景标签的查询行为不变，仍只召回标签命中的技法与通用身份（空交集历史标签）技法。

#### Scenario: 推断场景为 general 的章节召回非空

- **WHEN** 章节标题与梗概未命中任何场景关键词，推断场景为 `general`，且技法库内技法均携带具体场景标签（无一含 `general`）
- **THEN** 召回返回多于 0 条候选，包含置信度排序前列的技法与未验证新品曝光位条目

#### Scenario: 具体场景查询行为不变

- **WHEN** 章节推断场景为 `description`，库中同时存在标注 `["description"]` 与 `["dialogue"]` 的技法
- **THEN** 仅 `description` 标签技法与通用身份技法进入候选，`["dialogue"]` 技法被过滤

### Requirement: 召回先场景过滤后取数

召回取数 SHALL 先完成场景匹配过滤，再按置信度（并列按入库时间、条目 id 全序）排序取 `limit` 条；MUST NOT 先按数据库条数截断再在内存中过滤场景。未验证新品曝光位同样先过滤后占位；过滤后不足 `limit` 时返回实际匹配数。

#### Scenario: 同置信匹配项多于 limit 时不截断

- **WHEN** 库中存在多于 `limit` 条同置信度且场景匹配的技法，同时存在场景不匹配的技法
- **THEN** 返回的 `limit` 条全部场景匹配，不匹配技法不占用名额

#### Scenario: 匹配项不足 limit 时按实际数量返回

- **WHEN** 场景匹配技法数量少于 `limit`
- **THEN** 召回返回全部匹配项，条数少于 `limit`，不产生虚构候选
