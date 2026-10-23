# Design: agent-mcp-client

> 穷尽式核实（2026-10-24）：原草案前提是「fork 无 MCP 实现，移植上游 `core/src/mcp/` 五文件」。核实发现 fork 已有完整客户端（前提级事实冲突），路线重裁为「既有实现 core 化 + 补 V2 注册桥 + 退役 V1 遗物」。以下全部核实点给出 file:line 证据。

## 核实点

### A. fork 现状（推翻原前提）

1. **既有完整 MCP 客户端**：`packages/opennovel/src/mcp/` —— `index.ts`（1023 行，连接管理/状态机/OAuth 编排）、`auth.ts`（179 行，`mcp-auth.json` 文件凭据存储）、`oauth-provider.ts`（265 行）、`oauth-callback.ts`（200 行，本地回调服务器）、`browser.ts`（37 行，打开浏览器）、`catalog.ts`（171 行，分页/容错目录）。基于 `@modelcontextprotocol/sdk@1.31.0`（`packages/opennovel/package.json`、`bun.lock` 已锁 npmmirror）。近期活跃：`335b9eff31 fix(opennovel): opennovel 批次第 4 组（mcp 授权与手动编辑同步）`。
2. **工具未接 V2 registry（核心缺口）**：`Mcp.Interface.tools()`（`opennovel/src/mcp/index.ts:169`）返回 `Record<string, McpTool>`（原生形态，注释自述「consumers adapt it to their own tool format」），全仓 grep 无消费方；V1 挂接桥 `catalog.ts:42 convertTool`（转 AI SDK `dynamicTool`）已无消费方——V1 工具面随 v1-removal 拆除后，MCP 工具处于「连得上但 agent 看不见」状态。`packages/core/src/tool/AGENTS.md` Current Gaps 明记：「MCP and future Session-scoped registrations still need an explicit canonical registration design」。
3. **配置双面与迁移管线**：既有实现消费 `ConfigMCPV1`（`core/src/config/v1/mcp.ts`）；V2 `ConfigMCP`（`core/src/config/mcp.ts:43-48`：`Server = Local | Remote`，含 command/cwd/environment/headers/oauth/disabled/timeout）无消费方；`core/src/config/v1/migrate.ts:135` 已有 mcp 段 V1→V2 迁移（servers + timeout.request）。配置面零新增工作。
4. **管理面消费方**（退役改线清单）：httpapi mcp 组（`server/routes/instance/httpapi/groups/mcp.ts:41-132`：status/add/authStart/authCallback/authAuthenticate/authRemove/connect/disconnect）+ `handlers/mcp.ts` + `handlers/experimental.ts:22`（resources）+ CLI `opennovel mcp` 命令组（`cli/cmd/mcp.ts`，673+ 行：list/add/remove/auth*）。TUI 与 desktop 包无 mcp 引用（grep 证实）。
5. **工具命名规则**：`McpCatalog.toolName`（`catalog.ts:118-120`）= `sanitize(server)_sanitize(tool)`（非法字符转 `_`），与上游 `tool/mcp.ts:20-21` 的 namespace/name 规则一致——沿用。
6. **事件面已有**：`packages/schema/src/mcp-event.ts` 定义 `McpEvent.ToolsChanged` / `McpEvent.BrowserOpenFailed`（Event.define 形态），既有实现经 `EventV2` + `publishRouted` 发布。

### B. core 对位服务（全部存在，无需新建基础件）

