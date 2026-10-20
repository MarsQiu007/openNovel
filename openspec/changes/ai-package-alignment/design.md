# Design: ai-package-alignment

## 方案概述

一次纯调研，产出一份决策报告。设计要点是**调研方法可复核**：每个结论都锚定到具体文件与提交 SHA，避免"看起来差不多"式的结构对比。

## 调研方案

### 问题 1：职责重叠度

| 调查对象（fork 侧） | 调查对象（上游侧） | 要回答的问题 |
| --- | --- | --- |
| `packages/core/src/aisdk.ts` | `packages/ai/src/protocols/*` | provider 协议适配（openai-chat 等）在哪边、分叉多深 |
| `packages/core/src/models-dev.ts`、`plugin/models-dev.ts` | `packages/ai/src/providers/*`、`packages/schema/src/model-compatibility.ts` | 模型目录数据与兼容性 schema 的归属与消费路径 |
| `packages/core/src/provider.ts`、`model.ts` | `packages/ai/src/providers/*` | provider 注册与选择的实现差异 |
| `packages/core/src/session/*` 调用路径 | `packages/ai` 的流式接口 | 调用栈耦合度：fork 的 session 层如何消费 LLM 流 |

方法：对每对文件记录行数、导出面、上游近期提交密度（`git log --oneline --since=2026-10-01 --count`），量化"上游多活跃 / fork 多内嵌"。

### 问题 2：依赖面

- 读上游 `packages/ai/package.json`：运行时依赖清单、workspace 依赖（是否依赖 fork 不想要或没有的包）
- 对照 fork 的依赖方向规则（Schema → Core/Protocol → Server，Client 不依赖 Core/Server）判定引入后 `packages/ai` 的正确挂载位置
- 检查上游 `packages/ai` 的构建/生成流程（有无 protocol 生成、代码生成步骤）与 fork 工具链（Bun 1.3 + turbo）的兼容性

### 问题 3：成本收益结论

- 三选项各自的估算包含：迁移工作量（按问题 1 的重叠度推算）、迁移后每年移植维护成本变化（上游 AI 层 12 天 48 提交的活跃度作参照）、回归风险（写作流水线对 LLM 流行为的依赖）
- 结论格式：明确选定一项 + 两项落选项的否决理由各一段

## 报告落点

- 结论主体写回本 change 的 design.md（追加"调研结论"节）；若报告篇幅超过设计文档合理范围，转为独立 `docs/adr/` 决策记录，design.md 留结论摘要与链接
- `docs/agents/upstream-sync.md` 的季度审阅节补一行指针（处置依据）

## 已知输入（探索阶段核实的事实）

- 上游 49f52ff2d5（streamUsage）改动 `packages/ai/src/protocols/openai-chat.ts`、`packages/schema/src/model-compatibility.ts` 等，fork 无对应文件
- fork `packages/core/src` 中 LLM 相关：`aisdk.ts`、`models-dev.ts`、`provider.ts`、`model.ts`、`plugin/models-dev.ts`
- 上游 `packages/ai` 12 天 48 提交（2026-10-08 → 10-20），fork core 侧无对应活跃度记录

## 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 调研结论"引入"但实际迁移成本远超估算 | 本 change 不实施迁移；迁移属后续 change，届时重新细化并独立评估 |
| 上游 AI 包结构仍在快速演进（48 提交/12 天），调研快照很快过期 | 报告标注采集基线 SHA；结论以"方向判断"为主（内嵌 vs 引入），不锁具体版本 |
| 调研范围蔓延到写作流水线选型 | 严格限定在代码结构层，流水线行为问题一律记录为"超出范围" |

## 验证方式

- 报告中每个结构性结论可复核（文件路径 + SHA 均真实存在于两侧仓库）
- 结论三选一且含工作量估算与风险段
- 从仓库根运行 `openspec validate ai-package-alignment --strict` 通过

## 调研结论（2026-10-20，基线 9d90d892dc）

### 关键事实修正

探索阶段的两个前提**不成立**，调研中已核实推翻：

1. ~~"fork 无独立 AI 包，协议栈内嵌 core（aisdk.ts 等）"~~ → fork 有独立 LLM 协议包 `packages/llm`（`@opennovel-ai/llm`，56 文件 / 约 352KB），与上游 `packages/ai`（`@opencode/ai`，218 文件）**架构同构**。`packages/core/src/aisdk.ts` 只是 218 行的 AI SDK v3 兼容适配层，不是协议栈本体。
2. ~~"上游新增 packages/llm"~~ → 上游 9d90d892dc 的 packages/ 目录**没有** `packages/llm`；`packages/llm` 是 fork 自有包名。`docs/agents/upstream-sync.md` 结构清单中这两处表述已随本结论修正。

