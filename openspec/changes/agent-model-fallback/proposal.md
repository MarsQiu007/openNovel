# Proposal

## Why

在智能体设置中配置的模型（`agent.<name>.model`，如 director）目前只有一条生效通道：交互输入框提交前的 `switchModel` 钉入。所有绕过输入框的编程式入口——工作台懒创建首条消息、切换器「+」新建轻会话、AI 地图草稿生成——创建的会话不携带模型，服务端运行时只能回落到目录默认模型（全局 `model` 配置；未配置时取目录中发布时间最新的可用模型），静默落到用户从未选择的 provider：该 provider 无凭证时网关报「Header中未收到Authorization参数」，有凭证时则悄悄用错误的模型执行写作任务；director 派生的子代理会话沿继承链同样落空，进一步放大影响面。

## What Changes

- 服务端会话模型解析在「会话显式模型」与「目录默认模型」之间插入代理级回落：会话未指定模型时，使用其代理解析结果（含默认代理解析）配置的模型与推理档位执行；代理配置的模型不在可用目录时以模型不可用错误显式失败，不静默回落——与既有显式模型失败语义（78f07afe0c）对齐。
- 既有「未指定模型时按默认模型解析」的适用范围收窄为「会话与代理均未指定模型」。
- app 编程式会话创建入口（工作台懒创建、「+」新建轻会话、AI 地图草稿生成）在创建会话时钉住当前模型选择（含推理档位），取值与输入控件栏显示值同源，保证「所见即所跑」；驳回重写、批注执行等指向既有绑定会话的指令入口不重复钉入，由服务端解析链覆盖。
- 无 API 契约变更：`session.create` 载荷已支持 `model`（含 `variant`），仅客户端补上传递，无需重新生成 SDK。

## 非目标

- 不改变交互输入框既有的模型解析与钉入链路（`ensureAgentModel` 行为不变）。
- 不改变子代理工具的模型继承链（`override ?? agent.model ?? parent.model` 语义不变）。
- 不处理权限裁判模型链（`permission.judge.model` 独立配置，失败转人工询问的语义不变）。
- 不改变会话内切换 agent 时不联动切换会话模型的现状。
- 不清理 `small_model` 死配置与 `catalog.model.small` 无消费方问题（另案立案）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `session-model-resolution`: 解析顺序插入代理级回落及其显式失败语义；默认模型回落的适用范围收窄为「会话与代理均未指定模型」。
- `novel-chat-panel`: 懒创建与「+」新建轻会话入口创建会话时钉住当前模型选择（含档位）。
- `world-map-ai-draft`: AI 生成地图草稿的会话创建时钉住当前模型选择（含档位）。

## Impact

- 代码：packages/core（`SessionRunnerModel` 解析链引入 AgentV2 依赖；标题生成等 `models.resolve` 调用方自动受益，无需改动）、packages/app（workspace-data 漏斗与 chat-empty-state / session-switcher / map-view 三处创建入口）。
- API：无契约变更，无需 `bun run generate`。
- 数据：无迁移；存量未钉模型的会话在下一次执行时按新解析链获得代理配置模型。
- 行为变化（需周知）：代理配置了模型但该模型不可用（如 provider 凭证失效）时，未钉模型的会话从「静默使用目录默认模型」变为「显式报模型不可用错误」，错误信息含 provider 与模型标识，指引用户修正配置。
- 关联提案：source-driven-import（审查中，未合入）的 import.start 钉模型是同一模式的先行实例；本提案不依赖其合入，两者写集不相交。
