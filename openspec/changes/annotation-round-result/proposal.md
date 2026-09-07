# 批注执行轮次结果回填（annotation-round-result）

> 状态：草稿 — 优先级 P1（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

`annotation-execute-flow` 已经有执行轮次的创建、查询与更新接口，但当前前端在“指令发送成功”后就把轮次标记为 `completed`，且写入的是“等待 AI 改稿结果”的占位摘要。真实改稿结束后没有任何机制把 AI 的结果摘要和章节版本回填到该轮次，历史面板无法区分“已发送”“执行中”和“AI 已汇报完成”。

同时，执行指令没有携带轮次 ID，AI 无法可靠地把后续结果与创建的轮次关联。plugin 内还有一份未被运行时使用的批注指令格式化副本，会随前端格式漂移。

## What Changes

- 执行指令携带 `execution_round_id`，并明确要求 AI 完成或失败后回填结果。
- 新增 plugin 级 `report_annotation_execution` 工具，校验轮次存在后写入状态、结果摘要和最新章节版本 ID。
- 扩展现有轮次更新契约与返回结构，支持 `chapterVersionId`；不新增重复端点。
- 前端在指令发送成功后保持 `running`，只有在 AI 回填后才变为 `completed` 或 `failed`；历史面板显示结果摘要、章节版本和等待回填状态。
- 移除 plugin 内重复的批注指令格式化实现，保留前端纯逻辑作为单一事实来源。

## Capabilities

### New Capabilities

- `annotation-execution-report`: AI 批注执行结果的回填、章节版本关联与历史展示要求。

### Modified Capabilities

（无——本次只新增执行结果回填能力，不改变批注状态机。）

## Impact

- `packages/novel-store`：`annotation_execution_rounds` 新增 `chapter_version_id` 可空列，并补充迁移。
- `packages/schema` + `packages/protocol` + `packages/server`：扩展执行轮次更新输入与返回结构。
- `packages/client`：契约变更后需在 packages/client 运行 `bun run generate` 重新生成 SDK。
- `packages/plugin`：新增结果回填工具；指令格式携带轮次 ID；删除重复格式化副本。
- `packages/app`：调整轮次完成时机与历史结果展示。
- **本地数据兼容性**：旧执行轮次没有 `chapter_version_id`，历史展示必须降级；`result_summary` 已存在，无需迁移旧值。

**非目标**：本变更不改批注状态机；不实现正文 diff 视图；不做轮次统计报表；不做跨章节批量执行。