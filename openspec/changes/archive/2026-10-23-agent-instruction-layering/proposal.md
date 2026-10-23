# Proposal: agent-instruction-layering

## Why

写作规范天然是分层的：全书规范（"避免 AI 腔"）→ 分卷规范（"卷二采用双线叙事"）→ 章节规范（"本章大量使用倒叙"）。穷尽式核实（2026-10-23）后的现状：

- fork 的 `packages/core/src/instruction-context.ts` **已有**项目级分层发现：`fs.up` 从工作目录向项目根逐级收集 `AGENTS.md` 并全局兜底，经 system-context 通道注入——项目级前提已满足，本提案不重复建设；
- 真正的缺口在**书稿内部**：章节是 novel-store 的 DB 行、没有目录，全书/卷/章三级写作规范没有生效通道，作者只能在会话里临时口述，不可复现；
- 注入位已存在且单一：写作流水线的快照 P4 段（`packages/plugin/src/novel-writer/context.ts` 的 `styleGuideRuleLines` 与 `assembleSnapshot`），writer/auditor/reviser 共用同一快照组装，挂进去即全覆盖。

上游 openCode 的 `instruction-discovery.ts` 提供「近者优先」的语义参照（其增量 diff 渲染等机制 fork 已由 system-context 通道覆盖，无需移植代码）。

## What Changes

- **书稿内部分层规范约定**：`<project>/.novel/instructions/` 下按层级命名——`book.md`（全书）→ `volume-<n>.md`（第 n 卷）→ `chapter-<n>.md`（第 n 章），Markdown 自由文本，作者直接维护
- **发现与合并**：快照组装时按当前章的卷号/章号收集存在的层，远层先注入、近层后注入（近者优先），缺失层静默跳过
- **注入落点**：`ContextPacket` 增加分层规范段（P4 相邻），快照渲染（`context.ts`）与快照工具输出（`tools/context-render.ts`）共用同一渲染，writer/auditor/reviser 经现有快照通道自动覆盖
- **注入预算**：沿用 P4 既有截断模式，超限时截断远层、保留近层，并附截断提示
- 与记忆系统（agent-memory-system）的边界：规范是"作者定的规则"（稳定、人工维护），记忆是"写作中发现的事实"（增长、agent 沉淀）——两者注入通道独立，本变更不碰记忆

## Capabilities

### New Capabilities

- `agent-instructions`：书稿内部分层写作规范的发现与注入

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`plugin`（novel-writer 规范发现模块与快照组装接线）；`core` 零改动（项目级 AGENTS.md 分层已由 instruction-context 覆盖）
- **数据兼容性**：不涉及数据库；新增的是 `.novel/instructions/` 下的 Markdown 约定文件，不影响既有数据
- **依赖关系**：无前置；与 agent-memory-system 的注入机制可共享实现（同一快照组装层），建议实现时协同但不互相阻塞
- **优先级理由**：工作量小（发现逻辑简单、注入位单一）、见效直接（规范可复现）、风险低

## 非目标

- 不做规范的 UI 编辑器（作者直接改 Markdown 文件）
- 不做规范冲突检测（近层覆盖远层，不做语义校验）
- 不做规范的版本化与回滚（书稿 git 自身即版本化）
- 不在本变更内处理记忆类内容（事实档案走记忆系统通道）
- 不动 `core` 的 instruction-context（项目级 `AGENTS.md` 分层发现已存在）
- 不移植上游 instruction-discovery 代码（仅借鉴「近者优先」语义，无 Ported-from）
