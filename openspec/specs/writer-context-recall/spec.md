# writer-context-recall Specification

## Purpose
让 writer agent 在生成章节时通过完整的上下文组装工具获取三路召回的历史信息，解决中后期章节因上下文空洞导致的剧情偏移。

## Requirements

### Requirement: writer 必须能获取完整召回上下文

writer agent SHALL 拥有调用 `assemble_context_snapshot` 工具的权限。writer 在生成章节正文前 SHALL 调用该工具获取包含三路召回（实体重叠 + FTS5 + 伏笔强制）的完整上下文快照，而不是仅依赖会话启动时注入的轻量快照。

#### Scenario: 生成第 9 章时获取前文召回

- **WHEN** writer 准备生成第 9 章正文
- **THEN** writer 调用 `assemble_context_snapshot` 获取完整快照
- **AND** 快照的 `recalledHistory` 字段包含从第 1-5 章中按本章大纲相关性召回的摘要
- **AND** writer 上下文中能看到第 1-5 章的关键事件和角色关系

#### Scenario: 快照中召回为空时仍可正常生成

- **WHEN** 本章大纲中没有匹配到任何前文实体
- **THEN** `assemble_context_snapshot` 返回的 `recalledHistory` 为空数组
- **AND** writer 不因召回为空而阻塞，仍基于最近 3 章 + 章纲正常生成

### Requirement: 会话级上下文注入须包含召回结果

`injectSystemContext` SHALL 使用 `assembleWriterSnapshot`（而非轻量 `assembleSnapshot`）组装会话级上下文，确保会话启动时的系统注入已包含三路召回结果和受保护关系选择。

#### Scenario: 会话启动时注入包含召回

- **WHEN** 写作会话启动且存在已提交章节
- **THEN** `injectSystemContext` 调用 `assembleWriterSnapshot` 组装快照
- **AND** 注入的上下文包含 `recalledHistory` 渲染结果（若有召回命中）
- **AND** 注入的上下文包含受保护关系和角色绑定视图

### Requirement: writer 提示词须引导主动召回

writer 的系统提示词 SHALL 包含以下指引：在生成前调用 `assemble_context_snapshot`；当需要前文具体细节（承诺、数字、对话、地点描写）且快照召回不够时，SHALL 主动调用 `recall_history` 深挖。

#### Scenario: 提示词包含召回步骤

- **WHEN** 阅读 writer 系统提示词
- **THEN** 工作流程步骤中包含"调用 assemble_context_snapshot 获取完整上下文"
- **AND** 包含"需要前文细节时调用 recall_history"的指引

#### Scenario: 生成中主动深挖

- **WHEN** writer 在写一段对话，需要引用第 3 章的某个承诺
- **THEN** writer 调用 `recall_history` 查询该承诺
- **AND** 在正文中以故事层时间或因果衔接引用该承诺，不使用控制层坐标
