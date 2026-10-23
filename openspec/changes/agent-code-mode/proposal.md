# Proposal: agent-code-mode

## Why

批量文本操作是长篇小说的常态化需求：全书统一改一处称谓、批量校验章节格式、统计各章字数与对话占比、按规则重排引号。当前 agent 只能靠 `edit` 工具逐处修改——47 处修改就是 47 次工具调用，慢、贵、且中途失败会留下半成品状态。上游 openCode 的 code mode 提供另一种范式：**agent 写一段 JS 脚本，在沙箱里调用工具命名空间批量执行**——一次调用完成批量操作，token 成本从 O(n) 降到 O(1)。上游实现独立成包（`packages/codemode`，acorn 解释器 + Effect 运行时）+ core 集成层（`core/src/codemode/`：catalog、tool、web、instructions），边界清晰，可移植。

> 前提经穷尽式核实（2026-10-24，file:line 证据见 design.md）：上游基线 9d90d892dc 确有该包（@opencode/codemode 2.0.32，90 个 src 文件）；集成层四个文件属实。两处前提修正：①fork 不采纳上游「execute 启用即隐藏直接工具定义」的范式（写作 agent 提示词全部假设直接调用），改为**并存模式**；②嵌套工具调用经 fork 工具自身 execute 内 permission.assert 过闸，不需要新审批链路。

## What Changes

- 移植上游解释器包：`packages/codemode`（fork 命名 `@opennovel-ai/codemode`，acorn + effect 自包含，无 fork 耦合），排除 OpenAPI 适配器（属 agent-mcp-client 范畴）与 publish/test262 同步脚本
- fork core 集成层全新自写：`packages/core/src/tool/codemode.ts`（对齐 browser.ts 先例：Tool.make + withPermission + Location 注册），工具名与 permission action 均为 `code_mode`；沙箱 inventory = 当前 agent 未被 deny 的 registry 工具全集，嵌套调用合成 Tool.Context 复用工具自身权限断言
- 网络默认关闭：不安装 fetch 扩展（上游 web.ts 不移植）；沙箱无 import、无文件系统直访、无定时器
- plugin 权限面：director/pipeline 放行 `code_mode`（批量操作场景），其余写作 agent 显式 deny（对齐 browser 族双保险先例）
- 目录发现：静态工具描述 + 沙箱内 `search` 函数（上游既有机制），不移植上游 Instructions delta 目录下发（fork 无该机制且并存模式下模型本就能看到直接工具定义）

## Capabilities

### New Capabilities

- `agent-code-mode`：agent 编写并执行受控脚本批量调用工具

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：新增 `packages/codemode`（解释器移植）；`core`（codemode 工具与 builtins 注册）；`plugin`（写作 agent 权限 map）
- **数据兼容性**：不新增存储；脚本内写操作复用现有工具层（state-commit 幂等路径不绕过），审计日志自动继承
- **依赖关系**：无硬依赖（agent-task-subagent 已归档，子代理与父会话同源 registry，code_mode 工具注册后子代理按自身权限可用）
- **新增依赖**：`acorn` 8.15.0（已在 bun.lock，版本与上游要求精确一致）
- **移植来源**：上游基线快照 9d90d892dc（packages/codemode 全部 + core/src/codemode 语义参照；220/33 个历史提交不逐个移植，以基线快照为单一来源，SHA 清单见 design.md）
- **优先级理由**：自主能力的质变点——从"逐条指令执行者"到"自己写工具解决问题"；但对日常单章写作非必需

## 非目标

- 不做脚本的持久化存储与复用市场（脚本随会话生命周期）
- 不做任意 npm 包引入（沙箱无 import，白名单 API）
- 不替代 38 维审计（code mode 是执行机制，不是审校逻辑）
- 本期不做流式脚本输出（执行完返回结果）
- 不做 OpenAPI/MCP 工具的 codemode 适配（归 agent-mcp-client）
- 不采纳上游 definitions 二分范式（execute 启用时隐藏非 direct 工具定义；fork 写作 agent 提示词与指令分层均假设直接调用，隐藏会破坏既有行为）
- 不移植 test262 生成/报告脚本与 publish 脚本