7. **凭据/集成**：`core/src/credential.ts:49` `Credential.Service`（全局 DB 存储，`Value = OAuth | Key`，按 integrationID 归组）；`core/src/integration.ts:140` `Integration.Service extends State.Transformable<Draft>`（oauth/key/env method + authorize 回调）——上游 `mcp/index.ts:176-215`「remote 服务器注册为 Integration、token 存 Credential」语义可直接落地。
8. **状态代数**：`core/src/state.ts` `State.Transformable<DraftApi>`（transform/reload/draft/finalize）——与上游 `State.create({name, initial, editor, notify})` 同构（API 名差异：draft↔editor、finalize↔notify）。
9. **事件发布**：`core/src/event.ts:127` `EventV2.Interface.publish`——core 内 MCP node 可直接发布 `McpEvent.ToolsChanged`，无需上游 `Bus`。
10. **进程 spawn**：`core/src/cross-spawn-spawner`（既有实现已在用）+ effect beta.83 `effect/unstable/process`（`ChildProcess`/`ChildProcessSpawner`，实测 exports 含 `./unstable/process`）。
11. **权限**：`PermissionV2.assert`（codemode.ts 先例：action/resources/save/metadata/sessionID/agent/source）；工具目录面 `Tool.withPermission` + `whollyDisabled`（registry.ts:149，deny+resource"*" 整工具消失）。
12. **注册面**：`Tools.Service.register(record)`（`core/src/tool/tools.ts:7`）返回 `Effect<void, RegistrationError, Scope>`——scoped 批注册；registry 语义「closing any registration removes only that registration and reveals the next active one」（tool/AGENTS.md Registration 节）支持「ToolsChanged → 关旧 scope 开新 scope 重注册全量」。`registry.materialize` 每轮 LLM 请求现算（`session/runner/llm.ts:203`），动态注册下一轮自然生效。
13. **JSON Schema → effect codec 官方路径**：effect beta.83 `SchemaRepresentation.fromJsonSchemaDocument`（`SchemaRepresentation.d.ts:1912`，draft 2020-12 → Document）+ `Schema.make`（`Schema.d.ts:1475`）——与上游 `tool/runtime.ts:102-107` 同款用法。反向（codec → definition JSON Schema）fork `tool/tool.ts:180 toJsonSchema` 已有。MCP 工具 schema 双向闭环成立。
14. **opennovel 消费 core Location 服务路径**：httpapi handler 可直接 `yield* Location.Service`（`handlers/file.ts:72` 先例）——core 化的 `Mcp.Service` 经同一路径被 handlers/CLI 消费，无需 facade 层。

### C. 上游移植源（仅取架构语义）

15. 上游 `core/src/mcp/` 五文件 2304 行 + `tool/mcp.ts` 167 行，基于 `@modelcontextprotocol/client@2.0.0` + effect 4.0.1。API 差异（agent-code-mode design 已实测记录）：`Schema.TaggedError`（fork 对位 `Schema.TaggedErrorClass`，`tool/tool.ts:32` 先例）、`effect/process`（fork 对位 `effect/unstable/process`）、`ToJsonSchemaOptions.onExcessProperty`（fork 对位 `additionalProperties`）。
16. 上游值得移植的架构语义：Location-scoped node（`configured()` deps: Location/Integration/Credential 等）；`recovering`（会话过期重连并重试一次，`index.ts:350-365`）；`whenLive`（迟到回调防陈旧提交，`index.ts:328-336`）；KeyedMutex 每服务器生命周期锁 + `endpointLoads` 共享端点启动串行化；连接即列工具（失败标 failed 不留静默空目录，`index.ts:437-447`）；`Credential.Event.Switched` 驱动 OAuth 重连（`index.ts:593-598`）。
17. 上游 `tool/mcp.ts` 注册桥语义：execute 内 permission.assert（action=`mcp_<server>_<tool>`）→ callTool → `ToolFailure` 映射 → content 转换（文本直通；read 工具认可的媒体内联 data URI；其余文本资源解码内联；二进制存 ToolOutput 返回路径，`tool/mcp.ts:146-161`）。

## 路线裁定

| 路线 | 内容 | 裁定 |
| --- | --- | --- |
| A. 改造既有实现原地 V2 化 | opennovel/src/mcp 补注册桥 + 切 V2 config | **否决**：架构位错（V2 工具体系在 core，builtins.ts 预留注释与 tool/AGENTS.md Current Gaps 都指向 core 内 scoped 注册）；在冻结的 ConfigV1 消费面上加新功能是技术债加深；InstanceState 与 core Location 双状态体系并存 |
| B. 全量移植上游五文件 | core/src/mcp 移植 2304 行 + 引 @modelcontextprotocol/client@2.0 | **否决**：与既有 SDK 1.31 双 SDK 并存（冗余铁律）；1875 行已验证连接代码（含 335b9eff31 等实战修复：outputSchema 容错、分页游标去重）整体作废换未验证移植 |
| **C. 混合（选定）** | core 新建 Location node：连接语义沿既有 SDK 1.31 代码提升，架构语义（scoped 注册桥/KeyedMutex 生命周期锁/连接即列工具）移植上游 | 单一 SDK、复用已验证代码、架构位正确、注册桥补齐 Current Gaps |

