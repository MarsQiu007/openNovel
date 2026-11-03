# Proposal

## Why

LLM 裁判链路落地后（llm-permission-judge + permission-judge-ui），裁判的配置面被复制成一式三份：`mode` / `policy` / `judge.model` 各自在全局、项目、agent 三级都可写，其中 agent 级 `mode`/`policy` 是从未暴露给 UI 的隐藏配置项。界面上 agents 面板每个 agent 挂一个裁判模型下拉，设置页还摊着一块改不了的只读策略表。而用户的实际心智模型只有两个：一个权限模式开关（选审批方案）和一个独立裁判（像其他子代理一样有自己的模型）。执行层裁判本就是"独立子代理"的等价形态（进程内一次性结构化调用、独立 prompt、独立模型、注入隔离），繁琐全部来自配置面的过度复制。

## What Changes

- 权限配置面收敛为 "1+1"：模式三档（保留，含项目级收紧标注）+ 裁判模型唯一入口
- agents 面板新增内置"权限裁判"行：只暴露一个模型选择器（跟随会话 / 指定模型），读写全局配置 `permission.judge.model`；设置页权限区移除裁判模型选择器，只留模式行与项目级来源标注
- **BREAKING** 删除 agent 级权限覆盖：`agents.<id>.permission` 配置段整体移除（V2 schema 字段、V1 迁移透传、解析链路、agents 面板每行裁判下拉一并删除）；升级前写过这些键的用户，其 agent 级覆盖失效（裁判模型回落全局配置 / 跟随会话，模式与策略回落全局与内置默认）。V1 agent schema 的 `permission` 字段保留（它承载工具 allow/deny 规则并兼容存量文件），仅不再产出 V2 agent 级裁判配置
- **BREAKING** 策略表退为内置常量：删除 `permission.policy` 配置键（V2 schema、SDK 类型、UI 镜像一并移除），删除设置页只读策略表；内置默认表保留为代码常量（只读族 allow、subagent 人审、其余 judge），V1 on-disk schema 继续接受 `policy` 键以兼容存量文件，但迁移层不再透传
- 项目级 `judge.model` 一并移除：裁判模型只从全局（用户级）配置解析，项目级配置仍保留模式收严语义不变
- 修订归档 spec `permission-llm-judge`（策略表需求改为内置不可配、模式开关删除 agent 覆盖条款）与 `permission-judge-config-ui`（裁判模型选择器迁至裁判行、删除 agent 级覆盖与策略表展示需求）

## Capabilities

### New Capabilities

（无。本次为既有裁判配置面的收敛，能力边界不变。）

### Modified Capabilities

- `permission-llm-judge`: 「按动作分类的裁判策略表」由"可配置表"改为"内置常量表"（删除三级配置覆盖）；「全局模式开关与影子模式」删除"支持按 agent 覆盖"条款
- `permission-judge-config-ui`: 裁判模型选择器由"设置页全局默认 + 每 agent 覆盖"双入口收敛为"agents 面板内置权限裁判行"单一入口；删除「agent 级裁判模型覆盖」「策略表只读展示」两条需求

## 非目标

- 不动三档模式语义（ask / judge-shadow / judge）、影子模式双轨、裁判审计事件、注入隔离与 fail-closed 回落人审
- 不真把裁判跑成 subagent 会话：执行架构（进程内一次性结构化调用）不变，"独立子代理"只体现在配置面
- 不做策略表的任何编辑 UI，也不保留配置文件覆盖口子
- 不动 PermissionSaved 沉淀机制与人教规则（always）语义；不动 subagent 默认人审这条安全底线
- 不动项目级模式收严安全设计（clone 来的项目仍无法静默开启裁判模式）

## Impact

- **packages/core**：`permission/policy.ts` 删 `agentConfig` 与三级 `resolve`（退为内置表单查）；`permission/judge.ts` 删 agent 级 / 项目级裁判模型解析（只读全局 `scoped.user?.judge?.model`）；`permission.ts` evaluateInput 删 agent 级 mode/policy 查找；`config/permission.ts` V2 Info 删 `policy` 字段；`config/agent.ts` V2 Agent 删 `permission` 字段；`config/v1/permission.ts` 保留接受 `policy` 键、`config/v1/agent.ts` 不动；`migrate.ts` 的 `permission()` 不再透传 policy、`migrateAgent` 不再产出 agent 级 permission（规则构建器继续跳过 `policy` 键）
- **packages/schema + SDK**：PermissionConfig 类型瘦身，从仓库根 `bun ./script/generate.ts` 再生 openapi.json 与 JS SDK 类型
- **packages/app**：settings-v2 权限区删裁判模型选择器与策略表；agents.tsx 删每行裁判下拉、新增内置"权限裁判"行；删除 `context/permission-policy.ts` UI 镜像；i18n 三语文案增删
- **packages/session-ui**：不受影响（dock-prompt 裁判标注与配置面无关）
- **测试**：core 的 permission / permission-policy / config（V1 迁移用例含 agent 级 permission 断言）测试改写或收缩；opennovel 的 config round-trip 用例（显式书写 `policy`）同步；app 相关单测；检查 opennovel httpapi 练习场景是否写入 permission.policy
- **兼容性**：V1 磁盘 schema 继续接受存量 `policy` 键（避免整文件解析失败），其值静默忽略；agent 级覆盖键失效属有意收编；无本地持久化数据结构迁移
