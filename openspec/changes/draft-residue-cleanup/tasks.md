# Tasks

## 1. 修复 browser 测试（CI 阻塞）

- [ ] 1.1 迁移 `packages/app/test-browser/prompt-persistence.test.ts`：旧草稿 scope 改为目录 scope，用例名去掉 draft 措辞，异步水合断言保持不变（验证：`packages/app` 目录 `bun run test:browser` 29/29 全绿）

## 2. 草稿链路残留清理

- [ ] 2.1 `packages/app/src/context/prompt.tsx`：`scopeKey` 删除 `"draftID" in scope` 死分支（验证：`bun run typecheck` 通过）
- [ ] 2.2 `packages/app/src/pages/directory-layout.tsx`：删除无传参的 `draftID?: string` prop（验证：全仓 grep 该 prop 零引用）
- [ ] 2.3 `packages/app/src/pages/sessions.tsx`：`HomeSessionsEmpty` 删除 `onNewSession` prop 与 Show 分支，清理随之无引用的 `ButtonV2` import（验证：typecheck 通过，空态仅渲染文案与说明）
- [ ] 2.4 `packages/app/src/pages/home.tsx`：删除无引用的 `newSessionProject` memo（验证：全仓 grep 零引用 + typecheck 通过）
- [ ] 2.5 `packages/app/src/utils/persist.ts`：删除 `Persist.draft`、`draftStorage`、`DRAFT_PERSISTED_KEYS` 与 `draftPersistedKeys`；`persist.test.ts` 同步删除两个 draft 目标用例（验证：`bun test src/utils/persist.test.ts` 全绿）

## 3. 集成验证

- [ ] 3.1 `packages/app` 目录 `bun run test`（unit + browser）全绿；`bun run typecheck`、`bun run typecheck:e2e` 通过
- [ ] 3.2 `bunx playwright test`（e2e 全量）全绿；仓库根 `bun run lint` 0 errors
- [ ] 3.3 `openspec validate draft-residue-cleanup --strict` 通过，tasks 勾选完整

## Workflow follow-up

- 提交全部实现改动（每个提交带 `OpenSpec-Change: draft-residue-cleanup` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 归档 → 合并 `main` → 推送并确认 GitHub Actions 无报错