### 否决项汇总

1. 双 SDK 并存（@modelcontextprotocol/client@2.0 + 既有 /sdk@1.31）——见路线 B。
2. elicitation 开启——fork 无 Form 服务；QuestionV2 是选项式提问，与 elicitation 任意 JSON Schema 表单语义不匹；既有实现从未声明该 capability（`opennovel/src/mcp/index.ts:45`），保持关闭无回归。
3. 既有 `mcp-auth.json` 凭据自动迁移——键映射与双写窗口成本高于「重新授权一次」；core 化后存储路径与格式不变，旧文件继续可读，无需迁移。
4. SSE 传输移除——既有实现支持 `SSEClientTransport`，SDK 1.31 自带，保留零成本且保兼容（上游仅 StreamableHTTP 不支持 SSE）。
5. sampling/tasks/roots 之外的新 capability——roots 既有已声明（`index.ts:47`），保留；sampling/tasks 维持关闭。
6. OAuth 凭据落 Credential/Integration（核实点 7 的初判，实现期推翻）——`Credential.OAuth` 仅 `{refresh, access, expires, metadata}` 四字段，MCP OAuth 需要持久化的 `clientInfo`（动态注册产物）/`codeVerifier`/`oauthState` 塞不下；`Integration.authorize` 是 UI 驱动的授权回调模式，与 MCP 自驱动（连接时 401 → 自动走授权流）不匹。裁定为既有 `McpAuth` 文件存储随客户端 core 化（见 OAuth 设计节）。
7. 上游 `recovering`（会话过期重连重试一次）与 `endpointLoads`（共享端点串行化）——V1 从未有过这两个增强，不属回归项；前者依赖上游 client@2.0 的会话语义，后者场景（同端点并发 OAuth 动态注册）在既有实现中以 PendingProvider 串行授权规避。留作后续增强候选，不进本 change。

## 设计

### 模块布局（core 新建）

```
packages/core/src/mcp/
  index.ts          — Mcp.Service / layer / configured() Location node（连接生命周期、状态机、读取面、OAuth 编排）
  catalog.ts        — 分页/容错目录语义（移植 opennovel mcp/catalog.ts，删 convertTool 死代码）
  auth.ts           — McpAuth 全局 node：mcp-auth.json 文件凭据存储（EffectFlock + .bak 备份，沿既有语义）
  oauth-provider.ts — SDK OAuthClientProvider 实现 + PendingProvider（授权完成前不落盘）
  oauth-callback.ts — 本地回调服务器（state CSRF 校验、5 分钟超时、空转自停）
  browser.ts        — McpBrowser 全局 node：打开浏览器 + 失败探测
  register.ts       — McpRegister Location node：工具注册桥（见下节）
```

`packages/schema/src/mcp.ts` 新建：`Status`（connected/disabled/failed/needs_auth/needs_client_registration，沿既有 `index.ts:84-99` 五态）、`ServerInfo` 等共享类型（httpapi 端点形状不变的需要）。`mcp-event.ts` 已有不动。

### Mcp.Service 接口

上游 Interface 子集 + 既有管理面方法的并集：

- 连接管理：`servers()`（状态清单）、`add(name, config)`、`connect(name)`、`disconnect(name)`、`remove(name)`
- 目录读取：`tools()`、`prompts()`/`prompt(...)`、`resources(...)`/`resourceTemplates(...)`/`readResource(...)`、`instructions()`
- OAuth（httpapi/CLI 改线所需）：`startAuth`/`authenticate`/`finishAuth`/`removeAuth`/`supportsOAuth`/`hasStoredTokens`/`getAuthStatus`——语义沿既有，存储落 McpAuth（见 OAuth 设计节）

### 工具注册桥（`core/src/mcp/register.ts`）

