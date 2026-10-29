# Tasks

TDD 顺序：每节先写失败测试并确认失败原因正确，再写最小实现转绿。不得读取真实用户数据目录的 `auth.json`，测试只通过 `OPENNOVEL_AUTH_CONTENT` 临时文件注入。

## 1. core：测试隔离与旧版凭据读取模块

- [x] 1.1 在 `packages/core/test/preload.ts` 设置 `OPENNOVEL_AUTH_CONTENT="{}"`，使 core 测试默认不读取真实数据目录的 `auth.json`；用例需要时自行覆盖并恢复。验证：`cd packages/core && bun test test/integration.test.ts` 仍全绿
- [x] 1.2 先写 `packages/core/test/integration/legacy-auth.test.ts`（RED，逐个确认失败原因是模块不存在/行为缺失）——`LayerNode.compile(FSUtil.node)` + `testEffect`，覆盖：
  - `parse`：`{type:"api",key}` 命中并合成 `Credential.Key`；`metadata` 保留且非 api 的 `metadata` 形态不影响命中；oauth/wellknown/缺 key/`metadata` 畸形/顶层非对象/缺 provider 键均返回 undefined
  - `parseFile`：临时文件命中；文件不存在返回 undefined；损坏 JSON 返回 undefined
  - `read`：`OPENNOVEL_AUTH_CONTENT` 命中时优先于传入文件；env 非法 JSON 时回落文件；env 为合法 JSON 但条目类型非 api 时返回 undefined（不回落）
  - 验证：`cd packages/core && bun test test/integration/legacy-auth.test.ts` 先红后绿
- [x] 1.3 实现 `packages/core/src/integration/legacy-auth.ts`（`parse` / `parseFile` / `read`，`read` 接受默认文件路径参数），验证：1.2 用例全部转绿，且 `cd packages/core && bun typecheck` 通过

## 2. core：`connection.active` 兜底与懒修复

- [x] 2.1 先在 `packages/core/test/integration.test.ts` 增加用例（RED，确认失败原因是 `active` 不读旧版存储）：
  - (a) 凭据库空 + legacy api key → `active` 返回 credential 连接，`resolve` 得到该 key，`credentials.list(integrationID)` 恰有一行且 `label` 为 `"default"`，同时 `Event.ConnectionUpdated` 收到该 integration 的事件（按既有测试的 `subscribe` + `yieldNow` 模式）
  - (b) 凭据库已有凭据 + legacy 有不同 key → 返回库中最新 key，凭据数不变且未重写
  - (c) 凭据库空 + legacy 仅 oauth 条目 → `active` 为空
  - (d) 凭据库空 + legacy 无条目 + 注册 env 方法且环境变量存在 → 仍返回 env 连接
  - (e) 凭据库空 + legacy api key 与 env 方法同时存在 → 返回 credential 连接（旧版存储优先于环境变量）
  - (f) 并发冷启动：凭据库空 + legacy api key，两个 `fork` 并发调用 `active` → 两者 `resolve` 均得到 key，且凭据库只有一行
  - 验证：`cd packages/core && bun test test/integration.test.ts` 先红后绿
- [x] 2.2 实现 `connection.active`：库空时进入 `KeyedMutex.makeUnsafe<ID>()` 的 per-integration 锁，锁内重新 `list` 复核并读取 legacy，命中则 `credentials.create({integrationID, label:"default", value})` 后发布 `Event.ConnectionUpdated` 与 `Event.Updated`，返回新建连接；legacy 未命中再回落 env；`Integration.node` 依赖增加 `FSUtil.node`。验证：2.1 用例全部转绿且 `cd packages/core && bun typecheck` 通过
- [x] 2.3 模型可用性判定接入旧版存储（不写库）：先补用例（RED）——`LegacyAuth.parseAll`/`readAll` 的过滤与 env 优先级；`Integration.connection.legacy()` 返回带 API key 的 integration 集合（oauth 条目不计）；`Catalog.provider.available` 把仅旧版有 API key 的 provider 视为可用、旧版只有 oauth 条目的不算。再实现 `parseAll`/`readAll`、`connection.legacy` 与 `provider.available` 的 `legacy` 判定。验证：`cd packages/core && bun test test/integration/legacy-auth.test.ts test/integration.test.ts test/catalog.test.ts` 转绿且 `bun typecheck` 通过

