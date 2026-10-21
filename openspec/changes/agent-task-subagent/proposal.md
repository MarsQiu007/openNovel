# Proposal: agent-task-subagent

## Why

**叙事修正（2026-10-21 代码核实）**：本提案最初按「fork 没有 task 工具、需要从零新增并预置 draft/review/research 子代理」起草，与代码现状严重不符——V1 侧 task 工具已是生产级实现（`packages/opennovel/src/tool/task.ts`，399 行：前台/后台、task_id 断点恢复、深度限制、模型回退、权限派生），12 个写作子代理（director/architect/pipeline/writer/observer/reflector/auditor/reviser/outliner/librarian/ideator/feedback-intent）全部经它跑在真实父子会话体系上，director/pipeline 的 system prompt 以 `dispatch @xxx (subagent_type: "yyy")` 约定驱动（`packages/plugin/src/novel-writer/agents/director.ts:50-64`）。原「预置 draft/review/research」与既有 writer/auditor/librarian 职责重复，作废；原非目标「不做嵌套委派」与现状 `subagent_depth = 2`（`novel-writer.ts:5965`，director(0)→pipeline(1)→writer/reviser(2)）矛盾，删除。

核实后的真实缺口是三个：

1. **V2 core 没有 subagent 语义，写作流水线全压在 V1 上**。V2 是会话运行时的演进方向（根 AGENTS.md「V2 Session Core」节），`packages/core/src/tool/builtins.ts:26-29` 的 TODO 明确把 task 列为待移植项。若 V2 迁移不带过去，12 个子代理降级为单会话串行——这是保全问题，不是新增问题。
2. **后台子代理不可靠**。V1 后台语义走 `BackgroundJob` 且被实验开关 `OPENNOVEL_EXPERIMENTAL_BACKGROUND_SUBAGENTS` 门禁（`task.ts:100-104`），作业不持久化、崩溃即丢、完成注入是合成分。上游 openCode 已在 V2 上给出完整参照：`subagent` 工具（`packages/core/src/tool/plugin/subagent.ts`）+ Job 三件套（`job.ts` / `session/subagent-job.ts` / `session/subagent-completion.ts`）+ `session/execution/restart.ts` 崩溃恢复，实现「Jobs and their completion observers outlive the plugin that launched them」（全局 Scope 存活 + KV 持久化 `job.background/<notificationID>` + resume 预算防 crash-loop）。
3. **20+ 个 agent 无分类字段**。V1 `Agent.Info`（`opennovel/src/agent/agent.ts:35-55`）、V2 `Agent.Info`（`schema/src/agent.ts:20-31`）与两级 config schema 均无 `category`；director 按类路由、UI 分组、权限基线都缺少结构化依据。

上游参照（基线 `9d90d892dc @ 2026-10-20`）：上游已全量 V2 且将 v1 `task` 改名 `subagent`（`packages/core/src/database/v1-migration.bun.ts:901` `RENAMED_TOOLS`），主题提交组：

- `7819e7f503` feat/fix(core): run command subagents in the background（后台子代理作业起源）
- `fa5ccac707` refactor(core): share subagent completion delivery（完成回传统一）
- `01443d5e00` / `278db3023f` / `9f8551ab6b`（job 注册表：失败细节保全、消费历史上限、id 规约）
- `7d7962b2fa` feat(core): let subagents pick a model（模型选择链）
- `ee0e614221` fix(core): preserve subagent notifications across location eviction（通知存活）
- `606ec4fa38` fix(core): keep recovered shell notices from waking idle sessions（恢复语义）

## What Changes

### 1. V2 core 移植 subagent 语义（核心，Ported-from 流程）

- 移植上游 `subagent` 工具执行骨架：深度限制（沿 parentID 上溯计数）、`permission.assert({ action, resources: [agent.id] })`、子会话创建/续聊校验（existing 子会话 parentID 必须等于当前会话）、模型优先级链（override > agent.model > 父会话 model）、前台 `block` 可中断、可用子代理动态注入工具描述
- 移植 Job 三件套：作业注册表与 KV 持久化（`job.background/<notificationID>`，`Job.Recovery` 联合类型）、完成通知观察者挂全局 Scope（不随工具调用/插件 Scope 死亡）、`SubagentCompletion.deliver` 以 `notificationID` 幂等注入父会话、空文本 `NO_TEXT` 兜底
- 移植崩溃恢复（仅 subagent 范围，适配细节见 design §5）：`recoverSubagent`（child 不存在/parentID 不匹配丢弃；已完结直接通知；running 且非活跃按 KV 预算重试，超出终态化）；fork 无 suspended/idle 之分（drains 进程本地），恢复通知一律 `resume: false`，父会话不自动唤醒
- Session 服务写侧扩展（核实修正：fork 的 create 本就在 Session 服务，SessionStore 保持只读定位）：`CreateInput` 增 parentID/title（child 继承父 location/metadata/permission ruleset）+ children 查询（`SessionStore.list({parentID})`）
- V2 约束对齐（根 AGENTS.md「V2 Session Core」）：不在工具 execute 里同步嵌套跑 prompt 循环，改为持久化创建子会话 + `SessionExecution.wake` + durable admission；「post-crash continuation recovery requires a separate explicit design」由本 change 的 recoverSubagent 设计显式满足

