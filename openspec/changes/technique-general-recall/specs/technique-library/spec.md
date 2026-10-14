# Spec Delta

## ADDED Requirements

### Requirement: 检索工具空结果反馈区分空库与无匹配

`search_techniques` 检索无结果时 SHALL 区分两种情形给出反馈：本书库与全局库均无条目时，明确反馈"技法库为空"；库内存在条目但当前过滤条件下无匹配时，反馈 MUST 包含库内总条数、说明过滤条件命中 0 条，并提示可移除或放宽过滤条件，MUST NOT 表述为"技法库为空"。

#### Scenario: 有过滤条件但库非空

- **WHEN** 双库共 36 条技法且全部为 `unverified`，agent 以 `status=verified` 发起检索
- **THEN** 工具返回说明过滤后无匹配、库内共 36 条且均为未验证状态，并提示可移除状态过滤，不得表述为技法库为空

#### Scenario: 双库均无条目

- **WHEN** 本书库与全局库均无任何技法，agent 发起任意检索
- **THEN** 工具明确反馈技法库为空（两库均无条目）
