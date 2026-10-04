# Spec Delta

## ADDED Requirements

### Requirement: 技法来源徽标与性质编辑

技法列表 SHALL 合并展示本书库与全局通用库条目，并以徽标标明来源（通用库/本书）；用户 SHALL 能编辑技法的 `scope`，创建技法时 SHALL 能选择归属库（默认本书 + general）。

#### Scenario: 合并列表区分来源

- **WHEN** 用户打开技法库面板且全局库与本书库均有技法
- **THEN** 列表同时展示两库条目，每条注明来源徽标，可按来源筛选

#### Scenario: 修正错误性质标注

- **WHEN** 用户发现某全局技法的 scope 被误判
- **THEN** 编辑 scope 后该技法迁移到对应库（general→全局，adult→本书）