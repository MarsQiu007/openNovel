# Spec Delta

## MODIFIED Requirements

### Requirement: 技法来源徽标与性质编辑

技法列表 SHALL 合并展示本书库与全局通用库条目，并以徽标标明来源（通用库/本书）；用户 SHALL 能编辑技法的 `scope`，创建技法时 SHALL 能选择归属库（默认本书 + general）；表单中 `scope=成人内容` 的说明文案 MUST 反映真实过滤语义：仅书级内容性质判为成人且当前章节判断为成人时该技法才进入写作候选，其他书与其他章节不可见。

#### Scenario: 合并列表区分来源

- **WHEN** 用户打开技法库面板且全局库与本书库均有技法
- **THEN** 列表同时展示两库条目，每条注明来源徽标，可按来源筛选

#### Scenario: 修正错误性质标注

- **WHEN** 用户发现某全局技法的 scope 被误判
- **THEN** 编辑 scope 后该技法迁移到对应库（general→全局，adult→本书）

#### Scenario: 成人内容语义可理解

- **WHEN** 用户在表单中选择"成人内容"
- **THEN** 界面说明该标记的实际效果（仅成人书的成人章节召回），用户不再预期"当前书立即隐藏"

## ADDED Requirements


