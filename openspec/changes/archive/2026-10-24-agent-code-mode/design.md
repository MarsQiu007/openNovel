# Design: agent-code-mode

> 第二轮穷尽式核实重写（2026-10-24）。第一轮（同日早些时候）按「移植上游 packages/codemode」写完 tasks 后，提取基线快照时发现与本地文件冲突，进而查实**fork 已携带该包**——第一轮提案的移植前提作废，本文档为修正后定稿。2026-10-21 衔接核实的授权路径与查询面盘点结论保持有效，并入下文。

## 现状核实（file:line 证据）

1. **fork 既有 codemode 包**：`packages/codemode/package.json` = `@opennovel-ai/codemode` 0.0.12，`git log --reverse` 首提交即 49b2add2a9 "Initial commit"（fork 复制上游时带入）。deps：acorn 8.15.0 + effect catalog:。现状健康：`bun typecheck` 绿、`bun test` 263/263 绿（7 个测试文件）。
2. **既有包能力面覆盖全部集成需求**：`src/codemode.ts` 导出 `CodeMode.make({ tools, limits })` → `Runtime { catalog, instructions, execute(code): Effect<Result, never> }`；`Result` 为数据型成功/失败（`toolCalls` 审计清单内置）；`src/tool-runtime.ts:26` HostTools 支持嵌套命名空间（`tools.<ns>.<name>` 或扁平 `tools.<name>`）；`:718` 保留命名空间 `$codemode.search` 按 query/namespace 查签名；`:85-104` Search 分页参数齐备；ExecutionLimits 含 timeoutMs/maxToolCalls/maxOutputBytes（`codemode.ts:10-29`，timeoutMs 无默认，集成层必须显式设值，定 60_000）；`interpreter/limits.ts` 硬上限（字符串 1<<24、数组 10M、pending promise 10k、深度 32）。
3. **全仓无人使用**：grep `codemode` 于 packages/{opennovel,core,server,tui}/src 零命中；`packages/opennovel/package.json:89` 的 `"@opennovel-ai/codemode": "workspace:*"` 自 Initial commit 携带（`git log -S` 溯源），属死依赖声明，本 change 顺手移除。
4. **上游基线版更新但本期不需要**：基线 9d90d892dc 的上游包新增 data.ts/extension.ts/namespace.ts/tools.ts 与 test262 套件（27 文件），且基于 effect 4.0.1（fork 为 4.0.0-beta.83；`Schema.TaggedError`、`JsonPointer.parseUriFragment`、`ToJsonSchemaOptions.onExcessProperty/referencePolicy` 等 API 在 beta.83 不存在——第一轮提取快照实测 typecheck 10 处红）。既有版已含集成所需的全部能力，同步升级是独立的 effect 升级事件，不进本 change（否决项 4）。
5. **fork 工具链路可完整桥接**：`tool.ts:170` `Tool.definition(name, tool)` 产 ToolDefinition（含 inputSchema JSON Schema）→ codemode `Tool.make` 接受 JsonSchema 作签名面（`packages/codemode/src/tool.ts:33,68-70`：JSON Schema 只塑造签名、值透传不校验——校验由 fork settle 边界负责）；`registry.ts:106-139` `materialize(permissions)` 已是「按 agent ruleset 过滤（whollyDisabled）+ settle 执行边界（输入解码/输出限界/工具内权限断言）」的现成组装——inventory 与嵌套调用桥全部复用它，不需要新机制。
6. **嵌套调用上下文合成**：`registry.ts:16-21` ExecuteInput = {sessionID, agent, assistantMessageID, call: ToolCall}；嵌套调用复用外层 sessionID/agent/assistantMessageID，call.id 派生 `${toolCallID}#${n}`（单次执行内单调递增）。写操作经工具自身 execute 内 permission.assert 过闸（tool/AGENTS.md「Leaves own resolution, permission」），code_mode 不新开审批链路。
7. **agent ruleset 获取**：`session/runner/llm.ts:203` 以 `agent.info?.permissions` 调 materialize；集成层同路：`AgentV2.Service.get(context.agent)` → `info.permissions`（缺省走 permission.ts:15 missingAgentPermissions 全 deny 语义——code_mode 本身 assert 已先行拦截）。
8. **查询面盘点（沿用 2026-10-21 结论）**：工具层 read_chapter_content/read_chapter_outline/check_novel_settings/list_story_arcs 已覆盖单点查询；函数层 archive.ts/recall.ts/context.ts 已有结构化查询实现。code mode inventory = 既有 registry 工具的 JS 绑定薄层（materialize 现成产出），不新建查询逻辑。novel-writer 的 ~90 个写作工具经 plugin tool.transform 进同一 registry（tool/AGENTS.md Current Gaps 节），自动进入 inventory。

