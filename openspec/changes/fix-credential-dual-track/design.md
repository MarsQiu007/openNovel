# Design

## Context

见 proposal.md 的动机说明。当前状态（已核实）：

- **写入侧**：所有凭据写入都收口在 opennovel 的 Auth 服务（`packages/opennovel/src/auth/index.ts`），包括 HttpApi `PUT /auth/:providerID`（`handlers/control.ts`）、CLI（`cli/cmd/providers.ts`）、插件 OAuth 回调（`provider/auth.ts`）。Auth 服务是全局服务，读写 `Global.Path.data/auth.json`（0600 权限），`OPENNOVEL_AUTH_CONTENT` 环境变量激活时 `all()` 优先返回环境变量内容。
- **读取侧**：V2 会话模型解析（`packages/core/src/session/runner/model.ts` 的 `locationLayer.resolve`）经 `Integration.connection.active(providerIntegrationID)` → `connection.resolve(connection)` 得到 `Credential.Value`；`Integration.locationLayer`（`packages/core/src/integration.ts`）只查全局 `Credential` 服务（`packages/core/src/credential.ts`， backed by 全局 opennovel.db，`create` 为「按 integration_id 事务内 DELETE+INSERT」的原子替换语义，`list(integrationID)`/`remove(id)` 齐备）。
- `Credential.Key` 带可选 `metadata`（`model.ts` 的 `fromCatalogModel` 会把它合并进请求体），与 auth.json `Api` 条目的 `metadata` 字段语义对齐。
- core 无法依赖 opennovel（依赖方向 Schema ← Core ← Server），所以 core 的兜底只能直接读 auth.json 文件；所幸 `Global.Path.data` 是 core 自己的常量，不构成依赖违规。

## Goals / Non-Goals

**Goals:**

- 新写入双侧一致：任何路径写入/移除 API key 凭据，auth.json 与 credential 表同步变化。
- 存量免迁移可用：仅在 auth.json 有 key 的安装，升级后首次 V2 会话即认证成功。
- 收敛到单一事实源：credential 表为权威源，auth.json 逐步退化为兼容层。

**Non-Goals:**

- 不改任何 HttpApi/Protocol 契约（`PUT /auth/:providerID` 行为不变，仅服务端副作用增加）。
- 不迁移、不删除、不废弃 auth.json（Provider 目录服务 `provider/provider.ts` 等仍消费它）。
- 不处理 oauth/wellknown 类型条目的双写与回退（Integration 的 OAuth 注册流程有独立写库路径）。
- 不做凭据加密。

## Decisions

### D1：双写收口在 Auth 服务层，而非逐个调用方

在 `packages/opennovel/src/auth/index.ts` 的 `set`/`remove` 中增加对全局 `Credential` 服务的同步写：

- `set(key, info)`：`info.type === "api"` 时，规范化 key（去尾部斜杠，与现有 `norm` 一致）后调用 `Credential.create({ integrationID: Integration.ID.make(norm), value: Key { type: "key", key: info.key, metadata: info.metadata } })`。`create` 的原子替换语义天然满足「重复保存新 key 后旧 key 不再被使用」。`oauth`/`wellknown` 条目跳过。
- `remove(key)`：对 `norm` 调用 `Credential.list(norm)` 并逐条 `remove(id)`。不新增 `Credential.Interface` 方法。
- Auth 服务的 LayerNode 依赖增加 `Credential.node`（全局节点）；Auth 是全局服务，Credential 也是全局服务，无 Location 上下文错配。
- **失败语义**：credential 写失败时整个 `set` 以 `AuthError` 失败（映射「Failed to sync credential store」），不回滚 auth.json 已写内容但向调用方报错。静默成功会重演本次「双轨分裂」事故，宁可让 UI 显示保存失败可重试。
- 备选方案：只改 `handlers/control.ts` 的 HttpApi 处理器。被否——CLI 与插件 OAuth 回调（`provider/auth.ts`）会漏，分裂依旧。

### D2：运行时兜底 + 懒修复放在 core `Integration.connection.active`，而非 model.ts

在 `packages/core/src/integration.ts` 的 `locationLayer` 内实现：

- 新增文件内 helper `legacyKey(providerID)`：读取 legacy 凭据（`OPENNOVEL_AUTH_CONTENT` 环境变量优先，与 `Auth.all` 语义一致；否则读 `Global.Path.data/auth.json`，经 `Schema.decodeUnknownOption` 解析），仅提取 `{ type: "api" }` 条目的 key 与 metadata 合成 `Credential.Key`；oauth/wellknown 条目返回空。文件缺失或解析失败视为无条目（该兜底是兼容层，不应让会话因文件损坏而以另一种方式失败——与现状「无凭据不带 Authorization」表现一致）。
- `connection.active(id)` 调整：现有 `resolveConnections(entry, saved)` 结果中 credential 类连接优先；当凭据库中该 integration 无任何凭据（`saved` 为空）且存在 legacy key 时，先 `credentials.create({ integrationID: id, label: "default", value: key })`（幂等替换），再返回新写入的 credential 连接；legacy 未命中则维持现有 env 方法兜底不变。解析优先级落地为：凭据库 > legacy 存储 > env 方法。
- **懒修复（read-path repair）**：首次会话触发把 legacy key 落进凭据库，之后 `saved` 非空直接走库，不再读文件；这比「纯内存兜底」让两库自动收敛，避免永久分裂，也覆盖未来的其他 `connection.active` 调用方。
- 备选方案：在 `model.ts` 的 `locationLayer.resolve` 里做纯兜底（不写库）。被否——两库永久分裂、legacy 读取逻辑与会话运行耦合、其他调用方不受益。

### D3：无契约变更，SDK 不再生成

`PUT /auth/:providerID`、`Integration` HttpApi、Connection 联合类型全部不变；`packages/client` 无需 `bun run generate`，`packages/app` 无改动（设置弹窗仍走原契约）。

## Risks / Trade-offs

- [读路径引入写副作用，`connection.active` 语义从「读」变为「必要时修复」] → 仅在凭据库为空时触发一次；`create` 按 integration 原子替换，并发修复同值无害；修复失败（DB 错误）orDie 快速失败，会话明确报错而非静默无凭据。
- [`OPENNOVEL_AUTH_CONTENT` 环境变量激活时，注入的 key 会被懒修复持久化进凭据库] → 与 `Auth.set` 既有行为对齐（环境变量内容本就随 set 合并写入 auth.json 文件）；属 dev/test 注入通道，可接受。
- [升级期间双写产生的 credential 行，在回滚到旧版本后不被读取] → 旧版本 V2 不查凭据库，表现为该 key 不可用但 auth.json 侧一致（双写同时写了文件）；回滚场景可接受。
- [`Auth.set` 新增失败面（credential 库不可用）] → 有意为之：保存失败对用户可见可重试，优于静默写裂。

## Migration Plan

无离线迁移步骤：升级后首次保存触发双写（D1），首次会话触发懒修复（D2），存量 auth.json 数据逐步收敛。回滚直接 revert 提交即可，两库中多出的数据对旧版本无害（文件侧旧版本正常消费，库侧旧版本忽略）。

## Open Questions

无。OAuth/wellknown 条目的双写已明确排除；若未来需要，应作为独立 change 处理（需 Integration OAuth 方法注册的联动设计）。
