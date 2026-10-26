# Design

## Context

参见 proposal.md 的根因分析。补实现所需的现状：

- `LocationServiceMap` 是 `LayerMap<Location.Ref, LocationServices, LocationError>`，`idleTimeToLive: "60 minutes"`（`packages/core/src/location-services.ts:131`）；公共 API 已暴露 `invalidate(key)`（effect LayerMap 源：`node_modules/effect/src/LayerMap.ts:89`）。
- core Config 在 layer 构建时一次性快照 `configs` 数组（`packages/core/src/config.ts:173-203` 注释：「Read configuration once when this location opens. Later calls reuse these values until the location is reopened.」），是设计意图、不动。
- 现有失效接线只在 pty handler：`registerDisposer((directory) => locations.invalidate(...))`（`packages/opennovel/src/server/routes/instance/httpapi/handlers/pty.ts:47-50`），且仅作用于 instance scope 的 dispose 回调注册，不会响应全局配置变更。
- 全局配置变更的唯一入口是 PATCH `/global/config`（`packages/opennovel/src/server/routes/instance/httpapi/handlers/global.ts:86-90`），`changed: true` 时 fork `disposeAllInstancesAndEmitGlobalDisposed`。

## Goals / Non-Goals

**Goals:**

- PATCH `/global/config` 在 `changed: true` 后，下一次 `GET /api/agent`（或任何经 `LocationServiceMap.get(ref)` 的查询）读到新配置。
- 失效失败仅记日志，PATCH 仍返回 200。
- 在跑的 Effect 不被打断。

**Non-Goals:**

- 不改 core Config 的快照语义。
- 不引入跨 session 的事件广播。
- 不缩短 `idleTimeToLive`。

## Decisions

### D1：在 `disposeAllInstancesAndEmitGlobalDisposed` 内联 location 层失效，而非新增独立函数

**选择**：把 location 层失效直接加进现有 `disposeAllInstancesAndEmitGlobalDisposed` 的 `Effect.gen` 内，紧跟 `store.disposeAll()` 之后。

**理由**：该函数已是「全局配置变更后清理运行时」的单一入口，被 `configUpdate` 与 `dispose` 两个 handler 共用；在此扩展，两个 handler 同时获得新语义，无需重复接线。函数名「dispose all instances」在当前仓库语境已隐含「清理 instance 持有的运行时」，扩为「连带失效 location 层」是同一抽象层级的延伸。

**备选**：在 `configUpdate` handler 单独调 `locations.invalidate(...)`，不动 lifecycle 函数——被否，因为这会让 `dispose` handler 与 `configUpdate` handler 行为分叉（前者仍漏失效），后续维护者需记两份清理清单。

### D2：枚举活跃 location ref 走 `InstanceStore`，需补一个枚举方法

**选择**：在 `InstanceStore.Interface` 增加 `directories(): Effect.Effect<string[]>` 方法，实现为 `Effect.sync(() => [...cache.keys()])`；`disposeAllInstancesAndEmitGlobalDisposed` 先 `store.disposeAll()` 拿 `store.directories()`，逐个 `locations.invalidate(Location.Ref.make({ directory: AbsolutePath.make(dir) }))`。

**理由**：`LocationServiceMap` 是 effect LayerMap，未暴露 `entries` / `keys` 等枚举 API（只暴露 `get` / `invalidate`）；活跃 directory 集合 `InstanceStore` 的 `cache` Map 已经持有（key 即 directory），加一个只读快照方法成本一行。

**注意**：若存在「location 层已构建但 instance 未启动」的窗口（理论上 `LocationServiceMap.get` 先于 `InstanceStore.get` 被调），该 location 的层会漏失效。但触发本函数的入口是「全局配置变更」，下一查必然先经 `InstanceStore` 启动 instance 才会用到 location 层，失效时机仍先于使用时机，故无实际漏洞。

**备选**：为 core `LocationServiceMap` 包一层「全局失效」helper（遍历 `LayerMap.invalidate`）——被否，effect LayerMap 不暴露枚举能力，封装也是空壳。

### D3：失效逐个执行、单个失败不阻断后续

**选择**：用 `Effect.forEach(..., { discard: true, mode: "either" })` 或等价语义，让每个 ref 的 `invalidate` 独立成败；任一失败仅 `Effect.logWarning`，不冒泡。

**理由**：满足 spec「失效失败 SHALL 不阻断 PATCH 响应」。`store.disposeAll()` 的现有错误处理已用 `Effect.exit` + 分支，location 失效沿用同模式（`Effect.exit` per-ref 或 `Effect.either` per-ref）保持一致风格。

**备选**：`Effect.collectAll` / 整体 fail-fast——被否，spec 明确要求单个失败不阻断其余。

### D4：`LocationServiceMap.Service` 的获取方式

**选择**：在 `disposeAllInstancesAndEmitGlobalDisposed` 的 `Effect.gen` 顶部 `yield* LocationServiceMap.Service`，与 `InstanceStore.Service` 同级。

**理由**：两个 handler 的 layer 都已通过 `buildLocationServiceMap()` 绑定了 `LocationServiceMap.node`（`packages/opennovel/src/server/routes/instance/httpapi/server.ts:232-290`），在 lifecycle 函数内 yield 该 service 必然可用；不需要 handler 显式传递。

## Risks / Trade-offs

- **风险**：location 层重建成本 = 重读全局配置 + 重放 config-agent / config-plugin / 内置 agent plugin 等 transform + 重建各 service。首查延迟略高于纯 `reload()`。→ 缓解：location 层构建本身即 `LocationServiceMap.get` 冷启动路径（60 分钟空闲后必然发生），成本已摊销；面板切模型属于低频操作（用户手动触发），多几十毫秒无感。
- **风险**：`store.disposeAll()` 与 `locations.invalidate(...)` 在 `bridge.fork` 内串行，若 `disposeAll` 抛错且 `swallowErrors: false`，location 失效被跳过。→ 缓解：该路径仅 `dispose` handler 用（同步等结果），`configUpdate` 走 `swallowErrors: true` 且 `Effect.exit` 已经把 `disposeAll` 错误吞成日志，失效阶段总能到达。
- **风险**：失效后立刻 `GET /api/agent`，layer 重建期间插件 boot（`config-plugin` 的第三方 npm 装载 fork）尚未就绪，可能短暂返回缺员花名册。→ 缓解：现有 `agent.list` 已 `plugins.wait(config-agent) + plugins.wait(config-plugin)` 各 10s 超时兜底，重建后首查的等待行为与冷启动一致，已被既有逻辑覆盖。

## Migration Plan

无数据迁移。代码上线后，PATCH `/global/config` 的失效行为从前「只清 instance」变为「清 instance + 清 location 层」，旧行为可视为本 bug 的副产品，无需保留。

## Open Questions

无。
