# Spec Delta

## MODIFIED Requirements

### Requirement: 书籍信息节点单一数据源
「书籍信息」节点 SHALL 承载书名、简介、类型的查看与编辑，是书籍元数据的唯一编辑入口；写作风格字段（tone / pov / tense / rules / 字数下限 / 字数上限）SHALL 只在「AI 设定 > 写作风格」节点编辑，不得出现在书籍信息表单中。

#### Scenario: 书籍信息编辑生效

- **WHEN** 用户在「书籍信息」节点修改书名并保存
- **THEN** 工作台头部书名同步更新，且不改动任何风格字段

#### Scenario: 风格字段不出现在书籍信息表单

- **WHEN** 用户打开「书籍信息」节点的编辑表单
- **THEN** 表单中只有书名、简介、类型等元数据字段，没有 tone / pov / tense / rules 字段
