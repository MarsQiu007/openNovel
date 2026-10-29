# Proposal

## Why

V2 会话运行时解析 provider key 只认 Integration 凭据库（credential 表，按 integration_id=providerID 查找），而设置界面的 Connect/自定义 provider 流程只写旧版凭据存储（`PUT /auth/:providerID` → auth.json），两侧无桥接。结果：界面里已配好 key 的自定义 provider，V2 会话发起模型请求时不带 Authorization 头，智谱直接报「Header中未收到Authorization参数，无法进行身份验证。」2026-10-27 生产环境已复现并定位为该断裂，手工把 auth.json 的 key 同步进 credential 表后立即恢复，证明修复方向有效，但需要机制层收口而不是手工修库。

## What Changes

- V2 会话的 provider key 解析增加兜底：凭据库未命中时回退读取旧版凭据存储（auth.json）中同 provider 的 API key 条目，首次命中即把该 key 懒修复写入凭据库（进程内按 provider 串行，避免并发复制造成连接 ID 失效），存量安装无需迁移即可认证。
- 旧版 Auth 服务的 set/remove 增加双写：对 `{type:"api"}` 条目同步写入 Integration 凭据库中 integration_id 等于 providerID 的凭据；移除任意类型的既有条目时同步清空该 provider 在凭据库中的全部凭据（含 OAuth 行），使设置界面、CLI、插件 OAuth 回调等所有现有写入方自动收敛到「两库一致」，登出后不会从凭据库复活。
- 解析优先级明确为：凭据库 > 旧版凭据存储 > 环境变量方法（保持凭据库为单一事实源，旧版存储只作兼容兜底）。

## Capabilities

### New Capabilities

- `provider-credentials`: LLM provider API key 的跨存储一致性与运行时解析行为——界面保存/移除凭据时两侧存储同步，V2 会话运行时按「凭据库 > 旧版存储 > 环境变量」优先级解析 key，存量数据免迁移兼容。

### Modified Capabilities

（无——现有 specs 未覆盖 provider 凭据行为。）

## Impact

- **packages/core**：Integration 服务（`src/integration.ts`）的 connection 解析增加旧版凭据存储兜底；新增 `src/integration/legacy-auth.ts` 做受控读取与解析（仅取 `{type:"api"}` 条目合成 key 凭据，oauth/wellknown 与畸形条目返回空）；兜底命中后懒修复写入凭据库并发布连接更新事件。
- **packages/opennovel**：Auth 服务（`src/auth/index.ts`）set 对 API key 条目双写 `Credential.create`，remove 清空该 provider 在凭据库中的凭据；layer 依赖增加全局 Credential 节点。
- **packages/app**：无改动（设置弹窗仍走既有 `PUT /auth/:providerID` 契约）。
- **packages/schema / packages/protocol**：无契约变更，无需重新生成 SDK。
- **本地数据兼容**：不迁移、不删除 auth.json 存量数据；存量 key 由运行时兜底覆盖，双写从升级后首次保存/移除开始收敛。credential 表为全局库（opennovel.db），与项目库（novel.db）无关。
- **非目标**：
  - 不迁移、不废弃 auth.json（Provider 目录服务等仍在消费它）；
  - 不处理 `{type:"oauth"|"wellknown"}` 条目的双写（Integration 的 OAuth 注册流程已有独立写库路径）；
  - 不处理「保存非 API key 条目时清除库中既有 API key」的类型切换收敛（OAuth token 刷新会反复写 oauth 条目，此时清库会误删 Integration OAuth 凭据）；该场景留给后续独立 change；
  - 不做凭据加密存储；
  - 不含云同步空快照保护（属独立提案范围）；
  - 不改变 `OPENNOVEL_AUTH_CONTENT` 的覆盖语义；覆盖内容属于临时注入，但首次 V2 会话的懒修复会把它写入凭据库（design D2 风险项，已接受）。
