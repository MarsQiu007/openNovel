# Design

## Context

见 proposal.md 的动机说明。当前状态（已核实）：

- **写入侧**：所有凭据写入都收口在 opennovel 的 Auth 服务（`packages/opennovel/src/auth/index.ts`），包括 HttpApi `PUT /auth/:providerID`（`handlers/control.ts`）、CLI（`cli/cmd/providers.ts`）、插件 OAuth 回调（`provider/auth.ts`）。Auth 服务是全局服务，读写 `Global.Path.data/auth.json`（0600 权限）；`OPENNOVEL_AUTH_CONTENT` 环境变量激活时 `all()` 优先返回环境变量内容（解析失败回落文件）。
- **读取侧**：V2 会话模型解析（`packages/core/src/session/runner/model.ts` 的 `locationLayer.resolve`）以 `provider.integrationID ?? Integration.ID.make(selected.providerID)` 调用 `Integration.connection.active(id)` → `connection.resolve(connection)` 得到 `Credential.Value`；`Integration.locationLayer`（`packages/core/src/integration.ts`）只查全局 `Credential` 服务（`packages/core/src/credential.ts`，backed by 全局 opennovel.db，`create` 为「按 integration_id 事务内 DELETE+INSERT」的原子替换语义，`list(integrationID)`/`remove(id)` 齐备）。
- 自定义 provider 的 `integrationID` 走 fallback 等于 `providerID`，与 auth.json 的键一致；OpenNovel 云目录 provider 的 `integrationID` 统一为 `"opennovel"`，对应 auth.json 的 `"opennovel"` 条目。
- `Credential.Key` 带可选 `metadata`（`model.ts` 的 `fromCatalogModel` 会把它合并进请求体），与 auth.json `Api` 条目的 `metadata` 字段语义对齐。
- `Credential.list` 按 `time_created` 升序返回；`resolveConnections` 会把凭据列表反转，`[0]` 即最新凭据。
- core 无法依赖 opennovel（依赖方向 Schema ← Core ← Server），所以 core 的兜底只能直接读 auth.json 文件；`Global.Path.data` 是 core 自己的常量，文件读取复用 core 的 `FSUtil` 全局节点（`readJson` + 缺失/解析失败兜底），不构成依赖违规。

## Goals / Non-Goals

**Goals:**

- 新写入双侧一致：任何路径写入/移除 API key 凭据，auth.json 与 credential 表同步变化。
- 存量免迁移可用：仅在 auth.json 有 key 的安装，升级后首次 V2 会话即认证成功。
- 收敛到单一事实源：credential 表为权威源，auth.json 逐步退化为兼容层。

**Non-Goals:**

- 不改任何 HttpApi/Protocol 契约（`PUT /auth/:providerID` 行为不变，仅服务端副作用增加）。
- 不迁移、不删除、不废弃 auth.json（Provider 目录服务 `provider/provider.ts` 等仍消费它）。
- 不处理「保存 oauth/wellknown 条目时清除库中既有 API key」的类型切换收敛：OAuth token 刷新会重复写 oauth 条目，此时清库会误删 Integration OAuth 凭据；该场景另立 change。
- 不做凭据加密。

## Decisions

### D1：双写收口在 Auth 服务层，而非逐个调用方

在 `packages/opennovel/src/auth/index.ts` 的 `set`/`remove` 中增加对全局 `Credential` 服务的同步操作：

- `set(key, info)`：`info.type === "api"` 时，规范化 key（去尾部斜杠，与现有 `norm` 一致），先按既有契约写 auth.json，再调用 `Credential.create({ integrationID: Integration.ID.make(norm), value: Key { type: "key", key: info.key, metadata: info.metadata } })`。`create` 的原子替换语义天然满足「重复保存新 key 后旧 key 不再被使用」。`oauth`/`wellknown` 条目跳过写库。
- `remove(key)`：规范化后先取出将被移除的条目（`data[norm] ?? data[key]`），按既有契约写 auth.json；随后若确实移除了条目（api/oauth/wellknown 任一类型），对该 integration 执行 `Credential.list(norm)` 并逐条 `remove(id)`。删除 OAuth 行是有意的登出语义：否则「凭据库 > 旧版存储」的优先级会让旧 API key 在登出后继续生效，违反「移除后不得复活」。legacy 中不存在该条目（对未知 key 调用）时为 no-op，不触碰凭据库。不新增 `Credential.Interface` 方法。
- **失败语义**：credential 写/删以 `Effect.catchCause` 把 typed failure 与 defect 统一映射为 `AuthError`（「Failed to sync credential store」），使整个 `set`/`remove` 失败；不回滚 auth.json 已写内容但向调用方报错。理由：凭据库写入是 `Effect.orDie`，`catchAll` 捕获不到 defect，必须按 cause 捕获。文件已更新而库未同步的中间态会被 D2 的运行时兜底在下一次会话自愈，用户重试也能收敛；静默成功则会重演本次「双轨分裂」事故。
- Auth 服务的 LayerNode 依赖增加 `Credential.node`（全局节点）；Auth 是全局服务，Credential 也是全局服务，无 Location 上下文错配。
- **`OPENNOVEL_AUTH_CONTENT` 不做特殊跳过**：覆盖激活时 `all()` 返回覆盖内容，set/remove 使用它做决定并写文件（既有行为）；写库同步照常执行。覆盖内容因此可能被持久化（见 Risks），与 D2 的懒修复语义一致。
- 备选方案：只改 `handlers/control.ts` 的 HttpApi 处理器。被否——CLI 与插件 OAuth 回调（`provider/auth.ts`）会漏，分裂依旧。

