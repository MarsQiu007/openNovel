# 批注执行轮次结果回填（annotation-round-result）

> 状态：草稿 — 优先级 P1（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

annotation-execute-flow 引入的 `annotation_execution_rounds` 只有两个 API：create 与 GET（`packages/protocol/src/groups/novel.ts:1108,1119`），**没有结果回填端点**——前端执行批注时只写 prompt 快照（`annotation-panel.tsx:110-114`），AI 改稿完成后结果永远不写回，`result_summary` 恒为空串（`handlers/novel.ts:1647`），历史面板只能展示发送时的指令快照（`annotation-panel.tsx:472`），用户无法追溯"这一轮 AI 实际做了什么、结果如何"。

同时批注执行指令存在**格式双轨**：运行时真正发送的是前端本地 `formatPrompt`（`annotation-panel.tsx:204`），而任务 3.2 交付的 plugin 版 `formatExecutionPrompt`（`plugin/src/novel-writer/annotation.ts:122`）仅被测试引用，是死代码——两套格式必然漂移。

## What Changes

- 新增执行轮次结果回填端点（轮次 UPDATE 或专用 report 端点，design 决策），AI 侧在批注执行完成后写回结果摘要与关联章节版本。
- 批注历史面板展示回填结果（状态、涉及批注数、成功/失败）。
- 统一指令格式化：单一事实来源（plugin 侧或前端，design 决策），删除死代码副本。

## Capabilities

### New Capabilities

- `annotation-execution-report`: 执行轮次的结果回填与历史展示要求——回填时机、内容、失败处理。

### Modified Capabilities

（无——annotation-execute-flow 的 spec 尚在 change 内未归档至主 specs，主 specs 无此能力。）

## Impact

- `packages/schema` + `packages/protocol` + `packages/server`：新增端点与消息契约。
- `packages/client`：**契约变更后需在 packages/client 运行 `bun run generate` 重新生成 SDK**。
- `packages/app`：批注历史面板。
- `packages/plugin`：批注执行完成后的回填调用；格式化函数归一。
- **本地数据兼容性**：`result_summary` 列已存在（恒空），无迁移需求；历史空轮次展示需降级处理（只显示 prompt 快照）。

**非目标**：本变更不改批注状态机（applied/resolved/wontfix）；不做轮次统计报表；不做跨章节批量执行。
