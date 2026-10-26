# Proposal: config-reload-propagate

## Why

智能体面板上手动切换任何智能体的模型（写入 PATCH `/global/config`），全局配置文件已正确落盘（`agent.<name>.model` 已是新值），但 `GET /api/agent` 仍返回旧模型；重启 server 后才生效。根因：`LocationServiceMap` 用 `LayerMap.make(..., { idleTimeToLive: "60 minutes" })` 缓存 location 层（含 core Config 在层构建时一次性快照的 `configs` 数组），`configUpdate` 触发的 `disposeAll` 只清 instance scope 的实例缓存，**location 层完全没被动到**；`agent.list` 的 `agents.reload()` 重放 transform 时仍读到 60 分钟前的旧 `configs`，新配置必须等 `idleTimeToLive` 到期或 server 重启才可见。这导致「面板切模型闪一下又还原」——前端收到旧值渲染后立刻被旧快照覆盖。

## What Changes

- **全局配置变更后失效 location 层**（opennovel server）：`configUpdate` handler 在 `changed` 分支把 `disposeAllInstancesAndEmitGlobalDisposed` 扩为「同时失效所有活跃 location 的 LocationServiceMap 缓存条目」，让下一次 `LocationServiceMap.get(ref)` 触发按当前全局配置重建 location 层。失效按 ref 逐个调用 `locations.invalidate(ref)`，失败仅记日志、不阻断 PATCH 响应（与现有 `swallowErrors` 语义一致）。
- **失效范围限定**（opennovel server）：仅失效 location 层缓存，**不**触碰全局 `Config` service（它只持有全局配置指针）与 instance scope 既有生命周期（instance 仍由 `disposeAll` 走 `disposeEntry` → `disposeContext` 流程）。两条失效路径在 `bridge.fork` 内串行，互不依赖完成顺序。

## 非目标

- 不改 core `Config.entries()` 的快照语义——「location 打开时读一次」是 core 层的明确设计注释，本提案不动它，只补「让 location 层在全局配置变更后能正确关闭重建」这一缺失的失效接线。
- 不改 `idleTimeToLive` 时长——60 分钟仍是合理的空闲回收窗口。
- 不改 `agent.list` handler 的 wait+reload 逻辑——它已是正确形态，缺的是 location 层的失效。
- 不改 PATCH 响应形状、不改全局配置 schema、不改前端面板代码。
- 不引入「配置变更事件广播到所有连接中的 session」机制（超出本 bug 范围，属独立设计）。

## Capabilities

### New Capabilities

- `config-reload-propagate`: 全局配置变更后向 location 运行时的传播语义——`configUpdate` 不仅销毁 instance scope，还必须失效 location 层缓存，使下一次查询读到新配置；失效需吞错不阻断 PATCH 响应。

### Modified Capabilities

（无——既有 spec 无需求级行为变更）

## Impact

- **packages/opennovel**：`src/server/global-lifecycle.ts`（`disposeAllInstancesAndEmitGlobalDisposed` 扩为同时失效 location 层）、`src/server/routes/instance/httpapi/handlers/global.ts`（`configUpdate` 与 `dispose` 两个 handler 经由同一 lifecycle 函数拿新语义，签名不变）。
- **packages/core**：零改动——`LocationServiceMap.invalidate(key)` 已是 LayerMap 公共 API（`node_modules/effect/src/LayerMap.ts:89`）。
- **零协议变更**：不改 HttpApi 形状，无需 `bun run generate`。
- **风险**：location 层重建代价 = 全局配置重读 + config-agent transform 重放 + 内置 plugin transform 重放。`agent.list` 每次已 `reload()`，重建后首查的额外成本即 layer 构建本身，量级可忽略。活跃 session 不会被失效打断——`LocationServiceMap` 失效仅影响后续 `get(ref)` 调用，已在跑的 `Effect` 持有的是原 layer 的 service 实例，引用计数自然回收。
