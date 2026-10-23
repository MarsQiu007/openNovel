# Tasks: agent-instruction-layering

> 单波实现（全部落在 `packages/plugin` novel-writer）。设计依据见 design.md（现状盘点与方案）。无上游代码移植（仅借鉴语义，无 Ported-from）。

## Wave 1 — 书稿分层规范发现与快照注入

- [ ] 1.1 规范发现模块（`packages/plugin/src/novel-writer/instructions.ts`）：给定项目目录与当前卷/章号，收集 `.novel/instructions/{book.md, volume-<n>.md, chapter-<n>.md}` 中存在的层（缺失静默跳过、读取失败降级），返回 `{ path, content }[]`（远→近序）
- [ ] 1.2 `ContextPacket` 增加 `instructions` 字段并在 `assembleSnapshot` 接线（卷号取当前章所属卷，无卷书稿只生效 book/chapter 两层）
- [ ] 1.3 渲染：`instructionLines(instructions, truncated)` 渲染 helper（远→近、来源行、预算截断远层留近层、截断提示），`context.ts` 快照渲染与 `tools/context-render.ts` 工具输出共用（对齐 `styleGuideRuleLines` 模式）
- [ ] 1.4 单测：三层收集/缺失跳过/无卷书稿两层/读取失败降级/渲染顺序近者优先/超限截断远层并附提示；快照组装集成断言（instructions 段出现且按层级排序）
- [ ] 1.5 **守门**：`packages/plugin` `bun typecheck` 绿 + 测试全绿；根目录 oxlint 0 errors

## Implementation Commits

（实现完成后用 `git log --grep "OpenSpec-Change: agent-instruction-layering"` 收集填写）

## Workflow follow-up

（归档后如有回归修复在此补充）
