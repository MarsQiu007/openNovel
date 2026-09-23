## Purpose

多阶段上下文获取管线：writer 可通过快照→检查缺口→聚焦深挖的三阶段流程反复查询前文内容，按需组装精准上下文。

## ADDED Requirements

### Requirement: assemble_context_snapshot 支持焦点参数

`assemble_context_snapshot` 工具 SHALL 新增可选参数 `focus`（string 类型）。当传入 `focus` 时，召回查询文本以该参数的值替代默认章纲文本，使三路召回围绕该焦点检索相关前文。不传 `focus` 时行为与之前完全一致（使用章纲作为查询文本）。

#### Scenario: 传入焦点关键词时召回聚焦

- **WHEN** writer 调用 `assemble_context_snapshot` 并传入 `focus: "主角与李四的决裂"`
- **THEN** 召回查询以该文本为基准执行实体提取和 FTS 检索
- **AND** 召回结果优先返回与"决裂"相关的前文章节摘要

#### Scenario: 不传焦点时保持默认行为

- **WHEN** writer 调用 `assemble_context_snapshot` 不传 `focus`
- **THEN** 召回查询使用章纲文本（与之前行为一致）
- **AND** 不影响快照的其他部分

### Requirement: writer 提示词包含三阶段上下文获取策略

writer 的系统提示词 SHALL 包含三阶段上下文获取策略描述：第一阶段调用 `assemble_context_snapshot` 获取基线快照；第二阶段根据本章剧情检查基线快照是否有信息缺口；第三阶段对缺口调用 `assemble_context_snapshot`（传入 `focus` 关键词）或 `recall_history` 深挖。

#### Scenario: 提示词包含三阶段指引

- **WHEN** 阅读 writer 系统提示词的工作流程
- **THEN** 包含"获取基线快照"步骤
- **AND** 包含"检查信息缺口"步骤
- **AND** 包含"聚焦深挖"步骤

#### Scenario: 信息充分时跳过深挖

- **WHEN** 基线快照的召回结果已覆盖本章所需的前文信息
- **THEN** writer 不需要执行第三阶段深挖
- **AND** 直接进入章节正文生成
