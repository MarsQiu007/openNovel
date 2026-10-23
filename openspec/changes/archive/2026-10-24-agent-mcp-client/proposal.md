# Proposal: agent-mcp-client

## Why

写作 agent 的素材来源目前只有 `webfetch`/`websearch`/`browser_*` 等内建工具，接不进作者既有的素材生态（Obsidian/Notion 笔记库、百科检索、资料管理等 MCP 服务器）。

穷尽式核实（2026-10-24，全部 file:line 证据见 design.md）推翻了原草案「fork 无 MCP 实现、需移植上游五文件」的前提：

- **fork 已有完整 MCP 客户端**：`packages/opennovel/src/mcp/` 1875 行（连接管理、stdio/StreamableHTTP/SSE 三传输、OAuth 三件套、分页容错目录），基于 `@modelcontextprotocol/sdk@1.31.0`，近期仍有修复提交。
- **但工具未接 V2 registry**：`Mcp.Service.tools()` 返回的原生工具全仓无消费方（V1 工具挂接桥 `convertTool` 已随 v1-removal 成为死代码），agent 实际调不到任何 MCP 工具。`packages/core/src/tool/AGENTS.md` 的 Current Gaps 明记：「MCP and future Session-scoped registrations still need an explicit canonical registration design」。
- **配置仍消费冻结的 ConfigV1**：V2 `ConfigMCP`（`core/src/config/mcp.ts`）已存在却无消费方；V1→V2 迁移管线（`config/v1/migrate.ts`）已覆盖 mcp 段。

所以本提案的真问题不是「从无到有移植」，而是：**把既有客户端提升到 core 的 V2 架构位（Location-scoped node），补齐工具注册桥与权限面，并收敛退役 V1 遗物**。`tool/builtins.ts` 注释预留的「Dynamic MCP and plugin tools later use separate scoped canonical registrations」即为落点。

## What Changes

- **core 新建 `core/src/mcp/`**：Location-scoped `Mcp` node，承载连接生命周期（沿既有 SDK 1.31 语义：状态机、分页容错目录、工具变更通知、OAuth 流程）与 servers/tools/prompts/resources 读取面
- **工具注册桥**：MCP 工具经 `Tools.Service.register` scoped 批注册挂入 V2 registry；命名 `mcp_<server>_<tool>`（沿既有 `McpCatalog.toolName` 规则）；输入 schema 经 `SchemaRepresentation.fromJsonSchemaDocument` 转 effect codec；execute 内 `PermissionV2.assert`（action 同工具名）；`McpEvent.ToolsChanged` 驱动重注册
- **OAuth 凭据收敛到 core `Credential`/`Integration`**（上游 `mcp/index.ts` 语义移植：remote 服务器注册为 Integration，token 存全局 Credential 存储）；既有 `mcp-auth.json` 文件存储退役，不做自动迁移（重新授权一次）
- **配置面切到 V2 `ConfigMCP` 段**：零新增 schema；`mcp add` 等写路径直接写 V2 段
- **管理面改线**：httpapi mcp 组 handler 与 CLI `opennovel mcp` 命令改调 core `Mcp.Service`，端点与命令形状不变
- **退役**：`packages/opennovel/src/mcp/`（含死代码 `convertTool`）删除
- elicitation 保持关闭（与现状一致：既有实现从未声明该 capability）

## Capabilities

### New Capabilities

- `agent-mcp`：MCP 服务器连接管理、动态工具注册与权限接线

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（mcp 模块、工具注册桥、location-layer 目录断言）、`schema`（MCP 状态/服务器信息类型）、`opennovel`（mcp 退役、httpapi/CLI 改线）
- **数据兼容性**：V1 mcp 配置段经既有迁移管线进入 V2 段；既有 `mcp-auth.json` OAuth 凭据失效需重新授权（一次性，design 记录权衡）
- **依赖关系**：无前置提案；MCP 工具经同一 registry 对子代理自动可用；权限面沿写作 agent 通配规则（`"*": "allow"` 放行、`"*": "deny"` 拒绝），无需逐 agent 改配置
- **新增依赖**：无（继续复用既有 `@modelcontextprotocol/sdk@1.31.0`；**不引**上游 `@modelcontextprotocol/client@2.0`，否决双 SDK 并存）
- **优先级理由**：接入面价值随 MCP 生态增长；既有实现已验证，提升架构位 + 补注册桥即可闭环，工作量远小于全量移植上游

## 非目标

- 不实现 MCP server 端（fork 不对外暴露工具服务）
- 不做 resources/prompts 的 UI 呈现（保留 API 读取面，与现状一致）
- **不开启 elicitation**：SDK 层不声明该 capability（与既有实现一致）；服务器主动追问在本期不可达
- 本期不做 sampling（服务器反向调用 LLM；既有实现同样关闭）
- 不做 MCP 服务器的自动发现/市场（手动配置）
- **不迁移既有 `mcp-auth.json` 凭据**（退役后重新授权；迁移的键映射 name+url → Integration ID 成本高于收益）
- **不移植上游 `core/src/mcp/` 五文件代码**：其传输层基于 `@modelcontextprotocol/client@2.0` + effect 4.0.1 API，与 fork 既有 SDK 1.31 + effect beta.83 双不兼容；仅移植其架构语义（Location node、scoped 注册、Credential/Integration OAuth、会话恢复）
