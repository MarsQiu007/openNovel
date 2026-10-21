# Design: agent-background-job-recovery

> 草案种子的衔接核实（2026-10-21，agent-task-subagent 步骤 10）：该 change 已落地的部分不再重复立项，本设计只承载剩余范围。

## 与 agent-task-subagent 落地后的边界

agent-task-subagent 已交付的作业地基（本提案 Why 中「没有恢复语义」的前提已过时）：

- **持久化**：`Background` schema + KV `job.background/<notificationID>`（`core/src/background-job.ts`）；`Recovery` 联合类型 `subagent | shell` 已定义，本期已启用 subagent
- **崩溃恢复**：`core/src/session/execution/restart.ts` recoverSubagent（已完结重通知 / running 跳过 / 预算检查后续跑）；KV `attempts` 预算，>10 次终态化并 error 通知；启动组合处显式调用一次
- **完成回传**：`subagent-completion.ts` deliver（notificationID 幂等、`<subagent>` 包装）；通知一律 `resume: false`

因此本提案**收窄为两块剩余范围**（对齐 agent-task-subagent proposal「依赖关系」的预分工）：

1. **写作流水线章节级断点**：起草类作业按章节为恢复粒度（第 12 章落盘、重启从第 13 章续跑）。落点是流水线自身的状态推进语义（chapter-status / state-commit 已幂等），不在 Job 层重复造恢复机制
2. **shell recovery kind 启用**与非子代理形态长作业的恢复策略；`desktop` 崩溃后重连 UI 提示

## 衔接事实（11 个写作 agent 视角）

- pipeline（8 步流水线执行者，category=orchestration）经 director 以子代理会话调度；整卷生成中断后是否可续跑，取决于子代理作业恢复（已落地）+ 章节断点（本提案）
- V1 实验后台路径已拆除（`opennovel/src/tool/task.ts` 门禁与 `/experimental/session/:id/background` 端点在本 change 步骤 7 退役）；长作业后台化的唯一通道是 V2 subagent 后台路径，本提案的作业化接入以此为前提
