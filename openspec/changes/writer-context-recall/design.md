## Context

Writer agent 权限列表中没有 `assemble_context_snapshot`，会话级 `injectSystemContext` 使用轻量 `assembleSnapshot`（`recalledHistory` 硬编码为空数组）。而 `assembleWriterSnapshot` 已实现三路召回（实体重叠 + FTS5 + 伏笔强制）、P5 世界观筛选、受保护关系选择和 P0-P6 预算裁剪。见 proposal.md 了解动机。

## Goals / Non-Goals

**Goals:**
- writer 获得调用 `assemble_context_snapshot` 的权限
- writer 提示词引导在生成前调用该工具
- `injectSystemContext` 升级为 `assembleWriterSnapshot`
- writer 提示词引导在需要时主动调用 `recall_history`

**Non-Goals:**
- 不修改召回算法（`runRecall` 已完备）
- 不修改预算裁剪分层
- 不新增数据库字段
- 不实现故事主轴（后续提案）

## Decisions

### 1. `injectSystemContext` 直接替换为 `assembleWriterSnapshot`

**选择**：将 `injectSystemContext` 中对 `assembleSnapshot` 的调用替换为 `assembleWriterSnapshot`。

**理由**：`assembleWriterSnapshot` 是 `assembleSnapshot` 的超集——它在 `assembleSnapshot` 的基础上增加了章纲读取、实体提取、三路召回、P5 筛选和预算裁剪。直接替换零成本获得召回能力。两份快照格式一致（`formatSnapshotToolOutput` 通用）。

**替代方案**：在 writer 权限中只加 `assemble_context_snapshot`，不改 `injectSystemContext`。这意味着 writer 每章都必须主动调用工具才能获得召回，如果 writer 忘了调用就退化为当前行为。替换 `injectSystemContext` 保证底线，writer 主动调用则获得更精准的按章召回。

### 2. writer 提示词在工作流程步骤 1 前插入"调用 assemble_context_snapshot"

**选择**：在 writer.ts 工作流程的第 1 步（"接收大纲和上下文"）之前插入新步骤："调用 assemble_context_snapshot 获取本章完整上下文（含前文召回）"。

**理由**：writer 现有工作流程从 1-9 编号，在最前面插入确保 writer 先获取上下文再开始写作。

### 3. `recall_history` 主动调用引导放在工作流程末尾

**选择**：在工作流程最后（自检步骤附近）添加提示："如果本章剧情需要引用前文具体细节（承诺、数字、对话、地点），且快照召回不够，使用 recall_history 按关键词深挖"。

**理由**：`recall_history` 是补充性质的按需查询，不需要在开头强制调用。放在末尾作为可选步骤，减少每次生成的工具调用次数。

## Risks / Trade-offs

- [assembleWriterSnapshot 比 assembleSnapshot 慢（多一次 DB 查询和 FTS）] → SQLite 本地查询延迟极低（<10ms），session 启动只调用一次，影响可忽略
- [writer 忘了调用 assemble_context_snapshot] → injectSystemContext 已升级为完整版作为底线，writer 即使不调用工具也有召回上下文
- [会话级注入的召回可能与后续章纲不匹配] → writer 主动调用 assemble_context_snapshot 时按本章章纲重新召回，获得更精准的结果
