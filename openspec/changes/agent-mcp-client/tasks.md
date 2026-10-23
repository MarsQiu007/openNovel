# Tasks: agent-mcp-client

> 混合路线（design.md 裁定 C）：既有 SDK 1.31 连接语义提升到 core Location 位 + 上游架构语义（scoped 注册桥 / Credential OAuth / 会话恢复）+ opennovel V1 遗物退役。无上游代码逐行移植（无 Ported-from）。

## Wave 1 — core 连接管理（`packages/core/src/mcp/`）

- [ ] 1.1 `packages/schema/src/mcp.ts` 新建：Status 五态 + ServerInfo 等共享类型（沿既有 `opennovel/src/mcp/index.ts:84-99`），index.ts barrel 导出
- [ ] 1.2 `core/src/mcp/catalog.ts`：分页/容错目录语义移植（paginate 游标去重与页数上限、outputSchema 容错 listTools、toolName/sanitize 命名）；删 convertTool 死代码
- [ ] 1.3 `core/src/mcp/index.ts`：`Mcp.Service` Location node（deps: Location/Integration/Credential/EventV2/State）；连接生命周期沿既有语义（stdio/StreamableHTTP/SSE 三传输、状态机、工具变更通知）+ 上游架构语义（连接即列工具、whenLive 防陈旧、KeyedMutex 每服务器锁、endpointLoads 端点串行化、会话过期 recovering 重连重试一次）；配置消费 V2 `ConfigMCP` 段；`McpEvent.ToolsChanged` 经 EventV2 发布
- [ ] 1.4 `@modelcontextprotocol/sdk` 依赖从 opennovel 移至 core；`bun install` 同步

## Wave 2 — 工具注册桥

- [ ] 2.1 JSON Schema → effect codec 转换器（`SchemaRepresentation.fromJsonSchemaDocument` + `Schema.make`；转换失败回退 `Schema.Unknown` + 描述附注）
- [ ] 2.2 `McpTool` Location node：启动全量注册 + `McpEvent.ToolsChanged` 重注册（关旧子 scope 开新子 scope）；命名 `mcp_<server>_<tool>`；`Tool.withPermission` 目录面
- [ ] 2.3 execute 接线：`PermissionV2.assert`（action 同工具名）→ `mcp.callTool` → `ToolFailure` 映射 → content 转换（文本直通 / MEDIA_MIMES 媒体内联 / 文本资源解码 / 二进制存 ToolOutputStore）

## Wave 3 — OAuth 收敛

- [ ] 3.1 remote 服务器注册为 Integration（`mcp_<sha1(name+url)>` 键），token 存 Credential；`Credential.Event.Switched` 驱动重连
- [ ] 3.2 authorize 流程：本地回调服务器 + 浏览器打开（失败发 `McpEvent.BrowserOpenFailed`）+ code 换 token；`startAuth/authenticate/finishAuth/removeAuth/supportsOAuth/hasStoredTokens/getAuthStatus` 方法面

## Wave 4 — 管理面改线与退役

- [ ] 4.1 httpapi `handlers/mcp.ts` / `handlers/experimental.ts` 改调 core `Mcp.Service`（端点形状不变）；CLI `cli/cmd/mcp.ts` 改线
- [ ] 4.2 删 `packages/opennovel/src/mcp/` 全目录；`app-runtime.ts` 移除 MCP/McpAuth 接线
- [ ] 4.3 既有 `mcp-auth.json` 不迁移，重新授权（design 否决项 3）

## Wave 5 — 测试与守门

- [ ] 5.1 core `test/mcp.test.ts`：stdio 夹具服务器覆盖连接/状态机/工具注册/权限 deny 整工具消失/ToolsChanged 重注册
- [ ] 5.2 注册桥单测：codec 转换（含回退）、命名规则、ToolFailure 映射、content 转换
- [ ] 5.3 **守门**：`packages/schema`、`packages/core`、`packages/opennovel` `bun typecheck` 绿 + 测试全绿；`bun run test:httpapi` 绿；根目录 oxlint 0 errors

## Implementation Commits

（实现完成后用 `git log --grep "OpenSpec-Change: agent-mcp-client"` 收集填写）

## Workflow follow-up

（归档后如有回归修复在此补充）
