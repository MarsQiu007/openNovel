# Design: agent-code-mode

> 穷尽式核实重写（2026-10-24）。原始设计（2026-10-21 衔接核实）的授权路径与查询面盘点结论保持有效，并入下文。

## 现状核实（file:line 证据）

1. **上游包存在且自包含**：基线 9d90d892dc（2026-10-20，UPSTREAM-BASELINE.md 指针）`packages/codemode/package.json` = `@opencode/codemode` 2.0.32，deps 仅 `acorn@8.15.0` + `effect@catalog:`；src 90 文件约 10.8k 行（`interpreter/interpreter.ts` 2334 行为核心）。与 fork 零耦合，可整体移植。
2. **上游集成层四文件**：`packages/core/src/codemode/{catalog,instructions,tool,web}.ts`（tool.ts 365 行）。tool.ts 依赖上游专有件——`@opencode/schema/tool` 的 Info/Result/Error、`../tool/runtime.js` 的 definition/normalizedName、Tool.Snapshot 的 definitions 二分——与 fork 的 Tool.make/ToolRegistry（`packages/core/src/tool/tool.ts:10`、`registry.ts`）不可直移，集成层须自写。
3. **上游范式二层结构**（`packages/core/src/tool.ts:252-257`）：execute 启用时，`options.codemode !== false` 的工具从 model definitions 隐藏，只能经沙箱 `tools.*` 调用；目录经 CodeModeInstructions 随请求 delta 下发（`session/context.ts:150`）。fork 不采纳（见否决项 1）。
4. **fork 权限断言在工具 execute 内**：edit/write/apply_patch 等在 execute 内 `permission.assert`（`packages/core/src/tool/AGENTS.md` 架构说明；browser.ts 六工具同型）。嵌套调用合成 Tool.Context（`tool.ts:10-15`：sessionID/agent/assistantMessageID/toolCallID 四字段）即可继承全部权限语义，无需新审批链路。
5. **fork whollyDisabled 同型**：`registry.ts:149` 以 action+Wildcard.match 过滤目录（deny+resource"*" 整工具消失），与上游 `tool.ts` 末尾 whollyDisabled 语义一致——inventory 过滤直接复用。
6. **解释器自带资源限制**：`interpreter/limits.ts` 硬上限（字符串 1<<24、数组 10M、pending promise 10k、宿主交互深度 32）；`codemode.ts` ExecutionLimits.timeoutMs 无默认值，fork 集成层必须显式设置（定 60s）。
7. **acorn 已就绪**：bun.lock:148/2674 已有 acorn 8.15.0，与上游 codemode 要求精确一致，新增包只加 catalog 条目。
8. **移植源 SHA 裁定**：packages/codemode 历史 220 提交、core/src/codemode 33 提交。逐提交移植不可行且无必要——以基线快照 9d90d892dc 为单一移植源（语义等价于截至该 SHA 的全部演进），实现提交 body 写 `Ported-from: 9d90d892dc...`（完整 40 位 SHA 于提交时展开）。引入提交 12d9f4b29b（"feat(codemode): add confined execution package (#35118)"）备查。
9. **查询面盘点（沿用 2026-10-21 结论）**：工具层 `read_chapter_content`/`read_chapter_outline`/`check_novel_settings`/`list_story_arcs` 已覆盖单点查询；函数层 archive.ts/recall.ts/context.ts 已有结构化查询实现。code mode 命名空间 = 既有 registry 工具的 JS 绑定薄层，不新建查询逻辑。novel-writer 的 ~90 个写作工具经 plugin tool.transform 进同一 registry，自动进入沙箱 inventory。
10. **测试面**：上游 17 个单元测试（callbacks/codemode/enumeration/errors/extensions/limits/new-expression/parity/promise/signature/stdlib/tool-paths/web-wpt 等）+ test262 conformance 套件（27 文件，纯 JS 语义测试，平台无关）。openapi.test.ts 与 fixtures/openapi-* 属排除范围。

## 方案

### Wave 1：解释器包移植（packages/codemode → fork `@opennovel-ai/codemode`）

