# Tasks: agent-mcp-client

> 混合路线（design.md 裁定 C）：既有 SDK 1.31 连接语义提升到 core Location 位 + 上游架构语义（scoped 注册桥 / KeyedMutex 生命周期锁 / 连接即列工具 / 防陈旧回调）+ opennovel V1 遗物退役。无上游代码逐行移植（无 Ported-from）。
>
> 实现期修订（2026-10-24）：OAuth 凭据存储由初判的 Credential/Integration 改为 McpAuth core 化（否决理由见 design 否决项 6），Wave 3 随之并入 Wave 1 落地；上游 `recovering`/`endpointLoads` 两个增强降级为非目标（design 否决项 7）。

## Wave 1 — core 连接管理与 OAuth（`packages/core/src/mcp/`）

- [x] 1.1 `packages/schema/src/mcp.ts` 新建：Status 五态 + ServerInfo/AuthStatus 共享类型（沿既有 `opennovel/src/mcp/index.ts:84-99`）
- [x] 1.2 `core/src/mcp/catalog.ts`：分页/容错目录语义移植（paginate 游标去重与页数上限、outputSchema 容错 listTools、toolName/sanitize 命名）；删 convertTool 死代码
- [x] 1.3 `core/src/mcp/index.ts`：`Mcp.Service` Location node（deps: Location/Config/EventV2/McpAuth/McpBrowser/CrossSpawnSpawner）；连接生命周期沿既有语义（stdio/StreamableHTTP/SSE 三传输、五态状态机、工具变更通知、OAuth 方法面 startAuth/authenticate/finishAuth/removeAuth/supportsOAuth/hasStoredTokens/getAuthStatus）+ 上游架构语义（连接即列工具、onclose 身份检查防陈旧、KeyedMutex 每服务器锁）；配置消费 V2 `ConfigMCP` 段；`McpEvent.ToolsChanged` 经 EventV2 发布
- [x] 1.4 `core/src/mcp/auth.ts`：McpAuth 全局 node（mcp-auth.json + EffectFlock + .bak 备份，全方法面）
- [x] 1.5 `core/src/mcp/oauth-provider.ts` / `oauth-callback.ts` / `browser.ts`：OAuth provider + 回调服务器 + 浏览器打开（凭据落 McpAuth，PendingProvider 授权完成前不落盘）
- [x] 1.6 `@modelcontextprotocol/sdk` 与 `open` 依赖从 opennovel 移至 core；`bun install` 同步

## Wave 2 — 工具注册桥

- [x] 2.1 JSON Schema → effect codec 转换器（`SchemaRepresentation.toSchema(fromJsonSchemaDocument(draft))`，draft-07/2020-12 双入口；转换失败回退 `Schema.Unknown`）
- [x] 2.2 `McpRegister` Location node（`core/src/mcp/register.ts`）：启动全量注册 + `McpEvent.ToolsChanged` 100ms debounce 重注册（先注册新批再关旧子 scope）；命名沿用 `McpCatalog.toolName` + `Tool.validateName` 适配（数字开头补 `mcp_`、超长截断、撞名序号）；权限 action `mcp_<server>_<tool>`，`Tool.withPermission` 目录面
- [x] 2.3 execute 接线：`PermissionV2.assert` → `mcp.callTool` → `ToolFailure` 映射 → content 转换（文本直通 / SUPPORTED_IMAGE_MIMES 图片内联 / 文本资源解码 / 二进制与 audio 降级占位文本）
- [x] 2.4 `Mcp.node` + `McpRegister.node` 挂进 `location-services.ts` 的 locationServices group

## Wave 3 — OAuth 收敛（并入 Wave 1 落地）

- [x] 3.1 ~~remote 服务器注册为 Integration、token 存 Credential~~ → 修订为 McpAuth core 化（design 否决项 6）；`Credential.Event.Switched` 驱动重连随之取消（凭据变更经 startAuth/authenticate 显式流程驱动重连）
- [x] 3.2 authorize 流程：本地回调服务器 + 浏览器打开（失败发 `McpEvent.BrowserOpenFailed`）+ code 换 token + PendingProvider.commit 落盘（1.3/1.5 落地）

## Wave 4 — 管理面改线与退役

- [x] 4.1 httpapi `handlers/mcp.ts` / `handlers/experimental.ts` 改调 core `Mcp.Service`（端点形状不变）；CLI `cli/cmd/mcp.ts` 改线。实现期增补：core OAuth 前置/状态失败收敛为 `Mcp.AuthError`（裸全局 `Error` 会把 catchTag tags 元组推断塌成 never 且破坏端点 error 契约），handler 边界按既有声明映射（authStart/authAuthenticate→UnsupportedOAuthError，authCallback→BadRequest）；`isV1` 补 V1 形状 mcp 段检测（mcp 键 V1/V2 同名不同形，直挂记录值带 `type` 即 V1）
- [x] 4.2 删 `packages/opennovel/src/mcp/` 全目录；`app-runtime.ts` 移除旧 MCP 接线并接 core `McpAuth.node`；`packages/opennovel/package.json` 移除 `@modelcontextprotocol/sdk` 与 `open` 依赖；`test/mcp/` 旧测试九件与两件夹具随 V1 退役删除（端点测试 httpapi-mcp 保留并转绿）
- [x] 4.3 既有 `mcp-auth.json` 不迁移（格式未变，旧文件继续可读；design 否决项 3）

## Wave 5 — 测试与守门

- [x] 5.1 core `test/mcp.test.ts`：stdio 夹具服务器覆盖连接/状态机/工具注册/权限 deny 整工具消失/ToolsChanged 重注册
- [x] 5.2 注册桥单测：codec 转换（含回退）、命名规则、ToolFailure 映射、content 转换
- [x] 5.3 **守门**：`packages/schema`、`packages/core`、`packages/opennovel` `bun typecheck` 绿 + 测试全绿；`bun run test:httpapi` 绿；根目录 oxlint 0 errors

## Implementation Commits

- `4aa141f985` feat(core)：MCP 客户端 core 化与 V2 工具注册桥（Wave 1-3）
- `ac8f041161` feat(opennovel)：MCP 管理面改接 core 服务并退役 V1 实现（Wave 4）
- `2616f7e7e8` test(core)：MCP stdio 生命周期与注册桥测试（Wave 5）

## 实施记录

- 5.1 权限 deny 整工具消失与 ToolsChanged 重注册落在 `test/mcp-register.test.ts`（注册桥链路）；`test/mcp.test.ts` 覆盖连接/状态机/工具列表。
- 5.2 以真实 stdio 夹具端到端覆盖（测试实际实现，不复刻逻辑）；`bad_schema` 夹具工具验证 codec 回退，碰撞用例覆盖命名规则。
- 5.3 守门：schema/opennovel typecheck 绿；core typecheck 仅剩既有 `http-recorder` 红（分支前已归属）；core 全套 1187 pass / 0 fail；opennovel 全套 1674 pass，唯一失败为分支前已归属的 workspace-adapter 层图硬失败；`test:httpapi` pass=294 missing=0；根 oxlint 0 errors。
- 旧 opennovel MCP 测试移植评估：lifecycle/catalog 语义已由新测试覆盖（连接生命周期、分页、容错）；OAuth 专项（oauth-callback/oauth-provider）按 design 裁定不在 Wave 5 范围。

## Workflow follow-up

（归档后如有回归修复在此补充）
