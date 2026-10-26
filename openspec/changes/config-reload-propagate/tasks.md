# Tasks

## 1. InstanceStore 补活跃 directory 枚举

- [ ] 1.1 在 `packages/opennovel/src/project/instance-store.ts` 的 `Interface` 与实现中新增 `directories(): Effect.Effect<string[]>`，返回 `[...cache.keys()]` 快照；验证 `bun typecheck`（在 `packages/opennovel`）通过

## 2. 全局 lifecycle 扩为「instance + location 层」双失效

- [ ] 2.1 在 `packages/opennovel/src/server/global-lifecycle.ts` 的 `disposeAllInstancesAndEmitGlobalDisposed` 中：`store.disposeAll()` 成功后，先 `yield* LocationServiceMap.Service` 拿到 `locations`，再 `store.directories()` 枚举活跃 directory，逐个 `locations.invalidate(Location.Ref.make({ directory: AbsolutePath.make(dir) }))`；单个 ref 失败仅 `Effect.logWarning`、继续其余；全部完成后仍 `yield* emitGlobalDisposed`；验证 `bun typecheck` 通过
- [ ] 2.2 在 `packages/opennovel` 跑 `bun run oxlint`（或仓库根等价命令）确认 0 errors

## 3. 端到端行为验证

- [ ] 3.1 本地起 server（`bun run --conditions=browser ./src/index.ts serve --port <port>`），先 `GET /api/agent?location[directory]=<dir>` 记录 `general.model` 旧值
- [ ] 3.2 `PATCH /global/config` 把 `agent.general.model` 改为新值，响应 200
- [ ] 3.3 立刻 `GET /api/agent?location[directory]=<dir>`，断言 `general.model` 已是新值（不再回退到旧值，无需重启 server）
- [ ] 3.4 在 `packages/opennovel` 跑 `bun test` 确认无回归（注意避开 `packages/opennovel/.opennovel` 配置污染——本测试用真实全局配置，需先把 `~/.config/opennovel/opennovel.jsonc` 中 `agent.general.model` 还原为用户原本的值）

## Workflow follow-up

## Implementation Commits

- 2680a0746a fix(opennovel): 全局配置变更后失效 location 层缓存

- 运行 `npx openspec validate config-reload-propagate`。
- 用 `npx openspec archive config-reload-propagate --yes` 归档（避免手工归档残留）。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送（按用户长期指示 push 扣留）。
- 通知用户重启桌面 app 验收面板切换模型。