## 3. opennovel：Auth 服务双写

- [x] 3.1 先在 `packages/opennovel/test/auth/auth.test.ts` 增加用例（RED，确认失败原因是 `set`/`remove` 未同步凭据库）。成功路径用 `testEffect(LayerNode.compile(LayerNode.group([Auth.node, Credential.node])))` 以同时访问两个服务（Credential 的全局库位于测试临时数据目录，不触真实 opennovel.db）：
  - (a) set api 条目后库中存在该 provider 一行，value 为 `Key{key, metadata}`
  - (b) 两次 set 不同 api key → 库中仍一行且值为新 key
  - (c) 先 set api 再 set 该 provider 的 oauth 条目 → 库中原 api 行保留（非 api 不写也不删）
  - (d) remove api 条目 → auth.json 与库两侧均无该 provider
  - (e) 预置 api 凭据后 remove 该 provider 的 oauth 条目 → 库被清空（登出语义）
  - (f) remove 不存在的 provider → 库内容不变
  - 失败映射（另建 `testEffect(LayerNode.compile(Auth.node, [[Credential.node, Layer.mock(Credential.Service)({ create: () => Effect.die(...) })]]))`）：set api 返回 `AuthError` 而非缺陷；`remove` 同样在 mock `list`/`remove` 缺陷时返回 `AuthError`（用 `Effect.exit` 断言 Failure 且 error 为 `AuthError`）
  - 验证：`cd packages/opennovel && bun test test/auth/auth.test.ts` 先红后绿
- [x] 3.2 实现 `set`/`remove` 双写：set 仅在 `type === "api"` 时规范化 key 后写库；remove 在确实移除了任意类型条目时清空该 provider 的全部凭据、未知 provider 不动库；credential 操作以 `Effect.catchCause` 映射为 `AuthError`；`Auth.node` 依赖增加 `Credential.node`。验证：3.1 用例全部转绿且 `cd packages/opennovel && bun typecheck` 通过

## 4. 质量门与集成验证

- [x] 4.1 `cd packages/core && bun typecheck`、`cd packages/opennovel && bun typecheck` 通过；根目录 `bun run lint` 对改动文件无新增告警
- [x] 4.2 运行时验收（隔离数据目录与临时库，仅使用自造 key，不读取真实 `auth.json`）：
  - (a) 存量兜底：隔离 CLI（`run --dir <temp workspace> --model requesty/xai/grok-4`，`OPENNOVEL_MODELS_PATH` 指向把 `requesty.api` 改到本地 mock 的 fixture，无 `REQUESTY_API_KEY`）→ mock 收到 `authorization: "Bearer verify-legacy-key"`，临时库出现 `integration_id=requesty / label=default` 行，进程退出码 0 且无 drain 失败；修复可用性判定前同一命令会静默回退到其他 provider（远端 401），证明桥接必要
  - (b) 双写：隔离 server + `PUT /auth/verify-provider`（api key-one）→ 凭据库一行；再 PUT key-two → 仍一行且值为 key-two；`auth.json` 同步为最新条目
  - (c) 移除：`DELETE /auth/verify-provider` → 凭据库该 provider 零行，`auth.json` 中该 provider 键消失（写入方为最新 oauth 条目时同样清空，登出语义）
  - (d) 非 API 类型：在已有 API key 行后 PUT 该 provider 的 oauth 条目 → 库中 API key 行保持不变

## Implementation Commits

- `304546ca7a` fix(credentials): 打通旧版凭据存储与凭据库双轨——Auth 双写、core 旧版读取与懒修复及单测
- `e78367e4e9` fix(core): 让仅旧版存储有凭据的 provider 保持可用——可用性判定接入 auth.json 及单测

## Workflow follow-up

（归档阶段参考，不计入任务进度）

- 实现提交 footer 带 `OpenSpec-Change: fix-credential-dual-track`，一个 commit 只写一个 change-id
- 用 `git log --grep "OpenSpec-Change: fix-credential-dual-track" --format="%h %s"` 收集实现提交写入本文件 `Implementation Commits`（不含记录更新自身与归档移动）
- 归档顺序：`openspec validate fix-credential-dual-track --strict` → 同步主 specs → `npx openspec archive fix-credential-dual-track --yes` → 合并推送 main → 清理分支
- 完成判定以 GitHub Actions 全绿为准；纯文档提交无 run 属预期
