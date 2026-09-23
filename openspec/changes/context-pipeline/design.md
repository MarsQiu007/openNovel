## Context

`assembleWriterSnapshot` 使用章纲作为召回查询文本，一次性获取所有召回结果。Writer 在生成过程中可能需要针对特定剧情点（如某个承诺、某次对话）做定向查询，但当前工具不支持传入自定义查询焦点。见 proposal.md。

## Goals / Non-Goals

**Goals:**
- `assemble_context_snapshot` 新增可选 `focus` 参数
- writer 提示词包含三阶段获取策略
- 不传 focus 时保持向后兼容

**Non-Goals:**
- 不修改 `runRecall` 算法
- 不自动化缺口判断（由 LLM 判断）
- 不新增预算层级

## Decisions

### 1. focus 参数通过替换召回查询文本实现

**选择**：`assembleWriterSnapshot` 新增 `focus?: string` 参数，当传入时用 focus 值替代章纲文本传给 `extractMentionedEntities`，后续三路召回自动围绕该焦点检索。

**理由**：最小改动——只改查询文本来源，不改召回算法。`extractMentionedEntities` 接受任意文本输入，天然支持焦点替换。

### 2. writer 提示词用工作流程步骤重组三阶段

**选择**：将现有工作流程的步骤 0 拆分为三个子步骤（0a 基线、0b 检查、0c 深挖），保持编号清晰。

**理由**：writer 已有编号步骤习惯，子步骤用字母编号避免打乱主流程。

## Risks / Trade-offs

- [writer 可能过度调用深挖] → 提示词明确"信息充分时跳过"，减少不必要的工具调用
- [focus 参数滥用导致快照偏焦] → focus 是可选的补充查询，基线快照始终以章纲为查询源
