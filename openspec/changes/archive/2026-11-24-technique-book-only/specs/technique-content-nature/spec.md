## MODIFIED Requirements

### Requirement: adult 技法候选双闸门过滤

检索技法候选时，当前书籍库中 `scope=adult` 的技法 MUST 同时通过书级闸门（该书 `content_nature='adult'`）与章节闸门（当前章节判断为成人）才允许进入候选列表；任一闸门不满足则该技法 MUST NOT 进入候选，且不写 shadow 日志。候选池 SHALL 只包含当前书籍库条目，MUST NOT 包含任何全局库条目。

#### Scenario: 通用书召回不到成人技法

- **WHEN** 当前书 `content_nature='general'` 进入写作流水线，本书库存在 `scope=adult` 技法
- **THEN** 候选列表不含任何 `scope=adult` 技法

#### Scenario: 成人书的成人章节双源可见

- **WHEN** 当前书 `content_nature='adult'` 的当前章节判断为成人
- **THEN** 候选只从本书库筛选；通过双闸门的受限分级技法可进入候选，全局库不提供候选

#### Scenario: 闸门不波及全局技法

- **WHEN** 旧全局库已完成退役清理，任何书在任意章节检索候选
- **THEN** 候选结果不因旧全局库条目存在或内容性质闸门产生额外变化
