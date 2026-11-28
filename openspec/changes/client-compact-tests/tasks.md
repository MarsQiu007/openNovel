# Tasks

## 1. 测试修复（client）

- [ ] 1.1 在 `packages/client/test/promise.test.ts` 为 compact 请求返回 `CompactionAdmission` 契约 JSON 并断言解码结果
- [ ] 1.2 在 `packages/client/test/effect.test.ts` 同步修复 compact mock 并断言解码结果
- [ ] 1.3 `cd packages/client && bun test test/promise.test.ts test/effect.test.ts` 全部通过

## 2. CI 盲区（turbo）

- [ ] 2.1 在 `turbo.json` test pipeline 新增 `@opennovel-ai/client#test` 条目

## 3. 验证与收尾

- [ ] 3.1 `cd packages/client && bun test` 全量通过、`bun typecheck` 通过
- [ ] 3.2 记录 Implementation Commits 并归档