### D2：运行时兜底 + 懒修复放在 core `Integration.connection.active`，而非 model.ts

新增 `packages/core/src/integration/legacy-auth.ts`（`export * as LegacyAuth`），把解析与文件读取拆开以便直接单测：

- `LegacyAuth.parse(data, providerID)`：纯函数。`data` 非对象记录时返回 undefined；取 `data[providerID]`，用 `Schema.decodeUnknownOption` 解码 `{ type: "api", key: string, metadata?: Record<string,string> }`；oauth/wellknown/缺 key/畸形 metadata 返回 undefined；命中时构造 `Credential.Key`（metadata 仅在有值时带上）。
- `LegacyAuth.parseFile(path, providerID)`：Effect + `FSUtil.Service`，`readJson` 后走 `parse`，文件缺失或解析失败返回 undefined。路径作为参数传入，测试可直接指向临时文件，避免读取真实数据目录。
- `LegacyAuth.read(providerID, file = path.join(Global.Path.data, "auth.json"))`：Effect + `FSUtil.Service`。`OPENNOVEL_AUTH_CONTENT` 存在时先 `JSON.parse` 再 `parse`（解析失败按 Auth.all 语义回落文件）；否则 `parseFile(file, providerID)`。该兜底是兼容层，不应让会话因文件损坏而失败。
- `connection.active(id)` 调整：
  1. 先 `credentials.list(id)`；非空直接沿用既有逻辑返回 `resolveConnections(entry, saved)[0]`（最新凭据优先）。
  2. 库空时进入进程内 per-integration 锁（`KeyedMutex.makeUnsafe<ID>()`），锁内重新 `list` 复核，然后 `LegacyAuth.read(id)`；命中则 `credentials.create({ integrationID: id, label: "default", value: key })`，发布 `Event.ConnectionUpdated` 与 `Event.Updated`（与 `connection.key` 保持一致的 UI 刷新语义），返回新建的 credential 连接。
  3. legacy 未命中（或非 api 条目）时维持现有 env 方法兜底（`resolveConnections` 的 env 连接）。
- **为什么需要锁**：`Credential.create` 是 DELETE+INSERT 新 ID；若两个并发冷启动都判定库空并各自 create，后一次会删除前一次刚创建的连接 ID，先返回的 `connection` 在随后的 `resolve` 中按 ID 查不到凭据，请求会静默不带 Authorization。锁内复核后并发调用共享第一次修复结果，消除该进程内竞态。跨进程（workspace 子进程共享全局库）仍有极窄的同值替换竞态，接受为兼容层残余风险：下一轮解析会重新命中库并恢复。
- 备选方案：在 `model.ts` 的 `locationLayer.resolve` 里做纯兜底（不写库）。被否——两库永久分裂、legacy 读取逻辑与会话运行耦合、其他调用方不受益；且连接类型没有「内存凭据」变体，无法不落库就返回凭据。

### D3：无契约变更，SDK 不再生成

`PUT /auth/:providerID`、`Integration` HttpApi、Connection 联合类型全部不变；`packages/client` 无需 `bun run generate`，`packages/app` 无改动（设置弹窗仍走原契约）。

## Risks / Trade-offs

- [读路径引入写副作用，`connection.active` 语义从「读」变为「必要时修复」] → 仅在凭据库为空时触发一次，并受 per-integration 锁保护；`create` 按 integration 原子替换，并发修复同值无害。跨进程竞态留有余量，下一轮解析自愈。
- [`OPENNOVEL_AUTH_CONTENT` 注入的 key 会被懒修复持久化进凭据库，且覆盖期间的 set 也会双写] → 覆盖通道主要用于 workspace 子进程与 dev/test；持久化让本地与子进程收敛到同一事实源，属可接受权衡。
- [`remove` 会删除该 provider 在凭据库中的 OAuth 行] → 这是「登出」的预期语义；若用户只想移除 auth.json 条目而不影响 Integration OAuth 凭据，当前没有这种入口，后续需要时再拆独立操作。
- [保存 oauth/wellknown 条目时库中旧 API key 仍保留（类型切换不收敛）] → 已在 Non-Goals 明确；`remove` 仍能清干净，OAuth token 刷新不会被误清库。
- [`Auth.set` 新增失败面（credential 库不可用）] → 有意为之：保存失败对用户可见可重试，优于静默写裂；文件已写而库未写时由 D2 兜底自愈。
- [auth.json 非原子写与 core 并发读取] → 读取可能短暂解析失败并回落 env/无凭据，下一次解析恢复，不抛出。

## Migration Plan

无离线迁移步骤：升级后首次保存触发双写（D1），首次会话触发懒修复（D2），存量 auth.json 数据逐步收敛。双写失败留下的「文件已更新、库未更新」中间态由 D2 兜底在下次会话修复。回滚直接 revert 提交即可，两库中多出的数据对旧版本无害（文件侧旧版本正常消费，库侧旧版本忽略）。

## Open Questions

无。OAuth/wellknown 条目的双写与类型切换收敛已明确排除；若未来需要，应作为独立 change 处理（需 Integration OAuth 方法注册的联动设计）。
