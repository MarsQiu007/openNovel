## ADDED Requirements

### Requirement: AI 可创建和跟踪设定批注

系统 SHALL 提供 `annotate_setting`、`list_setting_annotations`、`resolve_setting_annotation` 和 `report_setting_annotation_execution` 工具。AI 创建批注 SHALL 只使用真实 world_entry ID 和真实原文锚点；列表 SHALL 返回状态、锚点、引用文本和评论；解决 SHALL 只允许 open、resolved、wontfix、applied；执行回填 SHALL 校验轮次存在。工具描述和 director 提示词 SHALL 禁止虚构 ID、绕过执行轮次、自动删除设定或写入 Markdown。

#### Scenario: AI 创建设定批注

- **WHEN** AI 调用 `annotate_setting` 并传入真实 world_entry ID、锚点和评论
- **THEN** 系统保存 source=ai 的 open 批注并返回批注 ID

#### Scenario: AI 查询批注

- **WHEN** AI 调用 `list_setting_annotations` 并按状态过滤
- **THEN** 工具返回匹配批注的 ID、段落索引、偏移量、引用文本、评论、替换建议和状态

#### Scenario: AI 标记批注状态

- **WHEN** AI 调用 `resolve_setting_annotation` 把批注标记为 wontfix
- **THEN** 系统更新状态并返回新状态

#### Scenario: AI 回填执行结果

- **WHEN** AI 调用 `report_setting_annotation_execution` 传入有效轮次、completed 或 failed 状态和结果摘要
- **THEN** 系统更新轮次并返回回填结果

#### Scenario: 拒绝虚构批注或轮次

- **WHEN** AI 使用不存在的 world_entry ID、批注 ID 或执行轮次 ID
- **THEN** 工具返回明确错误，不创建或修改数据
