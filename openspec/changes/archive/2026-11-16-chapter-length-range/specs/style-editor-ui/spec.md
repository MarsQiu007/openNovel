# Spec Delta

## ADDED Requirements

### Requirement: 规则行 SHALL NOT 占用字数上下限保留键
规则行编辑 SHALL 拒绝键为 `chapter_length` 或 `chapter_length_max` 的自由行：保存前 SHALL 标示该行并提示改用常驻「字数下限/字数上限」字段，SHALL NOT 以规则行的值覆盖常驻字段值。

#### Scenario: 手动添加下限键被阻止
- **WHEN** 用户将某条规则行的键填写为 `chapter_length` 并点击保存
- **THEN** 保存被阻止，该行被标示并提示改用常驻字数下限字段，常驻字段值不受影响

#### Scenario: 手动添加上限键被阻止
- **WHEN** 用户将某条规则行的键填写为 `chapter_length_max` 并点击保存
- **THEN** 保存被阻止，该行被标示并提示改用常驻字数上限字段，常驻字段值不受影响

## REMOVED Requirements

### Requirement: 篇幅限制承载不变
**Reason**: 「篇幅限制」复选框与 `chapter_length_limit` 保留键机制随 ±15% 容差整体移除，写作风格编辑器改由常驻「字数下限/字数上限」字段承载区间配置。
**Migration**: 回填、序列化与校验语义由「书籍编辑 UI SHALL 提供常驻字数下限与上限字段」（chapter-length-limit 能力）与「规则行 SHALL NOT 占用字数上下限保留键」（本能力）承接；规则行编辑不再涉及字数上下限键。
