# 审批驳回后 AI 接手（approval-reject-handoff）

> 状态：草稿 — 优先级 P1（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

review 模式的审批闭环断在"驳回"侧：`submitApproval`（`packages/server/src/handlers/novel.ts:656-676`）处理 REJECT 时只更新章节状态为 `rejected` 并补写 human review 记录，**不向绑定会话发送任何消息/事件**。流水线 agent 虽有"驳回后重写指定章节"分支（`plugin/src/novel-writer/agents/pipeline.ts:149-156`），但触发完全依赖用户手动去 director 会话输入指令——用户审批驳回后必须自己记住并重新组织重写请求，链路断裂。

## What Changes

- 审批驳回时，向该书的绑定写作会话传递结构化重写指令（携带章节 ID、驳回原因/评审反馈），由 director 调度 pipeline 执行"驳回后重写"分支。
- 触发方式在 design 阶段决策：自动直发（利用 `sessions.prompt`）vs 前端提示用户确认后发送。
- 处理边界情况：无绑定会话、会话正在运行（sessionBusy）、驳回原因缺失。

## Capabilities

### New Capabilities

- `approval-reject-handoff`: 审批驳回到 AI 重写的衔接行为——指令内容、触发方式、边界情况处理。

### Modified Capabilities

（无——审批流现有 spec 未覆盖驳回后的 AI 衔接。）

## Impact

- `packages/server`：`submitApproval` 驳回分支增加会话衔接。
- `packages/app`：若采用"确认后发送"，审批条 UI 增加引导。
- `packages/plugin`：pipeline 驳回重写分支的指令消费（分支已存在，可能需对齐指令格式）。
- **行为兼容性**：自动直发会改变"驳回后静默"的现有行为，需在 design 中权衡（用户驳回可能是想自己改而非让 AI 重写——这正是倾向"提示确认"的理由之一）。

**非目标**：本变更不改审批三分支（APPROVE/REJECT/EDIT）语义；不做驳回原因结构化表单；不处理 EDIT 分支（人工编辑已是终态）。