- `McpRegister` Location node（deps: Mcp.node + ToolRegistry.node + PermissionV2.node + EventV2.node）；启动时 `mcp.tools()` 全量注册，订阅 `McpEvent.ToolsChanged` 经 100ms debounce 重注册（关旧子 scope、开新子 scope 注册全量，沿 registry「closing reveals next」语义；先注册新批再关旧，目录无空窗）
- 每个 MCP 工具 → `Tool.make`：input codec = `SchemaRepresentation.toSchema(SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12 | fromSchemaDraft07(inputSchema)))`（核实点 13 的 `.ast` + `Schema.make` 写法在 beta.83 不存在，对位为 `toSchema`；转换失败回退 `Schema.Unknown` 交给服务器端校验）；output/structured 均 `Schema.Unknown`，`toStructuredOutput` 取 value、`toModelOutput` 取 content
- 命名：registry 工具名沿用 `McpCatalog.toolName`（`sanitize(server)_sanitize(tool)`，无 `mcp_` 前缀），适配 `Tool.validateName`（字母开头/≤64 字符：数字开头补 `mcp_` 前缀、超长截断、截断撞名追加序号）；权限 action 恒为 `mcp_<server>_<tool>`（`Tool.withPermission` 声明目录过滤面，deny+resource"*" 时整工具从目录消失）
- execute：`PermissionV2.assert({ action: "mcp_<server>_<tool>", resources: ["*"], save: ["*"], ... })` → `mcp.callTool` → isError/异常映射 `ToolFailure` → content 转换（fork 适配上游 `tool/mcp.ts:146-161` 语义：文本直通；`ReadTool.SUPPORTED_IMAGE_MIMES`——jpeg/png/gif/webp，对位上游 MEDIA_MIMES——内联为 file content；文本资源解码内联；**二进制无 ToolOutputStore.save 对位，降级为占位文本**（标注 uri/mime/字节数）；audio 同理降级）

### OAuth 设计

- 凭据存储：**McpAuth 全局 node（`mcp-auth.json` + EffectFlock + `.bak` 备份）随客户端 core 化**，否决 Credential/Integration（理由见否决项 6）。存储路径与文件格式不变，旧凭据文件继续可读
- `Provider`（SDK `OAuthClientProvider` 实现）桥接 McpAuth：tokens/clientInfo/codeVerifier/oauthState 的读写与 URL 归属校验（`getForUrl`）；`PendingProvider` 在授权完成前把凭据留在内存，`commit()` 后才落盘（既有语义）
- authorize 流程：起本地回调服务器（oauth-callback.ts，state CSRF 校验）→ 打开浏览器（browser.ts，失败发 `McpEvent.BrowserOpenFailed`）→ 收 code → 换 token → `PendingProvider.commit()` 落 McpAuth → 重连
- 既有 `mcp-auth.json` 不迁移（格式未变；proposal 非目标指跨格式迁移）
- 错误通道：core 化后 OAuth 方法的前置/状态失败（非 remote、显式禁用、URL 无效、state 不匹配、无在途流程）收敛为 `Mcp.AuthError` tagged error（否决裸全局 `Error`——破坏 httpapi 端点 error 契约推断）；handler 边界按端点既有声明映射——authStart/authAuthenticate 映 `UnsupportedOAuthError`（400），authCallback 映 `BadRequest`，wire 契约不变

### 退役与改线清单

- 删 `packages/opennovel/src/mcp/` 全目录（index/auth/oauth-provider/oauth-callback/browser/catalog）
- `handlers/mcp.ts` / `handlers/experimental.ts` / `cli/cmd/mcp.ts` 改调 core `Mcp.Service`（`yield*` core 服务，file.ts:72 先例）；端点/命令形状不变
- `opennovel/src/effect/app-runtime.ts` 移除 MCP/McpAuth node 接线；`packages/opennovel/package.json` 的 `@modelcontextprotocol/sdk` 依赖移至 `packages/core`
- `location-layer.test.ts` 目录断言无需变（MCP 工具是动态注册，不进静态 built-ins 列表）；补注册桥测试

### 写作 agent 权限面

沿用 design 既有衔接核实（2026-10-21）结论：`"*": "allow"` 型 agent 通配放行（生态工具即插即用）；`"*": "deny"` + 白名单型（ideator/research）默认拒绝，需要时显式加 action。无需逐 agent 改配置。

### 测试

- core `test/mcp.test.ts`：stdio 夹具服务器（SDK 1.31 server 端或 node 脚本）覆盖连接/状态机/工具注册/权限 deny 消失/重注册
- 注册桥单测：JSON Schema → codec 转换（含回退）、命名规则、ToolFailure 映射、content 转换
- httpapi/CLI 改线后既有测试复跑（`bun run test:httpapi`）
