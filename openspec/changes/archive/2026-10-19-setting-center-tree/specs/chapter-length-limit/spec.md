# Spec Delta

## MODIFIED Requirements

### Requirement: 书籍编辑 UI SHALL 提供篇幅限制开关

设定树「写作风格」节点表单 SHALL 提供「篇幅限制」复选框，映射 style_guide.rules.chapter_length_limit；打开节点时 SHALL 按当前 rules 值回填勾选状态，保存时 SHALL 将勾选状态以字符串 "true"/"false" 写入 rules。

#### Scenario: 勾选保存后启用

- **WHEN** 用户在写作风格节点勾选篇幅限制并保存
- **THEN** style_guide.rules.chapter_length_limit 被写入 "true"

#### Scenario: 取消勾选保存后关闭

- **WHEN** 用户取消勾选并保存
- **THEN** style_guide.rules.chapter_length_limit 被写入 "false"

#### Scenario: 打开编辑时回填

- **WHEN** style_guide.rules.chapter_length_limit 为 "true"，用户打开写作风格节点
- **THEN** 篇幅限制复选框呈勾选状态