- 复制 `src/`（排除 `src/openapi/` 与 index.ts 的 OpenAPI 导出）、`test/`（排除 openapi.test.ts 与 openapi fixtures；含 test262 套件与两个 LICENSE 文件）、AGENTS.md/README.md/interpreter-support.md（标注 Ported-from）
- package.json 按 fork 模板改写（name `@opennovel-ai/codemode`、repository 指向 fork、deps `acorn: 8.15.0` + `effect: catalog:`）；根 catalog 加 acorn 条目
- 不改写解释器逻辑（忠实移植，冲突为零——fork 无同名模块）

### Wave 2：core 集成层（自写，`packages/core/src/tool/codemode.ts`）

- 单工具 `code_mode`：`Tool.make({ input: { code: string }, ... })` + `Tool.withPermission(tool, "code_mode")`，经 `makeLocationNode` 注册进 builtins（对齐 browser.ts 先例，deps [ToolRegistry.node, PermissionV2.node]）
- execute 内：执行前 `permission.assert({ action: "code_mode", ... })`；inventory = registry 当前工具集按调用方 agent ruleset 过滤（复用 whollyDisabled 语义）且排除 `code_mode` 自身（禁止递归）
- 嵌套调用：沙箱 `tools.<name>(input)` → 查 inventory → 以合成 Tool.Context（同 sessionID/agent/assistantMessageID，toolCallID 派生 `${callID}#${n}`）调工具 execute——写操作经工具自身 assert 过审批闸门
- 输出：工具返回值文本化（toModelOutput/JSON）+ 每次嵌套调用的名称/状态清单；脚本返回值 JSON 化返回
- ExecutionLimits：timeoutMs 60_000；不安装 fetch 扩展（网络默认关闭）
- 工具描述：静态指引（confined runtime、无 import/fs/定时器、tools.* 调用约定、search 发现、显式 return、Promise.allSettled 并发）——语义参照上游 tool.ts description，按 fork 并存模式改写（删「忽略目录外工具」等二分范式措辞）

### Wave 3：plugin 权限面

- director/pipeline 的 permission map 补 `code_mode: "allow"`（批量操作场景：全书称谓统一、格式批校、字数统计）
- 其余 10 个写作 agent 补 `code_mode: "deny"`（对齐 browser 族先例；research/ideator 等只读 agent 由 `"*": "deny"` 通配覆盖，显式条目仅用于 `"*": "allow"` 的 agent）
- agent-permissions.test.ts 补 code_mode 隔离断言；注册测试计数不动（不新增 agent）

### Wave 4：测试与守门

- codemode 包：`bun test` 全绿（移植的 17 单元 + test262 套件原样通过即证明解释器忠实）
- core：`test/tool-codemode.test.ts`——脚本调用只读工具（glob/grep 命名空间）/脚本内写操作过权限断言（deny ruleset 下 BlockedError 上浮）/inventory 不含被 deny 工具/超时与死循环被 limits 中止/返回值 JSON 化/权限 deny 时工具本体不可见（whollyDisabled）
- 守门：codemode/core/plugin `bun typecheck` 绿 + 测试全绿；根 oxlint 0 errors

## 否决项记录

1. **上游 definitions 二分范式**（execute 启用即隐藏非 direct 工具）：否决。写作 agent 提示词与 agent-instruction-layering 分层规范全部假设直接工具调用；fork 无 Instructions delta 下发机制；并存模式已达成批量操作 O(1) 调用数的目标（proposal 的 token 主张针对批量操作调用数，非定义体积）。
2. **CodeModeInstructions 目录下发**（catalog.ts summarize + instructions.ts delta）：否决，同上。沙箱内 `search` 函数（codemode.ts 导出的既有机制）+ 直接定义可见已覆盖发现需求。
3. **web.ts / fetch 扩展**：本期不装（proposal 定网络默认关闭；写作场景的网页访问已有 webfetch/websearch/browser 三件套）。包内 Extension 模块与 web-wpt 测试随包保留（包自包含性），集成层不接线。
4. **OpenAPI 适配器**（src/openapi/、openapi.test.ts）：排除，归 agent-mcp-client（上游 mcp-codemode-defaults 表明其服务 MCP 场景）。
5. **跨会话脚本持久化**：非目标（proposal），沙箱会话级即用即弃。
6. **逐提交移植 220 个历史提交**：否决，以基线快照为单一来源（移植规则的 SHA 清单要求以基线 SHA + 引入 SHA 双锚点满足）。
