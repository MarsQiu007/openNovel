## Why

当前设定长文本规则把「全文超过 200 字且没有任何换行」一律判为长单段问题，并会在 AI 写入时拒绝。这个阈值对角色 description、关系描述等内容过于激进，容易把 200–500 字的完整语义段落误判成问题；同时现有校验只看全文是否含换行，不能发现「已有多个段落但其中一段过长」的情况。

## What Changes

- 将设定长文本的硬性校验从「全文超过 200 字且无换行」改为「单个规范化段落超过 600 字」。
- 保留纯文本、禁止 Markdown 和显式换行规范化为 `\n\n` 的规则。
- AI 写入提示继续引导每段约 80–220 字，但不再把 200–600 字的连贯段落视为违规。
- 设定整理 `analyze` 按单个段落长度判断长段落问题；证据标明字段和段落长度，建议控制单段在 80–220 字。
- 自动生成分段计划时只拆分超长段落，保留既有段落结构，并优先在句号、感叹号、问号边界分段。
- 不新增 schema、Protocol 或 UI 契约字段；复用现有 `long_single_paragraph` 问题类型。

### 非目标

- 不限制设定字段的总字数。
- 不移除纯文本和禁止 Markdown 的约束。
- 不迁移或自动改写既有数据库数据；只影响后续 AI 写入和整理建议。
- 不引入用户可配置阈值；先用固定 600 字阈值观察效果。
- 不扩展或修改设定批注的数据模型。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `setting-formatting`: 修改长文本分段校验语义，从全文阈值改为单段阈值，并明确 80–220 字只是提示性目标。
- `setting-reorganization`: 修改整理分析和自动分段建议的长段落判定语义。

## Impact

- `packages/plugin`: 更新 `setting-text.ts`、设定写入工具提示词、`setting-reorganization.ts` 的分析和自动分段逻辑，以及相关测试。
- `packages/app`: 通常无需改动；如长段落证据文案结构变化，仅更新展示和测试。
- `packages/schema` / `packages/protocol` / `packages/client` / `packages/server` / `packages/opennovel`: 预期无契约改动。
- 数据兼容：无数据库迁移；既有 600 字以下的单段不再被整理面板标记，既有超过 600 字的单段仍会收到整理建议。
