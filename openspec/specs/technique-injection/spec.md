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

注入开关开启时,系统 SHALL 将场景匹配的技法候选取 top-5、按 1000 token 预算裁剪,以"写作技法指导"段落注入 writer prompt;每条注入 MUST 同时计入该技法的使用次数与最近使用时间。注入 SHALL NOT 按置信度或状态过滤候选;置信度与 verified/unverified 状态仅作为检索排序权重,不构成注入门槛。

#### Scenario: 开启注入后写作

- **WHEN** 注入开关开启且存在场景匹配技法
- **THEN** writer prompt 中出现"写作技法指导"段落
- **THEN** 被注入技法的使用次数与最近使用时间被更新

#### Scenario: 超预算裁剪

- **WHEN** 候选的预估 token 总量超过 1000
- **THEN** 仅保留预算内、匹配分最高的技法注入

#### Scenario: 新提取技法不被置信度拦截

- **WHEN** 注入开启且场景匹配候选包含刚提取入库的 `unverified`/0.5 技法
- **THEN** 该技法不被置信度门槛拦截,按排序参与 top-5 与预算裁剪

### Requirement: 开关关闭立即回退 shadow

注入开关从开启切回关闭后,下一次组装上下文起,系统 MUST 不再注入技法,且 shadow 检索与反馈闭环照常运行。

#### Scenario: 切回关闭

- **WHEN** 注入开关由开转关后运行流水线
- **THEN** writer prompt 无技法内容,shadow log 仍正常记录
