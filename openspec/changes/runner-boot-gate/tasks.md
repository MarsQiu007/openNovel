# runner-boot-gate Tasks

## 1. 实现

- [ ] 1.1 `SessionRunner.runTurnAttempt` 在归属校验后、`agents.select` 前等待 `PluginBoot.ready`
- [ ] 1.2 手动 `compact` 在 `agents.select` 前等待 `PluginBoot.ready`
- [ ] 1.3 `llm.ts` 注入 `PluginBoot.Service`，`node` deps 增加 `PluginBoot.node`
- [ ] 1.4 `packages/core` `bun typecheck` 通过、`bun test` 全量通过
- [ ] 1.5 `httpapi-sdk.test.ts` skill 用例隔离运行 10 次全绿（修复前基线 10/10 红）

## 2. 收尾

- [ ] 2.1 收集实现提交写入本文件 `## Implementation Commits`
- [ ] 2.2 `openspec validate runner-boot-gate --strict` 通过
- [ ] 2.3 同步主 specs 后归档（`npx openspec archive --yes`），提交归档移动
