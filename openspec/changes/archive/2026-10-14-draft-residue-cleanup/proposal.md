# Proposal

## Why

`session-book-only`（已归档）退役独立会话路由与草稿链路后，main 上 test workflow 转红：

1. **packages/app browser 测试 1 项失败（CI 阻塞，linux/windows 双平台）**。
   `test-browser/prompt-persistence.test.ts` 仍以旧草稿 scope
   `Prompt.createPromptSession(ServerScope.local, { draftID: "draft-async" })` 创建会话；
   该 scope 已随草稿链路从 `PromptScope` 类型中移除，运行时 `scope.dir` 为 undefined，
   在 `pathKey(undefined)` 处抛 `TypeError: undefined is not an object (evaluating 'value[1]')`。
   本地 `bun run test:browser` 与 CI unit 双平台均复现（28 pass / 1 fail）。
   e7912e0dc（合并前 main）同套件为绿，确认由 session-book-only 的草稿链路移除引入。
2. **草稿链路残留死代码**。审计发现 session-book-only 未清理干净的引用：
   `prompt.tsx` scopeKey 的 draftID 分支、`directory-layout.tsx` 未被传参的 draftID prop、
   `sessions.tsx` HomeSessionsEmpty 未被传参的 onNewSession 分支、`home.tsx` 无引用的
   newSessionProject memo、`persist.ts` 仅被自身测试引用的 Persist.draft / draftStorage /
   draftPersistedKeys。

## What Changes

- 迁移 prompt-persistence browser 测试到目录 scope（异步水合门控语义不变、断言不变），
  恢复 packages/app `bun run test` 全绿与 CI unit 门禁。
- 清理上述五处草稿链路残留死代码（含同步删除 persist.test.ts 中两个 draft 目标用例）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。本变更为缺陷对齐与死代码清理，不改变任何可观察行为；`.openspec.yaml` 设置
skip_specs: true，与 2026-10-10-test-suite-hygiene 先例一致。）

## 非目标

- 不改动任何产品行为与持久化格式；遗留草稿存储键 `opennovel.draft.*` 的数据不做迁移或清理。
- 不迁移 `e2e/performance/timeline/` 基准套件（基于会话标签/草稿页的旧场景属该套件整体迁移
  事项；该套件为手动运行、不在 CI 与 e2e/tsconfig 门禁内）。
- 不处理本变更未触及的其他历史残留（如 e2e/tsconfig.json 中他人删除 spec 后的过期 include 条目）。

## Impact

- **packages/app/test-browser/prompt-persistence.test.ts**：scope 迁移 + 用例改名。
- **packages/app/src**：context/prompt.tsx、pages/directory-layout.tsx、pages/sessions.tsx、
  pages/home.tsx、utils/persist.ts、utils/persist.test.ts（仅删死代码与对应用例）。
- CI：修复后 main 的 test workflow（unit linux/windows）应转绿；e2e 作业不受影响。
