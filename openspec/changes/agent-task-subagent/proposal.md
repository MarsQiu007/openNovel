# Proposal: agent-task-subagent

## Why

写作流水线当前是单线程的：起草、审校、修订都在同一会话上下文里串行。两个结构性缺陷：

1. **审校被起草污染**：审校 agent 与起草 agent 共享同一长上下文，审校时看到的是"自己刚写的东西的惯性视角"，而非干净读者视角。审校拿独立上下文（只有设定集 + 目标章节文本）反而审得更准。
2. **无法并行**：多章起草、全书一致性校验这类可分解任务没有委派机制，只能排队。

上游 openCode 有完整子代理体系可参照：`agent.ts` 的 `mode: "subagent"`、`session/subagent-job.ts`（作业持久化，"Jobs and their completion observers outlive the plugin that launched them"）、`session/subagent-completion.ts`、`job.ts`。fork 的 `tool/builtins.ts` TODO 原文已把 `task` 工具列为待移植项。

## What Changes

- 新增 `task` 工具：主会话 agent 可发起子代理作业（指定 agent 类型、任务提示、上下文范围），异步执行、完成后汇总回主会话
- 移植上游 subagent 作业管理三件套的语义：作业生命周期、持久化恢复点、完成通知（具体移植或重实现待讨论）
- 预定义写作场景的子代理类型：`draft`（章节起草）、`review`（一致性审校）、`research`（设定检索汇总）
- 明确隔离级别：同进程轻量子会话（上游模式，成本低）vs 独立会话（隔离彻底，成本高）——待讨论，倾向同进程
- **系统提示词层面同步借鉴 OpenHands 的计划 stance**："先查记忆再动笔"作为起草纪律

## Capabilities

### New Capabilities

- `agent-subagent`：task 工具委派与子代理作业生命周期

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（task 工具、subagent 作业管理、session 运行时协同）、`plugin`（子代理类型注册）、`protocol`/`schema`（作业事件契约，若暴露给前端）、`app`（作业进度展示，远期）
- **数据兼容性**：子代理会话复用现有 session 存储；新增作业表需迁移脚本
- **依赖关系**：无硬前置；与 agent-memory-system 协同（审校子代理查记忆），建议后者先行或并行
- **优先级理由**：fork 自身 TODO 已排队 + 上游有成熟参照，执行/自主能力提升的最大单项

## 非目标

- 不做子代理的嵌套委派（子代理不能再开子代理）
- 不做跨机分布式执行（同进程/同机语义）
- 不改写作流水线的 8 步结构（子代理是流水线步骤内部的执行方式，不是新步骤）
- 本期不做子代理流式输出转发到前端（完成后一次性汇总）
