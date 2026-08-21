# 长篇创作 B/C 阶段 — 实施计划

> For agentic workers: execute task-by-task. Keep each task independently testable; do not skip the verification gates.

**Goal:** 完成 B 阶段结构质量和 C 阶段协作体验，包括数据层、agent 工具、HTTP API、前端 UI、测试与自审。

**Spec:** `docs/superpowers/specs/2026-08-21-longform-bc-design.md`

**关键约束：**
- 不从仓库根目录跑测试；在各包目录运行 `bun test` 或 `bun typecheck`。
- 生成 prose 使用简体中文；代码、路径、标识符保持 ASCII。
- 不触碰用户在途的 `bun.lock`、根 `package.json`、`packages/session-ui/src/v2/components/prompt-input/index.tsx`，除非任务明确需要且重新确认。
- 修改 public Protocol/Server HttpApi 后运行 `cd packages/client && bun run generate`。
- 保持 A 阶段 `packages/plugin` 全量测试绿灯。

---

## Task 1: novel-store 结构与协作表

**Files:**
- Modify: `packages/novel-store/src/index.ts`
- Modify: `packages/novel-store/src/migrate.ts`
- Add: `packages/novel-store/test/longform-bc.test.ts`

- [ ] Step 1: 写测试覆盖 story arc/beat、volume review、editorial report、annotation、canvas layout 的 CRUD 和级联删除。
- [ ] Step 2: 新增 drizzle 表定义、DDL、索引和外键。
- [ ] Step 3: 实现 CRUD 与 `listStructureForEditor`。
- [ ] Step 4: `cd packages/novel-store && bun test test/longform-bc.test.ts`。
- [ ] Step 5: `cd packages/novel-store && bun test && bun typecheck`。

## Task 2: plugin 确定性结构与批注逻辑

**Files:**
- Add: `packages/plugin/src/novel-writer/structure.ts`
- Add: `packages/plugin/src/novel-writer/annotation.ts`
- Add: `packages/plugin/src/novel-writer/outline-canvas.ts`
- Add: `packages/plugin/test/novel-writer/structure.test.ts`
- Add: `packages/plugin/test/novel-writer/annotations.test.ts`

- [ ] Step 1: 写测试覆盖弧覆盖检查、伏笔/线索风险、段落切分、quote 锚点、stale annotation、润色建议状态。
- [ ] Step 2: 实现纯函数，不直接依赖 LLM。
- [ ] Step 3: `cd packages/plugin && bun test test/novel-writer/structure.test.ts test/novel-writer/annotations.test.ts`。

## Task 3: plugin agent 工具接入

**Files:**
- Modify: `packages/plugin/src/novel-writer.ts`
- Possibly modify: `packages/plugin/src/novel-writer/agents/*.ts`
- Add: `packages/plugin/test/novel-writer/bc-tools.test.ts`

- [ ] Step 1: 注册结构、批注、润色、画布工具。
- [ ] Step 2: 工具 metadata 包含前端可直接消费的结构化字段。
- [ ] Step 3: 更新 director/architect/auditor/reviser 提示词，使其使用工具而非把长报告塞进上下文。
- [ ] Step 4: `cd packages/plugin && bun test && bun typecheck`。

## Task 4: schema/protocol/server HTTP API

**Files:**
- Modify: `packages/schema/src/novel.ts`
- Modify: `packages/protocol/src/groups/novel.ts`
- Modify: `packages/server/src/handlers/novel.ts`
- Add server tests near existing httpapi tests if needed.

- [ ] Step 1: schema 增加 Arc、Beat、VolumeReview、EditorialReport、Annotation、CanvasLayout 及输入类型。
- [ ] Step 2: protocol 增加 list/create/update/delete endpoints；批注和画布放在 `:novelID` 下。
- [ ] Step 3: server handler 调 novel-store，返回 camelCase schema。
- [ ] Step 4: `cd packages/schema && bun typecheck`
- [ ] Step 5: `cd packages/protocol && bun typecheck`
- [ ] Step 6: `cd packages/server && bun typecheck`

## Task 5: 生成 client 并补 app hooks

**Files:**
- Modify: `packages/client/src/generated*` via `bun run generate`
- Modify: `packages/app/src/context/novel-queries.ts`
- Possibly modify: `packages/app/src/context/novel-live.ts`

- [ ] Step 1: `cd packages/client && bun run generate`。
- [ ] Step 2: 新增结构、批注、画布 query/mutation hooks 和 invalidation。
- [ ] Step 3: `cd packages/client && bun typecheck`
- [ ] Step 4: `cd packages/app && bun typecheck`

## Task 6: 前端结构面板与大纲画布

**Files:**
- Add: `packages/app/src/pages/novel/structure-panel.tsx`
- Add: `packages/app/src/pages/novel/outline-canvas.tsx`
- Modify: `packages/app/src/pages/novel/workspace-frame.tsx`
- Modify related novel panel components as needed.

- [ ] Step 1: 结构面板展示卷章轴、叙事弧泳道、节点状态和主编风险。
- [ ] Step 2: 大纲画布支持卷列、章节卡、拖拽移动和布局保存。
- [ ] Step 3: 空状态、加载状态和错误状态可见。
- [ ] Step 4: `cd packages/app && bun typecheck`。

## Task 7: 前端段落批注与润色

**Files:**
- Add: `packages/app/src/pages/novel/annotation-layer.tsx`
- Add: `packages/app/src/pages/novel/annotation-panel.tsx`
- Modify: `packages/app/src/pages/novel/chapter-reader.tsx`
- Modify: `packages/app/src/pages/novel/chapter-editor.tsx`
- Modify: `packages/app/src/pages/novel/workspace-frame.tsx`

- [ ] Step 1: 阅读页按段落选择文字并创建批注。
- [ ] Step 2: 批注面板支持 open/resolved/wontfix/applied 筛选与解决。
- [ ] Step 3: 润色建议展示 quote、suggested replacement、采纳和拒绝。
- [ ] Step 4: stale annotation 可显示但不阻断阅读。
- [ ] Step 5: `cd packages/app && bun typecheck && bun test --preload ./happydom.ts ./src`。

## Task 8: 回归与生成客户端/SDK 校验

- [ ] `cd packages/novel-store && bun test && bun typecheck`
- [ ] `cd packages/plugin && bun test && bun typecheck`
- [ ] `cd packages/server && bun typecheck`
- [ ] `cd packages/app && bun typecheck && bun test --preload ./happydom.ts ./src`
- [ ] 如 public Protocol/Server HttpApi changed, confirm `packages/client/src/generated*` is regenerated.
- [ ] 如 legacy SDK surface changed, run `./packages/sdk/js/script/build.ts` only if required by the actual API change.

## Task 9: 自审与收尾

- [ ] 按严重/重要/一般审查 DB schema、工具层、agent prompt、HTTP API、前端状态和 A 阶段回归。
- [ ] 所有严重问题修复后再提交。
- [ ] `git diff --check`。
- [ ] 只提交本任务相关文件；保留用户在途改动。