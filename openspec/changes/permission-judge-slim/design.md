# Design

## Context

见 proposal.md - Why。现状：裁判配置面为 `mode` / `policy` / `judge.model` 三键 × 全局 / 项目 / agent 三级共 10 个入口，UI 暴露其中 4 处（全局模式两处、全局裁判模型、每 agent 裁判下拉、策略表只读）。执行层 `PermissionJudge` 是进程内一次性结构化调用（`LLM.generateObject` + 硬编码 system prompt），与 subagent 会话无涉。

## Goals / Non-Goals

Goals：配置面收敛为"模式三档 + 裁判模型唯一入口"；裁判模型解析链路与 UI 镜像同步瘦身；存量配置文件不炸。
Non-Goals：执行架构（进程内裁判调用、注入隔离、影子双轨、审计）一行不动；项目级模式收严语义不动。

## Decisions

### D1 配置面收敛矩阵

```
              mode        policy        judge.model
全局(用户级)   保留         删除           保留（唯一裁判模型数据键）
项目级         保留(收严)   删除           删除
agent 级       删除         删除           删除
内置默认表     —           保留(常量)     —
```

删除项连调用方一并清理：`PermissionPolicy.agentConfig`、`evaluateInput` 中 agent 级查找、`judge.ts` 的 agentLevel/project 回落、`config/agent.ts` V2 Agent 的 `permission` 字段（`migrateAgent` 不再产出该键）。项目级 `judge.model` 一并移除——项目级配置本就被模式收严条款锁死，留一个项目级裁判模型键只剩迷惑性。

### D2 裁判模型解析（packages/core/src/permission/judge.ts）

`resolve` 中 `configured = scoped.user?.judge?.model`；`selectModel` 纯函数与其单测保留（全局键 → 会话模型跟随 → 默认模型）。删除 `PermissionPolicy.agentConfig` 依赖后，judge.ts 不再 import policy 模块。

备选：保留项目级回落——被否，理由见 D1。

### D3 策略表内置化（packages/core/src/permission/policy.ts）

`resolve(action)` 退为 `defaults[action] ?? "ask"` 单查；`defaults` 常量与"只读族 allow / subagent ask / 其余 judge / 未列 ask"语义原样保留（这是安全底线，不是配置）。删除 core 侧"UI 镜像同步"注释；app 侧 `context/permission-policy.ts` 整文件删除，`settings-v2/permission.tsx` 的策略表区块移除。

### D4 V1 磁盘兼容（packages/core/src/config/v1/permission.ts + migrate.ts）

V1 on-disk schema **保留**接受 `policy` 键（显式字段 + RestValue 中的 PolicyValue 均保留），避免含存量 policy 的文件整体解析失败（permission-judge-ui 修过的同类静默退化事故）；`migrate.permission()` 不再透传 policy；规则构建器**继续跳过** `"policy"` 键——否则存量 `policy: {read: "allow"}` 会被沉淀为规则记录污染 Ruleset。V2 `ConfigPermission.Info` 删除 `policy` 字段；V2 `ConfigAgent.Info` 的 `permission` 字段一并删除（agent 级裁判三键全删后该字段整体死亡），V1 agent schema 的 `permission` 字段保留——它承载工具 allow/deny 规则，且 V1 侧存量裁判键随 `migrateAgent` 不再透传而静默失效。

备选：V1 直接拒收 policy——被否，存量文件炸解析违背兼容性承诺。

### D5 UI 收敛（packages/app）

- `settings-v2/permission.tsx`：删除裁判模型选择器（`judgeModelOptions` / `onSelectJudgeModel`，该文件的 `FOLLOW_VALUE` 常量随之删除）与策略表区块（`policyRows`），权限区只剩模式行 + 项目级来源标注。
- `settings-v2/agents.tsx`：删除每行裁判下拉（`pendingJudge` / `judgeModelOf` / `judgeSaveMutation` / `onSelectJudge` / 裁判用 `judgeModelOptions` / 「裁判」徽标；本文件的 `FOLLOW_VALUE` 保留——主模型选择器仍用）；在智能体列表**之外**独立渲染内置"权限裁判"行（不参与过滤与排序，不受 `useFilteredList` 的 name 排序影响）——非 `v2.agent.list()` 数据，不可删除、无描述编辑，只渲染一个模型选择器，读写全局配置 `permission.judge.model`（写通道与现 settings 选择器相同，均为 `updateConfig`；空串清除约定保留）。
- i18n：`settings.permission.judgeModel.*` 键语义迁移到裁判行（新增行名/描述键），`settings.permission.policy.*` 与策略表相关键删除，三语文案同步。

### D6 契约再生与测试

V2 schema 删字段 → 从仓库根 `bun ./script/generate.ts` 再生 openapi.json 与 JS SDK 类型（PermissionConfig 不再含 policy、AgentConfig 不再含 permission 裁判段）；`packages/client` 按需 `bun run generate`。测试更新：core `permission-policy.test.ts`（resolve 签名与覆盖链用例收缩为内置表用例、agentConfig describe 删除、selectModel 保留）、`permission.test.ts`、core `test/config/config.test.ts`（V1 迁移用例：policy 不再透传、agent 级 permission 不再产出）、opennovel `test/config/config.test.ts`（round-trip 用例去掉 policy 字段）；app 相关单测；检查 opennovel httpapi 练习场景是否书写 permission.policy。

## Risks / Trade-offs

- 用户曾用 agent 级覆盖 → 升级后失效。缓解：BREAKING 已在提案标注，回落路径（全局 → 跟随会话）确定且安全方向收严。
- 存量 `policy` 键被静默忽略 → 有意设计，分流以内置表为准，属收编而非事故。
- SDK 删字段波及其他消费方 → 全仓 regenerate + `bun typecheck` 验证。

## Migration Plan

纯配置面收编，无持久化数据迁移。顺序：core config schema → 裁判链路 → 根 regenerate → app UI/i18n → 测试。回滚即 revert 本 change。

## Open Questions

无。两个产品决策（裁判行放 agents 面板、策略表彻底退内置）已在提案前与用户对齐。
