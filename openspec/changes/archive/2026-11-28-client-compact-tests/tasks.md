# Tasks

## 1. 测试修复（client）

- [x] 1.1 在 `packages/client/test/promise.test.ts` 为 compact 请求返回 `CompactionAdmission` 契约 JSON 并断言解码结果
- [x] 1.2 在 `packages/client/test/effect.test.ts` 同步修复 compact mock 并断言解码结果
- [x] 1.3 `cd packages/client && bun test test/promise.test.ts test/effect.test.ts` 全部通过

## 2. CI 盲区（turbo）

- [x] 2.1 在 `turbo.json` test pipeline 新增 `@opennovel-ai/client#test` 条目

## 3. 验证与收尾

- [x] 3.1 `cd packages/client && bun test` 全量通过、`bun typecheck` 通过
- [x] 3.2 记录 Implementation Commits 并归档

## Implementation Commits

- `8a919602d4` docs(openspec): 建立 client-compact-tests 提案
- `bc64d9b3e5` test(client): compact mock 对齐 CompactionAdmission 契约并补 CI 盲区

### 归档后收尾修复

- 修复 import-boundaries.test.ts 的 effect 安装路径解析（CI hoisted 布局下 `packages/client/node_modules` 不存在导致模块顶层 realpathSync ENOENT；候选回退至仓库根 node_modules）——client 纳入 CI 后首次暴露的既有问题
