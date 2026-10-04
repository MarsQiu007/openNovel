# Spec Delta

## ADDED Requirements

### Requirement: 场景匹配空交集回退 general

检索技法候选时，系统 MUST 先将技法的场景标签与规范词表求交；交集为空（历史自由文本数据）时 MUST 按 `general` 身份参与场景匹配，不得因标签词表问题将已入库技法整体排除在候选之外。已有规范标签的技法匹配行为 MUST 与回退机制引入前完全一致。

#### Scenario: 自由文本标签技法可被检索

- **WHEN** 技法 `sceneTypes` 为 `["性感场景","约会场景"]`（无规范值）且本章推断场景类型为 `dialogue`
- **THEN** 该技法按 `general` 身份参与候选排序，不因标签问题被过滤

#### Scenario: 规范标签行为不变

- **WHEN** 技法 `sceneTypes` 为 `["dialogue"]` 且本章推断场景类型为 `dialogue`
- **THEN** 匹配结果与回退机制引入前一致

#### Scenario: 规范标签不匹配的场景仍被排除

- **WHEN** 技法 `sceneTypes` 为 `["action"]` 且本章推断场景类型为 `dialogue`
- **THEN** 该技法不进入候选（非空交集不适用回退）

#### Scenario: 曝光位规则不受回退影响

- **WHEN** 回退机制使一条 `unverified` 自由文本技法进入候选
- **THEN** 候选总数上限、置信度排序与未验证新品曝光位规则保持不变