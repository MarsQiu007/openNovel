# Proposal: agent-code-mode

## Why

批量文本操作是长篇小说的常态化需求：全书统一改一处称谓、批量校验章节格式、统计各章字数与对话占比、按规则重排引号。当前 agent 只能靠 `edit` 工具逐处修改——47 处修改就是 47 次工具调用，慢、贵、且中途失败会留下半成品状态。上游 openCode 的 code mode 提供另一种范式：**agent 写一段 JS 脚本，在沙箱里调用工具命名空间批量执行**——一次调用完成批量操作，token 成本从 O(n) 降到 O(1)。

> 前提经两轮穷尽式核实（2026-10-24，file:line 证据见 design.md）。关键修正：**解释器包无需移植**——fork 自 Initial commit（49b2add2a9）已携带 `@opennovel-ai/codemode`（0.0.12，typecheck 绿、263 测试全绿，含嵌套命名空间、`$codemode.search` 发现、ExecutionLimits、ToolCallHooks 全部所需能力），但全仓无任何源码引用，是随 fork 复制带入的休眠包。本 change 的实际工作 = **core 集成层自写 + plugin 权限面接线**。上游基线 9d90d892dc 的更新版（effect 4.0.1 API、test262 套件）本期不同步（否决项见 design.md）。

## What Changes

- 启用既有休眠包 `@opennovel-ai/codemode`：core 新增 workspace 依赖；移除 `packages/opennovel` 自 Initial commit 携带的死依赖声明（全仓无引用）
- fork core 集成层自写：`packages/core/src/tool/codemode.ts`（对齐 browser.ts 先例：Tool.make + withPermission + Location 注册），工具名与 permission action 均为 `code_mode`
- 沙箱 inventory = 经 `ToolRegistry.materialize(agent.permissions)` 过滤的当前 agent 可见工具（排除 `code_mode` 自身防递归）；嵌套调用走 registry settle 边界（输入解码、输出限界、工具自身权限断言全部继承）
- 网络默认关闭：沙箱无 fetch、无 import、无文件系统直访、无定时器；ExecutionLimits 显式设 timeoutMs 60s
- plugin 权限面：director/pipeline 放行 `code_mode`（批量操作场景），其余 `"*": "allow"` 写作 agent 显式 deny（对齐 browser 族先例）
- 目录发现：并存模式下模型本就能看到全部直接工具定义；沙箱内另有 `$codemode.search` 按名查签名

## Capabilities

### New Capabilities

- `agent-code-mode`：agent 编写并执行受控脚本批量调用工具

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（codemode 工具与 builtins 注册、新增 workspace 依赖）、`plugin`（写作 agent 权限 map）、`opennovel`（移除死依赖声明）
- **数据兼容性**：不新增存储；脚本内写操作复用现有工具层（state-commit 幂等路径不绕过），权限断言与输出限界自动继承
- **依赖关系**：无硬依赖（agent-task-subagent 已归档，子代理与父会话同源 registry，code_mode 工具注册后子代理按自身权限可用）
- **新增依赖**：无（acorn/effect 已在仓内；`@opennovel-ai/codemode` 是既有 workspace 包）
- **优先级理由**：自主能力的质变点——从"逐条指令执行者"到"自己写工具解决问题"；但对日常单章写作非必需

## 非目标

- 不做脚本的持久化存储与复用市场（脚本随会话生命周期）
- 不做任意 npm 包引入（沙箱无 import，白名单 API）
- 不替代 38 维审计（code mode 是执行机制，不是审校逻辑）
- 本期不做流式脚本输出（执行完返回结果）
- 不做 OpenAPI/MCP 工具的 codemode 适配（既有包 src/openapi/ 保留不动，归 agent-mcp-client 启用）
- 不采纳上游 definitions 二分范式（execute 启用时隐藏非 direct 工具定义；fork 写作 agent 提示词与指令分层均假设直接调用）
- 不同步上游基线版 codemode 包（effect 4.0.1 漂移牵扯全仓升级，独立事件另议）
