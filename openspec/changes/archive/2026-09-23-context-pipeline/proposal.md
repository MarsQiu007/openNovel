## Why

当前上下文组装是一次性静态流程：`assembleWriterSnapshot` 调用一次后直接输出快照。writer 在生成过程中遇到需要前文细节的场景时，只能依赖快照中已有的召回结果，如果不够精确需要自行判断是否调用 `recall_history`——但提示词中缺乏系统性的多轮查询引导。用户需要一个"反复获取需要的内容来组装"的管线式架构。

## What Changes

- 在 writer 提示词的工作流程中明确三阶段上下文获取策略：快照 → 检查缺口 → 深挖
- writer 生成前的 `assemble_context_snapshot` 调用升级为可选的多次调用模式（每次传入不同的查询焦点）
- `assemble_context_snapshot` 工具新增 `focus` 参数：传入关键词时，召回查询以该关键词为焦点（而非默认章纲）
- 预算系统支持快照输出的 token 估算元数据，writer 可据此判断是否需要深挖

## Capabilities

### New Capabilities

- `context-pipeline`: 多阶段上下文获取管线，writer 可反复查询并组装所需内容

### Modified Capabilities

（无——不修改现有 spec 的需求）

## 非目标

- 不修改 `runRecall` 三路召回算法
- 不修改预算分层结构（P0-P6）
- 不新增数据库表
- 不自动化"判断上下文够不够"的逻辑（由 LLM 判断）

## Impact

- **packages/plugin**：`novel-writer/recall.ts`（`assembleWriterSnapshot` 新增 `focus` 参数）、`novel-writer.ts`（`assemble_context_snapshot` 工具 args 新增 `focus`）、`novel-writer/agents/writer.ts`（提示词三阶段策略）
- **兼容性**：不修改数据库 schema、不修改 API 契约；`focus` 为可选参数，不传时行为与之前完全一致
- **用户可见变化**：writer 生成长篇章时能主动多轮查询前文细节，上下文更精准
