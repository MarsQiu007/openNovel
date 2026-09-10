# setting-agent-tools Specification

## Purpose

补全设定的 agent 工具：AI 可读取单条设定全文、按关键词搜索设定内容，消除盲改设定和无法定位设定内容的能力缺口。

## Requirements

### Requirement: AI 可读取单条设定全文

系统 SHALL 提供 read_setting 工具，接受 novel_id、entity_type 和 entity_id，返回该条目的完整字段内容（包括 content/description 等长文本字段）。覆盖 character / world_entry / plot_thread / foreshadowing / volume / relationship 六种类型。

#### Scenario: 读取世界观条目全文

- **WHEN** AI 调用 read_setting 并传入有效的 novel_id、entity_type=world_entry、entity_id
- **THEN** 工具返回该条目的 category、title 和完整 content

#### Scenario: 读取不存在的条目

- **WHEN** AI 调用 read_setting 并传入不存在的 entity_id
- **THEN** 工具返回明确的错误信息（"记录不存在"），不抛出异常

#### Scenario: 传入不支持的实体类型

- **WHEN** AI 调用 read_setting 并传入不支持的 entity_type 值
- **THEN** 工具返回类型不支持错误，列出支持的类型列表

### Requirement: AI 可按关键词搜索设定内容

系统 SHALL 提供 search_settings 工具，接受 novel_id、query（关键词）和可选的 entity_type 过滤，返回标题或内容匹配关键词的条目列表（含条目 ID、类型、标题和上下文片段）。

#### Scenario: 搜索世界观条目内容

- **WHEN** AI 调用 search_settings 传入 novel_id 和 query="爵位"
- **THEN** 工具返回所有 title 或 content 中包含"爵位"的条目，每条附带条目 ID、分类、标题和关键词出现的上下文片段（前后各 50 字符）

#### Scenario: 按类型过滤搜索

- **WHEN** AI 调用 search_settings 传入 entity_type=character 和 query
- **THEN** 工具仅在 character 表中搜索 name 和 description 字段

#### Scenario: 无匹配结果

- **WHEN** AI 调用 search_settings 但没有条目匹配关键词
- **THEN** 工具返回空结果列表和提示信息，不报错

#### Scenario: 空关键词

- **WHEN** AI 调用 search_settings 传入空字符串或仅含空白的 query
- **THEN** 工具返回参数校验错误，提示 query 不能为空