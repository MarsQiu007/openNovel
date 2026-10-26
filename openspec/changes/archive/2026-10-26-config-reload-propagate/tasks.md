# Tasks

## 1. LocationMiddleware 维护已知 location ref 注册表

- [x] 1.1 在 `packages/server/src/location.ts` 加模块级 `knownRefs: Set<Location.Ref>`，`LocationMiddleware` 在解析 ref 时按 directory+workspaceID 序列化 key 去重登记；导出 `invalidateAllKnownLocations(): Effect.Effect<Location.Ref[], never, LocationServiceMap.Service>` 逐个 `locations.invalidate`；验证 `bun typecheck`（在 `packages/opennovel` 与 `packages/server`）通过

## 2. 全局 lifecycle 扩为「instance + location 层」双失效

- [x] 2.1 在 `packages/opennovel/src/server/global-lifecycle.ts` 的 `disposeAllInstancesAndEmitGlobalDisposed` 中：`store.disposeAll()` 成功后调 `invalidateAllKnownLocations()`；单个 ref 失败仅 `Effect.logWarning`、继续其余；全部完成后仍 `yield* emitGlobalDisposed`；验证 `bun typecheck` 通过
- [x] 2.2 在 `packages/opennovel` 跑 `bunx oxlint` 确认 0 errors

## 3. 端到端行为验证

- [x] 3.1 本地起 server（`bun run --conditions=browser ./src/index.ts serve --port <port>`），先 `GET /api/agent?location[directory]=<dir>` 记录 `general.model` 旧值
- [x] 3.2 `PATCH /global/config` 把 `agent.general.model` 改为新值，响应 200
- [x] 3.3 立刻 `GET /api/agent?location[directory]=<dir>`，断言 `general.model` 已是新值（不再回退到旧值，无需重启 server）——已验证两轮 PATCH 循环均立刻生效

## Workflow follow-up

## Implementation Commits

- cbf5c184a3 fix(opennovel): 全局配置变更后失效 location 层缓存

- 运行 `npx openspec validate config-reload-propagate`。
- 用 `npx openspec archive config-reload-propagate --yes` 归档（避免手工归档残留）。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送（按用户长期指示 push 扣留）。
- 通知用户重启桌面 app 验收面板切换模型。
