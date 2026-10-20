# Proposal: ai-package-alignment

## Why

上游 openCode 在 2026-10 把 AI 协议层独立成 `packages/ai` 包（12 天 48 个提交，含 provider 修复、`streamUsage` 兼容、OpenAI/Azure store 修复），并新增 `packages/llm`；而 fork 的 LLM 调用栈仍内嵌在 `packages/core`（`aisdk.ts`、`models-dev.ts`）。这一结构分叉是 fork 与上游之间**所有 AI 层移植的总闸门**：不回答"要不要引入 packages/ai"，`streamUsage` 等一批上游修复就永远只能搁置。本变更用一次纯调研给出结论与成本，避免未来每个 AI 层候选都重复一遍"能不能搬"的讨论。

## What Changes

- 新增一份调研报告（落点为本 change 的 design.md 或独立 `docs/` 文档，调研后定），回答三个问题：
  1. **职责重叠度**：fork 的 `core/src/aisdk.ts` + 相关模型文件与上游 `packages/ai` 的职责映射（协议层、provider 适配、schema 选项分别在哪边实现）
  2. **依赖面**：引入 `packages/ai` 会拖入哪些上游关联（console/enterprise/schema 依赖链、协议生成流程），与 fork 的依赖方向规则（Schema → Core/Protocol → Server）是否冲突
  3. **成本收益结论**：三选一——(a) 引入 `packages/ai` 并迁移调用栈；(b) 保持内嵌但建立 AI 层补丁清单（定期选择性移植上游修复）；(c) 维持现状不动。结论必须含工作量估算与风险
- 在 `docs/agents/upstream-sync.md` 的季度审阅节补充一条：AI 层候选的处置以上述结论为准
- **不改任何代码**——本变更是 spike / 调研型 change

## Capabilities

### New Capabilities

（无——纯调研，产出为文档与结论，无系统行为）

### Modified Capabilities

（无）

> 纯调研变更，`skip_specs: true`。

## Impact

- **受影响的运行时包：无**。产出为调研报告与 1 处文档补充。
- **远期影响面（仅当结论为引入）**：`packages/core`（LLM 调用栈迁移）、依赖图调整——这些属于结论后续的独立 change，本变更不实施
- **数据兼容性**：不涉及
- **依赖关系**：依赖 `upstream-sync-baseline`（结构事实）；与 `upstream-port-first-batch` 无阻塞关系，可并行
- **调研输入**：本地镜像 `D:\AI\Codes\opencode` 的 `packages/ai`（含 49f52ff2d5 streamUsage 提交）、fork `packages/core/src` LLM 相关文件

## 非目标

- 本变更**不引入**、不迁移、不修改任何包结构或代码
- 本变更**不决定**写作流水线的模型选型或 provider 配置——只回答"代码结构层面对齐方式"
- 本变更**不实施**任何上游 AI 层修复的移植（即使结论是"保持内嵌"，具体修复仍走 `upstream-port-*` 流程）
