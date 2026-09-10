# setting-formatting Specification

## Purpose

约束设定内容的排版格式：AI 写入设定时必须用空行分段，且长文本必须是纯文本；前端阅读器按段落渲染，确保设定内容可读、可选中、为后续批注功能提供段落锚点结构。

## Requirements

### Requirement: AI 写入设定内容必须分段

save_novel_settings 工具的描述和 observer / architect 的系统提示 SHALL 明确要求 world_entry 的 content 字段使用 `\n\n` 作为段落分隔符，禁止将全部内容写在同一行。

#### Scenario: AI 创建世界观条目时分段

- **WHEN** AI 通过 save_novel_settings 创建一条 content 超过 200 字的 world_entry
- **THEN** tool description 和系统提示已明确指示 AI 用 `\n\n` 分段，AI 返回的 content 包含至少一个 `\n\n` 分隔符

#### Scenario: AI 更新世界观条目时分段

- **WHEN** AI 通过 update_setting 修改一条 world_entry 的 content
- **THEN** tool description 已明确指示 AI 保持 `\n\n` 分段格式

### Requirement: 前端设定阅读器按段落渲染

设定中心的条目详情 SHALL 将 content 中的显式换行视为段落边界：先清理空行和行首尾空白，再将每段渲染为独立的 `<p>` 元素并携带 `data-paragraph-index` 属性（从 0 开始递增）。没有任何换行的内容 SHALL 渲染为单段落。设定详情 SHALL 使用与大纲阅读器一致的最大 3xl 居中栏位排版，但不复用章节阅读器的衬线正文样式、背景色块和首行缩进。

#### Scenario: 有分段的设定内容展示为多段落

- **WHEN** 一条 world_entry 的 content 包含 `\n\n` 分隔
- **THEN** 阅读器渲染出多个 `<p data-paragraph-index>` 元素，每个对应一个段落

#### Scenario: 旧数据包含单个换行

- **WHEN** 一条 world_entry 的 content 使用单个 `\n` 分隔主题（存量数据）
- **THEN** 阅读器将其拆分为多个 `<p data-paragraph-index>` 元素

#### Scenario: 无换行的设定内容展示为单段落

- **WHEN** 一条 world_entry 的 content 不包含任何换行（如旧数据或单句设定）
- **THEN** 阅读器渲染出一个 `<p data-paragraph-index="0">` 元素

#### Scenario: 设定阅读器不再使用 Markdown 渲染

- **WHEN** 设定条目的 content 中包含 Markdown 语法（如 `**加粗**` 或 `- 列表项`）
- **THEN** 阅读器按纯文本原样展示，不解析为 HTML
### Requirement: AI 写入设定内容必须使用纯文本并分段

save_novel_settings / update_setting 等设定写入工具 SHALL 要求长文本字段为纯文本，SHALL 拒绝包含常见 Markdown 语法的内容；显式换行 SHALL 在写入时规范化为 `\n\n` 段落分隔符。超过 200 字且完全没有换行的内容 SHALL 被拒绝。observer / architect 系统提示 SHALL 同步禁止 Markdown 标题、加粗、列表、链接和代码块，并要求长内容分段。

#### Scenario: AI 写入包含 Markdown 的内容

- **WHEN** AI 通过 save_novel_settings 或 update_setting 写入包含 `##`、`**`、`- 列表项` 或链接语法的内容
- **THEN** 工具返回纯文本格式错误，不写入该内容

#### Scenario: AI 写入纯文本长内容

- **WHEN** AI 写入不含 Markdown 语法的多段内容
- **THEN** 工具正常保存该内容

#### Scenario: AI 写入超过 200 字的单段内容

- **WHEN** AI 通过 save_novel_settings 或 update_setting 写入超过 200 字且不包含 `\n\n` 的长文本
- **THEN** 工具返回分段格式错误，不写入该内容

#### Scenario: AI 写入包含单个换行的长内容

- **WHEN** AI 通过 save_novel_settings 或 update_setting 写入使用单个 `\n` 分段的长文本
- **THEN** 工具将其规范化为 `\n\n` 后保存

#### Scenario: 设定详情排版适配面板

- **WHEN** 用户在设定中心查看世界观条目详情
- **THEN** 内容位于与大纲阅读器一致的 `max-w-3xl` 居中栏位中，不出现章节阅读器的背景块或两字首行缩进
