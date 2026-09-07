# AI 产出数据呈现（ai-artifacts-ui）

> 状态：已细化 — 优先级 P2（2026-09-08 确认聚合查询 + 检视面板方案）

## Why

流水线沉淀了多类 AI 产出数据，前端零入口：`chapter_summaries`（observer 提取的章节摘要/关键事件/角色变化，仅 AI 注入消费，`novel-writer.ts:291-300`）、`hook_rotation`（钩子记录与统计，`novel-writer.ts:3812,3833`）、卷/段汇总等。这些数据是"AI 理解了什么"的窗口，用户看不到就无法校验状态提取质量，也无法享受钩子统计、摘要速览等阅读价值。

（注：张力数据已由现行张力记录链路承载，独立 tension-graph.ts 已在 orphan-modules-cleanup 中删除。）

## What Changes

- 新增工作台检视面板入口，按章节摘要、钩子轮换、卷/段汇总分区只读展示 AI 产出。

## Capabilities

### New Capabilities

- `ai-artifacts-ui`: AI 产出数据的前端呈现要求（哪些数据、呈现位置、与正文的关系）。

### Modified Capabilities

（无。）

## Impact

- `packages/app`：检视面板/章节详情。
- `packages/server`：可能补查询端点（部分数据现仅插件内部读取）。
- `packages/client`：新增端点需 `bun run generate`。
- **本地数据兼容性**：纯读侧，无迁移。

**非目标**：本变更不提供 AI 产出数据的编辑能力（修正状态提取错误是另一个话题）；不做数据可视化大屏。
