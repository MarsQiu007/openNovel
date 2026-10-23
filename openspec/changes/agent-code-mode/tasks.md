# Tasks: agent-code-mode

> 四波实现：依赖接线 → core 集成层 → plugin 权限面 → 测试守门。无上游代码移植（fork 自 Initial commit 已携带解释器包，见 design.md 核实点 1-4）。

## Wave 1 — 依赖接线

- [ ] 1.1 `packages/core/package.json` 加 `"@opennovel-ai/codemode": "workspace:*"`；`packages/opennovel/package.json` 移除自 Initial commit 携带的同名死依赖声明（全仓无源码引用）；`bun install` 同步
- [ ] 1.2 既有包回归基线：`packages/codemode` `bun typecheck` 绿 + `bun test` 263/263 绿（零改动确认）

## Wave 2 — core 集成层（`packages/core/src/tool/codemode.ts`）

- [ ] 2.1 `code_mode` 工具：Tool.make + `Tool.withPermission(tool, "code_mode")` + makeLocationNode（deps ToolRegistry/PermissionV2/AgentV2）；execute 前置 permission.assert；inventory = `registry.materialize(agent ruleset)` 排除自身
- [ ] 2.2 嵌套调用桥：inventory definition → codemode Tool.make（JsonSchema 签名面），run 经 `mat.settle` 合成 ToolCall（id 派生 `${toolCallID}#${n}`）；settlement error 上浮为脚本可见失败；成功返回 structured ?? 文本
- [ ] 2.3 `CodeMode.make({ tools, limits: { timeoutMs: 60_000 } })`；Result 数据型映射输出（value/toolCalls/诊断）；工具描述含 tools.* 约定与 `$codemode.search` 指引
- [ ] 2.4 `builtins.ts` 注册 codemode node；`location-layer.test.ts` 目录断言同步 +1

## Wave 3 — plugin 权限面

- [ ] 3.1 director/pipeline 的 permission map 补 `code_mode: "allow"`；其余 `"*": "allow"` 写作 agent 补 `code_mode: "deny"`（deny 置于通配之后）；`"*": "deny"` 的只读 agent（ideator/research）由通配覆盖
- [ ] 3.2 agent-permissions.test.ts 补 code_mode 隔离断言（对齐 browser 族断言先例）

## Wave 4 — 测试与守门

- [ ] 4.1 core `test/tool-codemode.test.ts`：只读工具调用与聚合/写操作经工具自身断言上浮/deny 工具不进 inventory/timeoutMs 中止/返回值与 toolCalls 清单/deny 时 code_mode 本体消失
- [ ] 4.2 **守门**：`packages/codemode`、`packages/core`、`packages/plugin` `bun typecheck` 绿 + 测试全绿；根目录 oxlint 0 errors

## Implementation Commits

（实现完成后用 `git log --grep "OpenSpec-Change: agent-code-mode"` 收集填写）

## Workflow follow-up

（归档后如有回归修复在此补充）
