# Spec Delta

## REMOVED Requirements

### Requirement: 注入开关默认关闭

**Reason**: 缺省值从关闭反转为开启,原 requirement 的名称与内容均不再成立。
**Migration**: 已显式写入 `technique_injection: false` 的项目保持关闭;从未配置该键的项目从 shadow 变为注入(技法库为空的项目无可感知变化),想保持 shadow 的用户显式关闭一次即可。

## ADDED Requirements

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

## MODIFIED Requirements

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