### 2. 写作子代理体系平移不降级

- 12 个 plugin 写作子代理**原生**注册进 V2（novel-writer 新增 V2 插件入口，经既有外部插件加载通路 + `ctx.agent.transform`，不造桥接模块）；director/pipeline prompt 的 dispatch 契约保留；深度语义平移现状——core 默认 1，plugin 写作场景覆写 2（director→pipeline→writer/reviser 两层嵌套在用），与 V1 行为一致
- 子代理权限派生语义保全（对齐 V1 `deriveSubagentSessionPermission`：继承父 deny 而非放宽；ideator 式只读基线不被父会话冲掉）；「subagent 不能中途问用户、审批交互留在 primary」前提不变
- 工具命名定案：V2 工具对齐上游命名 `subagent`（移植零阻力、语义更准）
- **V1 拆除（激进定案 2026-10-21：不保留双轨）**：本 change 删除 V1 task 的实验后台路径（`OPENNOVEL_EXPERIMENTAL_BACKGROUND_SUBAGENTS` 门禁 + 后台分支，替代品已在 V2 落地）；V1 task 前台路径与 `BackgroundJob` 旧面仅存活到紧随其后的运行时切换 change（流水线仍跑 V1，提前拔 = 产品当场断），届时随历史数据一次性迁移（上游 `v1-migration` 模式）删码，不做运行时 legacy notice 垫片

### 3. agent 分类字段 `category`

- V1/V2 两套 `Agent.Info` 与 config schema 增加 `category`，对 20+ 个 agent 归类（编排/创作/审校/记忆/调研/内部）；初版映射：director/pipeline=编排，writer/architect/outliner/ideator=创作，auditor/reviser=审校，observer/reflector/librarian=记忆，feedback-intent=内部（反馈意图编译协议），core 内置与 markdown agent=内部，调研类预留给 browser-research/mcp-client 落地后的检索代理；消费方：director 按类路由、UI 分组、权限基线模板
- 顺手收敛 `agents/` 目录导出形态（4 个带 interface 的 `*AgentConfig` vs 8 个裸对象统一）

### 4. 缺口补齐审查

- 逐个核对 12 个写作子代理与其余 7 个 agent-* 提案的衔接（librarian ↔ browser-research/mcp-client 检索面、auditor/reviser ↔ memory-system 记忆消费、pipeline ↔ background-job-recovery 作业化），结论写入各 change 的 design，防止「不知道已存在」式重复立项

## Capabilities

### New Capabilities

- `agent-subagent`：V2 子代理委派、持久作业与崩溃恢复

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（subagent 工具、Job 三件套、restart 恢复、Session 写侧扩展、KV）、`plugin`（V2 插件入口 + category 标注）、`opennovel`（V1 task 实验后台路径拆除、`BackgroundJob` 旧面加法兼容至运行时切换）、`app`（父子会话 UI 已就绪——`session-switcher.tsx` 与 e2e 均按父子建模，预期零改动或仅分类分组增强）
- **数据兼容性**：V2 session 表 `parent_id` 列与索引已存在（`core/src/session/sql.ts:31,64`）；新增 KV `job.background/` 持久化；不改既有表语义。与 V1 task 历史会话不做运行时 legacy notice——历史数据迁移属 v1-removal（第③格）
- **依赖关系**：agent-background-job-recovery 应基于本 change 的 Job 地基收窄为「写作流水线长作业的恢复策略」（其持久化/恢复机制部分由本 change 承担）；agent-code-mode 建议在其后（子代理可复用 code mode）；与 agent-memory-system（审校子代理查记忆、librarian 检索通道）、agent-browser-research（librarian + 浏览器引擎）、agent-mcp-client（MCP 工具经同一 registry 自动对子代理可用）协同不阻塞
- **优先级理由**：8 个草案中唯一「上游已有完整 V2 参照实现」的执行/自主能力底座项；补齐 builtins TODO 唯一缺口；UI/数据层/e2e 三处均已按父子会话建模，本 change 只补执行层

## 非目标

- 不取消嵌套委派（现状两层嵌套在用且流水线依赖它）；仅保留深度限制并讨论上限
- 不做跨机分布式执行（同进程/同机语义）
- 不改写作流水线的 8 步结构（子代理是步骤内部的执行方式，不是新步骤）
- 本 change 不切产品运行时——会话创建面与流水线调度仍跑 V1（V2 subagent 能力先落位），运行时切换是紧随其后的下一个 change
- 本期不做子代理流式输出转发到前端（上游 TUI footer tabs 形态留待后续评估）
- 不在本 change 内实现 background-job-recovery 的写作作业恢复策略（分工见依赖关系）
