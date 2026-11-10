# runner-boot-gate Tasks

## 1. 实现

- [x] 1.1 `SessionRunner.runTurnAttempt` 在归属校验后、`agents.select` 前等待 `PluginBoot.ready`
- [x] 1.2 手动 `compact` 在 `agents.select` 前等待 `PluginBoot.ready`
- [x] 1.3 `llm.ts` 注入 `PluginBoot.Service`，`node` deps 增加 `PluginBoot.node`
- [x] 1.4 `packages/core` `bun typecheck` 通过、`bun test` 全量通过（本机既有 Windows 环境失败 `LocationServiceMap > rejects an unavailable selected model` 除外：main 基点全量同红同点，与本次 diff 无关，CI Linux 该用例历史全绿）
- [x] 1.5 `httpapi-sdk.test.ts` skill 用例隔离运行 10 次全绿（修复前基线 10/10 红）

## 2. 收尾

- [x] 2.1 收集实现提交写入本文件 `## Implementation Commits`
- [ ] 2.2 `openspec validate runner-boot-gate --strict` 通过
- [ ] 2.3 同步主 specs 后归档（`npx openspec archive --yes`），提交归档移动

## Implementation Commits

- `c8acabb7f7` fix(core): SessionRunner 读插件状态前等待引导门放行

### 验证记录

- `httpapi-sdk.test.ts` skill 用例隔离 10/10 绿（修复前同条件 10/10 红）。
- `packages/core` 全量：1324 pass / 7 skip / 1 fail，失败为本机既有 `LocationServiceMap > rejects an unavailable selected model`（main 基点全量对照同红同点，判定与本次 diff 无关）。
- `packages/core` `bun typecheck` 通过；oxlint 无新增告警（文件内 1 条 unbound-method 警告为既有代码）。
- opennovel `test/server/`：196 pass / 3 fail，失败为 CORS preflight 与 event stream 两个既有超时 flake（隔离复跑分别转绿，代码路径与 SessionRunner 不相交）。
