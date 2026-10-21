# Proposal: runtime-v2-cutover

> v1-retirement-roadmap 第②格。前置：agent-task-subagent（第①格）已落地——V2 subagent / Job / KV / 恢复 / 12 agent 原生注册可用。本 change 是一场硬切换，落地后产品不再有生产路径依赖 V1 运行时。

## Why

第①格只把 V2 能力落位，产品会话栈（会话创建、prompt 循环、工具注册、plugin 引导、UI 数据面）仍整体跑在 V1 上——V2 subagent 对 V1 会话不可见，能力等于闲置。V1 面的死期已定案钉在本 change（激进串行，无冻结双轨期），切换完成即删 task 工具与 `BackgroundJob` 旧面。

## What Changes

- **plugin 工具注册 V2 化**：移植上游 `ctx.tool` 插件工具注册（fork V2 `PluginContext` 无 tool 钩子，`core/tool/AGENTS.md` 明列 gap）；novel-writer 自定义工具（draft / observe / audit / commit_state 等）经 V2 引导注册进 `Tools.Service`，MCP / session-scoped 注册设计一并定案
- **novel-writer 全量 V2 引导**：V1 config hook 与 V1 plugin host 消费点退役，plugin 的全部 hook 面（config / tool / 会话钩子）迁到 V2 `define()` 入口
- **产品会话创建面切 V2**：app / server / CLI 的会话创建与消息读写改走 V2 Session 面（V2 消息形状），novel 相关 server 路由与 app 页面适配
- **写作流水线 prompt 循环迁 V2 drain**：起草 / 审计 / 修订各步经 durable admission + `SessionExecution.wake`；dispatch 契约与权限派生语义平移；审批闸门的 V2 语义设计（durable admission / question 工具路线，实现前出 design）
- **V1 面删除（本格内）**：删 `opennovel/src/tool/task.ts`、`opennovel/src/background/`（V1 wrapper + 消费它的旧面）、`core/src/background-job.ts` 的旧方法面（list / extend / waitForPromotion / promote，第①格保留的兼容项）；V1 config hook 摘除

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runtime-v2`：产品运行时切换（skip_specs 阶段不产出 delta）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（ctx.tool 注册、插件宿主）、`plugin`（novel-writer 全量 V2 引导）、`opennovel`（server 路由、V1 面删除）、`app`（会话数据面 V2 形状、审批闸门 UI）
- **数据兼容性**：V1 历史会话数据原地保留（读取迁移归第③格）；本格不迁数据
- **依赖关系**：前置 agent-task-subagent；后继 v1-removal；agent-background-job-recovery 与本格合流（恢复策略基于第①格 Job 地基）
- **风险**：切换窗内产品功能需逐项验证（流水线 8 步、审批闸门、UI 面）；design 与 tasks 在第①格落地后编写（吸收其实现结论）

## 非目标

- 不迁移历史 V1 会话数据、不删 `core/src/v1`（第③格）
- 不新增产品功能（纯迁移）
- 不做子代理流式输出转发到前端（独立后续评估）
