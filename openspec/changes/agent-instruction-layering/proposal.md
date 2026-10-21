# Proposal: agent-instruction-layering

## Why

写作规范天然是分层的：全局文体规范（"避免 AI 腔"）→ 分卷规范（"卷二采用双线叙事"）→ 章节规范（"本章大量使用倒叙"）。当前 fork 只有单文件的 `instruction-context.ts`，全局一份 AGENTS.md 生效到底——章节级差异规范没有生效通道，agent 只能在会话提示里临时口述，不可复现。上游 openCode 有完整的指令发现体系：`instructions/` 目录 + `instruction-discovery.ts`（按目录层级发现并合并指令文件），语义正是"越靠近工作文件的规范优先级越高"。

## What Changes

- 借鉴上游指令发现语义，实现分层发现：从仓库根到当前章节目录逐层收集规范文件（`AGENTS.md` 或 `INSTRUCTIONS.md`，命名待讨论），近者优先、远者兜底
- 与写作流水线衔接：起草/审校/修订各阶段注入对应层级的规范集合
- 与记忆系统（agent-memory-system）的边界：规范是"作者定的规则"（稳定、人工维护），记忆是"写作中发现的事实"（增长、agent 沉淀）——两者注入通道独立，本变更不碰记忆
- 注入预算：分层合并后体量受控，超限时近层优先

## Capabilities

### New Capabilities

- `agent-instructions`：分层指令文件的发现与注入

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（instruction-context 增强）、`plugin`（各阶段注入点）、`opennovel`（无直接改动）
- **数据兼容性**：不涉及数据库；新增的是书稿目录内的 Markdown 约定文件，不影响既有数据
- **依赖关系**：无前置；与 agent-memory-system 的注入机制可共享实现（同一上下文组装层），建议实现时协同但不互相阻塞
- **优先级理由**：工作量小（发现逻辑简单、上游有语义参照）、见效直接（规范可复现）、风险低

## 非目标

- 不做规范的 UI 编辑器（作者直接改 Markdown 文件）
- 不做规范冲突检测（近层覆盖远层，不做语义校验）
- 不做规范的版本化与回滚（书稿 git 自身即版本化）
- 不在本变更内处理记忆类内容（事实档案走记忆系统通道）