### LLM 栈映射表

| fork | 上游 9d90d892dc | 对应关系 |
| --- | --- | --- |
| `packages/llm/src/llm.ts` | `packages/ai/src/llm.ts` | 门面同构（diff 186/196 行，中等分叉） |
| `packages/llm/src/protocols/openai-chat.ts` | `packages/ai/src/protocols/openai-chat.ts` | 同名协议（fork 463 行 vs 上游 1216 行，上游近期大幅扩展） |
| `packages/llm/src/protocols/{anthropic-messages,bedrock-converse,bedrock-event-stream,gemini,openai-compatible-chat,openai-responses}.ts` | `packages/ai/src/protocols/` 同名文件 | 7 个共享协议 + 40+ 上游独有（alibaba/cohere/mistral/xai/zai/meta/语音/图像/视频系） |
| `packages/llm/src/providers/`（12 个 profile） | `packages/ai/src/providers*` | provider profile 同构 |
| `packages/llm/src/route/`（client/auth/transport http+websocket） | `packages/ai/src/route*` | 传输层同构 |
| `packages/llm/src/schema/` | `packages/ai/src/schema/` | 请求/事件/错误 schema 同构 |
| `packages/core/src/model.ts`、`provider.ts`（17/30 行薄重导出） | `packages/core` 对应消费层 | 真正类型在 `packages/schema`（Model/Provider），两侧同构 |
| `packages/core/src/aisdk.ts`（218 行，`LanguageModelV3` 适配） | 无直接对应 | fork 特有的 AI SDK 兼容层；上游以 `packages/ai` 原生接口替代 |
| `packages/core/src/models-dev.ts`、`plugin/models-dev.ts` | `packages/core` 侧模型目录 | 已由 upstream-port-first-batch 调研定案（fork 构建期拉取，无内嵌快照） |

依赖面：`@opennovel-ai/llm` 依赖 `@opennovel-ai/schema` + `@opennovel-ai/http-recorder`（workspace），与上游 `@opencode/ai` 依赖 `@opencode/schema` + `@opencode/http-recorder` **完全同构**——依赖方向规则（Schema → Core/Protocol → Server）不构成引入障碍，但这不是引入的理由。

上游活跃度：2026-10-08 → 10-20 的 12 天内 `packages/ai` 48 提交（streamUsage、OpenAI/Azure store、Responses null 宽容、Gemini 重试、Bedrock cache 等），大部分为协议细节修复，落点对应 fork `packages/llm/src/protocols/` 同名文件。

### 三选一结论：维持现状（保留 `packages/llm`，不引入上游 `packages/ai`）

**落选项（C）**：fork 已有架构同构的独立 LLM 协议包，"缺独立 AI 包"的前提不成立；上游 AI 层修复按 playbook 决策树评估，落点为 `packages/llm` 对应文件。已在 `docs/agents/upstream-sync.md` 季度审阅节补记处置依据。

**否决 A（引入并迁移）**：上游 `packages/ai` 的 218 文件中，语音（speech/transcription）、图像/视频生成（image/video/media）、open-responses 系、40+ 厂商协议与 novel 写作场景无关，引入即长期死代码；协议内容已深度分叉（openai-chat 1216 vs 463 行），追平违反"不追平"原则。估算工作量 2-4 周当量（引入 + core/session 消费方迁移 + 兼容层去重），外加持续维护上游无关大类的负担。

**否决 B（重命名 llm → ai 对齐）**：收益仅是路径前缀对照直观；fork 与上游无共同 git 历史，rename 不带来任何跨仓库追踪能力，playbook 检索靠关键词不靠路径。成本为 55+ 文件 rename + 约 30 个消费方文件的 import 改动（1-2 天当量）加一次大噪音提交，纯支出无回报。

### 后续动作（不在本 change 内）

- 上游 49f52ff2d5（streamUsage 兼容，关闭 `stream_options`）在 fork 有直接落点（`packages/llm/src/protocols/openai-chat.ts` 的 `stream_options` schema 与请求组装），列为季度审阅移植候选首位。
- 其余上游 AI 层修复按 playbook 决策树逐个评估，不再以"fork 无 packages/ai"为由预先排除。
