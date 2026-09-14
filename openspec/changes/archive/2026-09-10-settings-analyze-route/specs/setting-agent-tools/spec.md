## ADDED Requirements

### Requirement: 分析设定路由包含确定性扫描

当用户请求"分析设定"时，director SHALL 同时调用 lint_settings 获取机器检测的结构化问题清单（非标准分类、空字段、跨分类同标题），并调用 check_novel_settings 拉取全量设定概览供 LLM 评析。最终报告 SHALL 区分两类来源。

#### Scenario: 分析设定同时运行两个扫描

- **WHEN** 用户说"分析设定"
- **THEN** director 先调用 lint_settings 获取结构问题，再调用 check_novel_settings 拉取全量概览
- **THEN** 合并两者的发现，标注每个问题的来源（结构扫描 / LLM 评析）

#### Scenario: 结构问题可直接修复

- **WHEN** 分析报告中 lint_settings 检出的结构问题被用户确认需要修改
- **THEN** director 可用 rename_world_category 批量归类或 update_setting / delete_setting 精修，无需额外扫描

#### Scenario: LLM 评析问题需进一步确认

- **WHEN** 分析报告中 LLM 评析发现的问题不在 lint_settings 的问题列表中
- **THEN** director 在报告中标注该问题为"内容判断，未经结构扫描验证"
