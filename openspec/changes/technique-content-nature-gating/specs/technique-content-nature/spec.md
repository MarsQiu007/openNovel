# Spec Delta

## Purpose

为写作召回提供书级与章节级的内容性质判定能力：书级由被动信号确定性判定、人工可覆盖，章节级由调用方 agent 经工具参数给出，并据此对成人技法候选施加双闸门过滤，使成人内容技法只在真正写作成人内容时进入候选。

## ADDED Requirements

### Requirement: 书级内容性质被动信号判定
每本书 SHALL 维护一个内容性质（`adult`/`general`），默认为自动模式。自动模式下系统 SHALL 以被动信号确定性判定：书库中存在 `scope=adult` 技法时该书为 `adult`，否则为 `general`。该判定 MUST 为纯数据查询（不产生 LLM 调用），并 MUST 随书库技法变化即时反映——新增 adult 技法即转 `adult`，adult 技法全部删除或改标 general 即回落 `general`。

#### Scenario: 含成人技法的书判为 adult
- **WHEN** 书库中已存在 `scope=adult` 的技法且书级性质从未被人工设置
- **THEN** 该书自动判为 `adult`，写作召回启用章节级闸门

#### Scenario: 纯通用书零开销
- **WHEN** 书库中没有任何 `scope=adult` 技法
- **THEN** 该书判为 `general`，写作召回的 adult 闸门快速通过，无任何额外调用

#### Scenario: 成人技法清空后回落
- **WHEN** 书库中最后一条 `scope=adult` 技法被删除或改标为 `general`
- **THEN** 该书书级性质自动回落为 `general`

### Requirement: 书级内容性质人工覆盖
用户 SHALL 能将书级内容性质设为自动/成人/通用；人工覆盖值 MUST 优先于被动信号立即生效，用户恢复自动后重新按被动信号取值。

#### Scenario: 手动覆盖为通用
- **WHEN** 用户希望某本含 adult 技法的书在写作中不召回 adult 技法，手动将书级性质改为通用
- **THEN** 该书的 adult 技法候选立即按通用规则过滤，无需等待任何重新判定

#### Scenario: 恢复自动判定
- **WHEN** 用户将覆盖值恢复为自动
- **THEN** 系统重新按被动信号（书库是否存在 adult 技法）取值

### Requirement: 章节级内容性质判断
组装写作上下文快照时，调用方 agent SHALL 通过工具参数给出当前章节的内容性质判断（成人/通用）；该参数仅在本书库存在 `scope=adult` 技法且书级性质为 adult 时影响候选。参数缺失或非法时系统 MUST 按非成人处理（从紧）。章节判断随当次召回进行，MUST NOT 持久化存储，且工具执行层 MUST NOT 为此发起额外 LLM 调用。

#### Scenario: 成人书中的非成人章节
- **WHEN** 书级性质为 adult 的书正在写作一场战斗章节，调用方判断本章为非成人
- **THEN** 该次召回的候选不含 adult 技法

#### Scenario: 参数未传从紧
- **WHEN** 调用方未传章节内容性质参数（旧提示词、自定义调用方）
- **THEN** 按非成人处理，adult 技法候选不出现

#### Scenario: 纯通用书快速路径
- **WHEN** 书库中不存在任何 adult 技法
- **THEN** 章节参数不影响候选，候选行为与既有完全一致

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
