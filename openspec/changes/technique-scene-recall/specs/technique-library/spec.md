# Spec Delta

## ADDED Requirements

### Requirement: 技法场景标签收敛至规范词表

所有入库路径（CLI 提取、对话学习、种子导入）产出的技法，其 `sceneTypes` MUST 只包含规范场景词表中的值（`action`、`dialogue`、`description`、`suspense`、`emotion_shift`、`transition`、`general`）；与词表求交后为空时 MUST 回退为 `["general"]`。该校验 MUST 在规范化层统一执行，不依赖单条路径的 LLM 自觉。

#### Scenario: 自由文本标签被收敛

- **WHEN** 对话学习产出的候选 `sceneTypes` 为 `["性感场景","约会场景"]`
- **THEN** 入库时非规范值被丢弃、空交集回退，最终入库标签为 `["general"]`

#### Scenario: 混合标签保留规范值

- **WHEN** 候选 `sceneTypes` 为 `["dialogue","约会场景"]`
- **THEN** 最终入库标签为 `["dialogue"]`

#### Scenario: 各入库路径行为一致

- **WHEN** 同一批候选分别经 CLI 提取、对话学习、种子导入入库
- **THEN** 三条路径的收敛规则与结果一致

#### Scenario: 标签缺省维持默认

- **WHEN** 候选未提供 `sceneTypes`（undefined）
- **THEN** 维持既有行为，默认 `["general"]`