# Proposal: agent-background-job-recovery

## Why

整卷生成、全书一致性校验这类长任务跑几十分钟到数小时，当前 `background-job.ts` 提供了后台执行，但**没有恢复语义**：进程崩溃（桌面应用更新、断电、panic）后作业丢失，只能从头重跑——对长任务这是不可接受的浪费。上游 openCode 的 `job.ts` 把作业做成持久化实体，带 `Job.Recovery` 联合类型（含 `kind: "subagent"` 等恢复种类），子代理作业明说 "Jobs and their completion observers outlive the plugin that launched them"——作业比发起者活得久，重启后可重新接上。这套恢复语义正是 fork 缺的。

## What Changes

- 作业持久化：作业状态（类型、参数、进度、产物指针）落库，而非仅内存
- 崩溃恢复：后端启动时扫描未完成作业，按类型决定恢复策略（续跑 / 标记失败待人工 / 丢弃），写作流水线作业默认续跑
- 产物断点：起草类作业按章节为恢复粒度（第 12 章完成后落盘，重启从第 13 章继续）
- 作业与 session 的关系：作业崩溃恢复后重接原 session 上下文（对齐上游 subagent-job 的 recovery 语义）

## Capabilities

### New Capabilities

- `agent-job-recovery`：后台作业的持久化与崩溃恢复

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（background-job 增强、job 状态持久化）、`plugin`（流水线作业的断点语义）、`opennovel`（启动恢复扫描）、`desktop`（崩溃后重连 UI 提示）
- **数据兼容性**：新增作业表；恢复语义依赖现有 session/章节存储结构，不改动
- **依赖关系**：若 agent-task-subagent 先行，子代理作业自动纳入恢复体系；独立可做（先覆盖流水线后台作业）
- **优先级理由**：长任务的可靠性底线；在 subagent/code mode 落地后其重要性进一步放大（更多长任务会出现）

## 非目标

- 不做作业迁移（换机器续跑）
- 不做作业优先级调度与抢占（先到先跑）
- 不做分布式作业队列（单机语义）
- 不承诺 LLM 生成的逐 token 断点续传（恢复粒度是章节级，不是 token 级）
