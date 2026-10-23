# Tasks: agent-code-mode

> 四波实现：解释器包移植 → core 集成层 → plugin 权限面 → 测试守门。移植源为上游基线快照 9d90d892dc（packages/codemode 整体；core/src/codemode 仅语义参照，集成层自写）。依据与否决项见 design.md。

## Wave 1 — 解释器包移植（`@opennovel-ai/codemode`）

- [ ] 1.1 复制上游 `packages/codemode/src/`（排除 `src/openapi/` 与 index.ts 的 OpenAPI 导出）、`test/`（排除 openapi.test.ts 与 fixtures/openapi-*，保留 test262 套件与 LICENSE 文件）、AGENTS.md/README.md/interpreter-support.md
- [ ] 1.2 package.json 按 fork 模板改写（`@opennovel-ai/codemode`、acorn 8.15.0 + effect catalog:、fork repository）；根 package.json catalog 补 acorn 条目；tsconfig 对齐 fork 小包先例；`bun install` 同步
- [ ] 1.3 `packages/codemode` 目录下 `bun typecheck` 绿、`bun test` 全绿（含 test262）；解释器逻辑零改写

## Wave 2 — core 集成层（`packages/core/src/tool/codemode.ts`）

- [ ] 2.1 `code_mode` 工具：Tool.make + `Tool.withPermission(tool, "code_mode")` + makeLocationNode 注册（对齐 browser.ts 先例）；execute 前置 permission.assert；inventory 按调用方 ruleset 过滤（whollyDisabled 语义）并排除自身
- [ ] 2.2 嵌套调用桥：沙箱 `tools.<name>(input)` → 合成 Tool.Context（toolCallID 派生 `${callID}#${n}`）调工具 execute；返回值文本化 + 调用清单（名称/状态）入输出
- [ ] 2.3 ExecutionLimits timeoutMs 60_000；不安装 fetch 扩展；工具描述按并存模式改写（含 search 发现指引）
- [ ] 2.4 `builtins.ts` 注册 codemode node；`location-layer.test.ts` 目录断言同步

## Wave 3 — plugin 权限面

- [ ] 3.1 director/pipeline 的 permission map 补 `code_mode: "allow"`；其余 `"*": "allow"` 写作 agent 补 `code_mode: "deny"`（`"*": "deny"` 的只读 agent 由通配覆盖）
- [ ] 3.2 agent-permissions.test.ts 补 code_mode 隔离断言（对齐 browser 族断言先例）

## Wave 4 — 守门

- [ ] 4.1 core `test/tool-codemode.test.ts`：只读工具调用/写操作过权限断言/deny 工具不进 inventory/limits 中止/返回值 JSON 化/deny 时工具本体消失
- [ ] 4.2 `packages/codemode`、`packages/core`、`packages/plugin` `bun typecheck` 绿 + 测试全绿；根目录 oxlint 0 errors

## Implementation Commits

（实现完成后用 `git log --grep "OpenSpec-Change: agent-code-mode"` 收集填写）

## Workflow follow-up

（归档后如有回归修复在此补充）
