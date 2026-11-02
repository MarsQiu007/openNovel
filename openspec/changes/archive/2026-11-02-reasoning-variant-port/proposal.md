# Proposal

## Why

会话输入控件的推理档位（variants）目前只有一个活来源：VariantPlugin 按模型名硬编码的 GLM-5.2 专属规则（`core/src/plugin/variant.ts`），全库其余模型的 variants 恒为空——所有通过自定义入口创建的 provider（OpenAI 兼容端点）因此永远无法调节推理能力。网络调研确认这不是能力问题而是通路问题：models.dev 模型元数据已把推理能力做成机器可读的 `reasoning`/`reasoning_options` 声明（235 个 provider、6840 个模型），上游 openCode 已有完整的解析翻译引擎（`core/src/variant.ts`，按 provider 包名把标准能力声明翻译为各端点的请求方言，60+ 协议条目），fork 尚未移植这一层。上游方案同时解决了调研发现的另一个事实：`reasoning_effort` 并非跨端点标准（Qwen 用 `enable_thinking`+`thinking_budget`、Kimi 仅收 `max`、DeepSeek/GLM 收 `reasoning_effort`），代码猜参数不可行，唯有"元数据声明 + 按端点翻译"是对的架构。

## What Changes

- 移植上游 `packages/core/src/variant.ts` 的推理变体解析器：`supports()`（models.dev 能力声明 → 标准 Support 列表）+ 按 provider 包名分派的 `PROTOCOLS` 翻译表（只保留 fork 实际存在的包名条目），输出为 fork 的 `ModelV2.Info.variants` 结构（`{id, headers, body}` overlay）。
- 移植 models.dev `reasoning`/`reasoning_options` 的消费：fork 的 models-dev 适配（`core/src/plugin/models-dev.ts`）在填充模型时从元数据解析推理能力，变体随模型注册落地。
- 上游方言表的 `settings` overlay 层（ai-sdk providerOptions）映射进 fork 的 `packages/llm` providerOptions 通道（已存在，`llm.ts` 的 `providerOptions` 字段）；无 providerOptions 对应物的纯 body 参数直接进入 `body` overlay。
- 删除 fork 自有的 GLM-5.2 硬编码 VariantPlugin（`core/src/plugin/variant.ts`），其规则被上游的 zai/openai-compatible 协议条目覆盖。
- 上游来源（移植提交清单，40 位 SHA）：
  - `d889cb20447f3b31d88719786f46a1a75ed2e6fa` feat(core): read model reasoning from config (#55853)
  - `412b2b1d8563b665b5e7fed56cb46f7c333f34d1` fix(core): load and spell reasoning for every native provider package (#55789)
  - `ea666727a14c961f3a4e6ce9d0f5862b3a2bcbf4` fix(core): add thinking toggle variants for Vertex MaaS models (#54040)
  - `5ae8a3c1d3d376d9cded7ef938c1bcd8309ad190` fix(core): resolve reasoning variants for GitLab Duo models (#51082)
  - `6712cc4c2c2be26c5baa2db9af6c530ca950b713` fix(core): turn off Workers AI thinking through the chat template (#52017)
  - `20610e6645e77fff293354bec03d6872ae4bcedb` fix(ai): fit Claude thinking budgets on Bedrock Converse (#51190)
  - `4eb46a8885e462f8ba574c10fb876825dcbe20b7` fix(core): revert always-thinking variants for Claude Opus 5.5 (#51359)
  - `14fc63ba9ec2ce753be2c84c258c913ecb1ad2ef` fix(core): keep thinking on for Claude Opus 5.5 variants (#51338)
  - `498b1deda37a8079a7157383f967df9cef65af29` feat(ai): add native Venice provider (#53271)
  - `3ab5c1433c3500b59f1edcb85ca7389f6c0457bd` fix(core): request xAI reasoning summaries on Responses variants (#51964)

**非目标**：

- 不移植上游 `d889cb2044` 的 config 显式 reasoning 字段（`Config.Model.Reasoning` schema 与用户配置入口）——本期只做 models.dev 元数据驱动；config 覆盖能力如需，后续独立提案（涉及 schema 包变更与 SDK 再生成，级联面大）。
- 不做推理档位的 UI 手动编辑（元数据缺失的自建端点的兜底逃生门）——后续独立提案。
- 不移植上游 `packages/ai` 协议栈本体——fork 的 `packages/llm` 是自有同构层，本提案仅做 overlay 映射，不改动协议栈结构。
- 不追平 models.dev 全部 provider 条目——只保证 fork 已接入的 provider 包名在 PROTOCOLS 表中有对应翻译；上游 `packages/ai` 自有包名（`@opencode/ai/providers/*`）在映射表中标注并跳过。

## Capabilities

### New Capabilities

- `model-reasoning-variants`: 模型推理档位的元数据驱动解析——从 models.dev 能力声明生成标准推理档位（effort 取值白名单/toggle/budget），按 provider 协议方言翻译为请求 overlay，使内置 provider 与自定义 OpenAI 兼容端点的模型在不手动配置的情况下获得可调推理档位。

### Modified Capabilities

（无）

## Impact

- **packages/core**：新增移植的变体解析器；`plugin/models-dev.ts` 增加 reasoning 元数据消费；删除 `plugin/variant.ts`（GLM 硬编码）。
- **packages/llm**：确认 `providerOptions` 通道消费路径，必要时小动（settings overlay 的注入点）。
- **packages/schema**：零改动（推理能力声明不进 `ModelV2.Info` 持久结构，解析在 core 插件层完成）。
- **无协议变更**：不触碰 Protocol / Server HttpApi，无需再生成 client SDK。
- **数据兼容性**：模型 variants 为运行时解析产物，不落盘；`model.v1` 本地存储结构不变。GLM-5.2 模型的既有 variants 在移植后由 zai 协议条目重新生成，档位语义与上游对齐（high/max + thinking toggle）。
- **移植追溯**：实现提交 body 按规则写 `Ported-from: <SHA>` 清单。
