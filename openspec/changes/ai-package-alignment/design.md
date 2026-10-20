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
