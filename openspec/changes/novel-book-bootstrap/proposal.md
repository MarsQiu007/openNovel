# 新书 AI 初始化衔接（novel-book-bootstrap）

> 状态：草稿 — 优先级 P0（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

建书向导只通过 REST 创建书籍壳记录（`packages/app/src/pages/novel/wizard.tsx` → `client()["server.novel"].create`），AI 侧的 `init_novel` 工具与 `@architect` 初始化完全依赖用户在会话里主动说"初始化"。而书内空会话的建议 chip 只有"写下一章"（`chat-empty-state.tsx:65`），`setup_mode` 默认 auto（`novel-store/src/mode.ts:44`）——新用户点"写下一章"会在**零设定状态直接裸写第一章**，产出质量差且第一印象受损。

这是新用户旅程的第一断点：建书成功 ≠ 可以开始写作，中间缺"设定初始化"的衔接。

## What Changes

- 建书向导完成后，提供进入 AI 初始化的显式入口（自动 dispatch `@architect` 生成故事圣经与题材规则书，或引导性建议 chip，方案在 design 阶段决策）。
- 书内空会话的建议 chip 增加"初始化小说设定"选项（零设定状态下优先于"写下一章"展示）。
- 研究可选的兜底防护：零设定状态下 `write_chapter` 是否应拒绝或警告（避免静默裸写）。

## Capabilities

### New Capabilities

- `novel-book-bootstrap`: 建书完成后 AI 初始化的衔接行为——初始化入口的呈现、零设定状态的写作防护。

### Modified Capabilities

（无——`openspec/specs/` 下暂无建书/初始化相关 spec。）

## Impact

- `packages/app`：建书向导完成页、书内空会话建议 chip。
- `packages/plugin`：`init_novel` 工具调用方式、`write_chapter` 防护逻辑（若纳入兜底）。
- `packages/novel-store`：预计无表结构变更（初始化产物落现有设定表）。

**非目标**：本变更不改建书向导的表单结构；不做灵感收集/选题库（另立提案）；不改 `setup_mode` 配置语义。
