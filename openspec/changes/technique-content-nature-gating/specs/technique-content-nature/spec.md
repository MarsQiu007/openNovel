# Spec Delta

## Purpose

为写作召回提供书级与章节级的内容性质判定能力：agent 自动判断、结果缓存、人工可覆盖，并据此对成人技法候选施加双闸门过滤，使成人内容技法只在真正写作成人内容时进入候选。

## ADDED Requirements

### Requirement: 书级内容性质自动判定
每本书 SHALL 维护一个内容性质（`adult`/`general`），默认为自动判定模式。自动模式下系统 SHALL 懒加载判断一次：综合书名、简介、章纲与已有章节由 agent 给出性质结论，写入书籍配置并缓存复用，同一本书不因每次召回重复判断。书库中已存在 `scope=adult` 技法的书 MUST 直接判为 `adult`（被动信号优先，跳过 LLM 判断）。

#### Scenario: 自动判定并缓存
- **WHEN** 一本从未判定过内容性质的书首次需要召回且书库中没有 adult 技法
- **THEN** agent 根据书籍元数据给出性质结论并写入配置，本次与后续召回复用该结论

#### Scenario: 被动信号短路
- **WHEN** 书库中已存在 `scope=adult` 的技法，书级性质尚未判定
- **THEN** 该书直接判为 `adult`，不发起 LLM 判断

#### Scenario: 纯通用书零开销
- **WHEN** 书库中没有任何 `scope=adult` 技法且书级性质已判为 `general`
- **THEN** 写作召回不进行任何额外判断，adult 闸门过滤快速通过

### Requirement: 书级内容性质人工覆盖
用户 SHALL 能将书级内容性质设为自动/成人/通用；人工覆盖值 MUST 优先于 agent 自动判定值立即生效，用户恢复自动后重新按判定规则取值。

#### Scenario: 手动覆盖为通用
- **WHEN** agent 将某书误判为 adult，用户手动改为通用
- **THEN** 该书的 adult 技法候选立即按通用规则过滤，无需等待重新判定

#### Scenario: 恢复自动判定
- **WHEN** 用户将覆盖值恢复为自动
- **THEN** 系统重新按自动判定规则（含被动信号）取值并缓存

### Requirement: 章节级内容性质判断
组装写作上下文快照时，系统 SHALL 由 agent 判断当前章节的内容走向（成人/通用）。该判断仅在本书库存在 `scope=adult` 技法时启用；纯通用书 MUST 跳过该判断且不产生额外调用。章节判断随当次召回进行，MUST NOT 持久化存储。

#### Scenario: 成人书中的非成人章节
- **WHEN** 书级性质为 adult 的书正在写作一场战斗章节
- **THEN** 章节级判断给出通用结论，本场召回的候选不含 adult 技法

#### Scenario: 纯通用书快速路径
- **WHEN** 书库中不存在任何 adult 技法
- **THEN** 召回组装不发起章节内容性质判断，候选行为与既有完全一致

### Requirement: adult 技法候选双闸门过滤
检索技法候选时，本书库中 `scope=adult` 的技法 MUST 同时通过书级闸门（该书内容性质为 adult）与章节闸门（当前章节判断为成人）才允许进入候选列表；任一闸门不满足则该技法 MUST NOT 进入候选，且不写 shadow 日志。全局通用库中的 `general` 技法 MUST NOT 受此过滤影响。

#### Scenario: 通用书召回不到成人技法
- **WHEN** 通用书（书级判为 general）进入写作流水线，本书库存在 adult 技法
- **THEN** 候选列表不含任何 `scope=adult` 技法

#### Scenario: 成人书的成人章节双源可见
- **WHEN** 书级判为 adult 的书当前章节判断为成人
- **THEN** 候选同时包含全局 general 技法与本书 adult 技法

#### Scenario: 闸门不波及全局技法
- **WHEN** 任何书在任意章节检索候选
- **THEN** 全局通用库技法的可见性与既有行为完全一致