## 方案

### Wave 1：依赖接线

- `packages/core/package.json` 加 `"@opennovel-ai/codemode": "workspace:*"`；`packages/opennovel/package.json` 移除同名死依赖；`bun install` 同步
- codemode 包本体零改动（既有 263 测试即回归网）

### Wave 2：core 集成层（`packages/core/src/tool/codemode.ts`，自写）

- 单工具 `code_mode`：input `{ code: string }`（= CodeMode.Input 语义），output = Result 映射（value/calls/error）
- 结构对齐 browser.ts 先例：`Tool.withPermission(Tool.make({...}), "code_mode")` 经 `Tools.Service.register` + `makeLocationNode({ deps: [ToolRegistry.node, PermissionV2.node, AgentV2.node] })` 注册进 builtins
- execute 流程：
  1. `permission.assert({ action: "code_mode", resources: ["*"], save: ["*"], sessionID, agent, source })`（对齐 browser.ts）
  2. `AgentV2.Service.get(context.agent)` 取 ruleset → `registry.materialize(ruleset)`
  3. inventory = materialize.definitions 排除 `code_mode` 自身（防递归）→ 每个 definition 桥接为 codemode `Tool.make({ description, input: inputSchema, run })`，run = 经 `mat.settle` 调同名工具（合成 call id）；settlement `type: "error"` → 抛回脚本（ToolError），成功 → 返回 structured ?? 文本
  4. `CodeMode.make({ tools, limits: { timeoutMs: 60_000 } }).execute(code)`；Result 映射为工具输出（Failure 是数据非异常，以文本诊断返回模型）
- 工具描述（静态）：confined runtime、无 import/fs/定时器/fetch、`tools.<name>(input)` 调用约定（可调用集 = 你在本会话可见的工具）、`tools.$codemode.search({ query })` 查签名、显式 return、`Promise.allSettled` 并发、写操作仍过审批
- `builtins.ts` 注册；`location-layer.test.ts` 目录断言同步 +1

### Wave 3：plugin 权限面

- director/pipeline 的 permission map 补 `code_mode: "allow"`（批量操作场景：全书称谓统一、格式批校、字数统计）
- 其余 `"*": "allow"` 写作 agent 补 `code_mode: "deny"`（对齐 browser 族先例，deny 置于通配之后）；`"*": "deny"` 的只读 agent（ideator/research）由通配覆盖不添条目
- agent-permissions.test.ts 补 code_mode 隔离断言；不新增 agent，注册测试计数不动

### Wave 4：测试与守门

- core `test/tool-codemode.test.ts`：脚本调用只读工具并聚合返回 / 脚本内写操作触发工具自身断言（deny ruleset 下错误上浮为脚本可见失败）/ inventory 不含被 deny 工具 / 超时中止（limits）/ 返回值 JSON 化与 toolCalls 清单 / 权限 deny 时 code_mode 本体从目录消失（whollyDisabled）
- 守门：`packages/codemode`、`packages/core`、`packages/plugin` `bun typecheck` 绿 + 测试全绿；根 oxlint 0 errors

## 否决项记录

1. **上游 definitions 二分范式**（execute 启用即隐藏非 direct 工具定义，上游 tool.ts:252-257）：否决。写作 agent 提示词与 agent-instruction-layering 分层规范全部假设直接工具调用；并存模式已达成批量操作 O(1) 调用数的目标。
2. **上游 CodeModeInstructions 目录下发**（catalog summarize + Instructions delta）：否决。fork 无 Instructions delta 机制；并存模式下模型可见全部直接定义，沙箱内 `$codemode.search` 覆盖签名发现。
3. **fetch/网络扩展**：不安装（写作场景网页访问已有 webfetch/websearch/browser 三件套；proposal 定网络默认关闭）。
4. **同步上游基线版 codemode 包**：否决。基线版基于 effect 4.0.1（fork 为 4.0.0-beta.83，实测 10 处 API 不兼容），升级牵扯全仓 effect 演进，是独立事件；既有版能力已覆盖集成需求（核实点 2）。
5. **OpenAPI 适配器启用**：既有包 src/openapi/ 保留不动，归 agent-mcp-client。
6. **跨会话脚本持久化**：非目标（proposal），沙箱即用即弃。
