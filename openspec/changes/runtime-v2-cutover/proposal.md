# Proposal: runtime-v2-cutover

> v1-retirement-roadmap 第②格。前置：agent-task-subagent（第①格）已落地归档——V2 subagent / Job / KV / 恢复 / 11 agent 原生注册可用。本 change 是一场硬切换，落地后产品不再有生产路径依赖 V1 运行时。

## Why

第①格只把 V2 能力落位，产品会话栈（会话创建、prompt 循环、工具注册、plugin 引导、UI 数据面）仍整体跑在 V1 上——V2 subagent 对 V1 会话不可见，能力等于闲置。V1 面的死期已定案钉在本 change（激进串行，无冻结双轨期），切换完成即删 task 工具与 `BackgroundJob` 旧面。

## What Changes

- **V2 插件面扩展**：移植上游 `ctx.tool` 插件工具注册（fork V2 `PluginContext` 无 tool 钩子，`core/tool/AGENTS.md` 明列 gap），并补齐 novel-writer 必需的插件域：location/paths（目录与全局配置路径）、session 最小读域（父链归属解析）、systemContext 源注册（上下文注入的 V2 落点）
- **novel-writer 全量 V2 引导**：88 个自定义工具经 V2 `ctx.tool` 注册（args 从 zod 迁到 effect Schema——canonical `Tool.make` 只收 effect Schema codec，effect 4 无反向适配器，不造转换层）；`experimental.chat.system.transform` 三段注入改挂 SystemContext 源；`experimental.session.compacting` 注入不重建（V2 Context Epoch 架构下职责消解，见 design §4）；V1 config hook 与 novel-writer V1 入口随本格摘除
- **V2 Session 面补齐**：实现 `SessionV2.wait`（sync prompt 消费方依赖）、`SessionV2.command`（app 斜杠命令执行）、手动 `compact`（接通既有 SessionCompaction）；server/protocol 缺端点按需补齐并重新生成 SDK；`shell` 不在本格实现（无 app 消费方，留 fast-follow）
- **产品会话创建面切 V2**：app 全部 `client.session.*`（V1 SDK 面）改走 V2 `/api/session/*`（含事件词汇与 permission/question 应答面迁移）；CLI `run` 等会话消费命令改 V2 面；control-plane 的取消调用改 `SessionV2.interrupt`
- **继承面处置**：删除 `github`/`pr` 命令与 `acp` 子系统（编程时代继承面，小说产品无 CI 自动化与编辑器集成场景，迁移纯浪费且阻塞第③格 V1 面删除）；`import` 命令经核实后同向处置
- **写作流水线迁 V2 drain**：dispatch 契约 prompt 文本（pipeline/director 的 task 调用约定）切到 V2 subagent 工具参数形状；permission map 的 `task` 键更名 `subagent`（与 V1 入口摘除同批，避免窗口内 V1 权限漂移）
- **V1 面删除（本格内）**：删 `opennovel/src/tool/task.ts` 及其 promptOps 注入链、`agent/subagent-permissions.ts`、`opennovel/src/background/`（wrapper 与级联取消调用点）、`core/src/background-job.ts` 旧方法面（list / extend / waitForPromotion / promote 等第①格保留的兼容项，以实际零引用为准）、novel-writer V1 入口与 V1 config hook 消费点

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runtime-v2`：产品运行时切换（skip_specs 阶段不产出 delta）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（ctx.tool 等插件域桥接、SessionV2.wait/command/compact）、`plugin`（V2 契约扩展、novel-writer 全量 V2 引导）、`protocol`/`server`（端点补齐）、`client`/`sdk`（契约重生成）、`opennovel`（CLI 切换、V1 面删除、继承面删除）、`app`（会话数据面 V2 形状、事件词汇、审批应答面）
- **数据兼容性**：V1 历史会话数据原地保留（读取迁移归第③格）；本格不迁数据。切换后 app/CLI 只见 V2 会话，V1 历史会话在窗口内不可见于产品面——第③格迁移后恢复可见（既定路线，非新增风险）
- **依赖关系**：前置 agent-task-subagent（已归档）；后继 v1-removal；agent-background-job-recovery 与本格合流（恢复策略基于第①格 Job 地基）；`shell` 的 V2 实现为后续独立 change
- **风险**：切换窗内产品功能需逐项验证（流水线 8 步、审批闸门、UI 面）；窗口行为与时序论证见 design §5/§10

## 非目标

- 不迁移历史 V1 会话数据、不删 `core/src/v1` 与 opennovel V1 session 子系统（第③格；本格只删 task/background/config-hook 三个定点）
- 不新增产品功能（纯迁移；继承面只做删除不做替代）
- 不做子代理流式输出转发到前端（独立后续评估）
- 不实现 `SessionV2.shell` 与 `SessionV2.skill`（均无产品消费方，保持 `OperationUnavailableError`；shell 留 fast-follow change）
- 不迁移 V1 plugin host 本身与 auth 插件（auth hook 仍是活路径，随第三方插件迁移另行处置）
