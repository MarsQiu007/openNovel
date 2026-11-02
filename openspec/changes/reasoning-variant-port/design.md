# Design

## Context

移植决策树判定：fork 有需求（自定义 provider 无法调节推理档位）→ 上游已有完整实现（`variant.ts` 解析器 + models.dev reasoning 消费）→ 改动落在 fork **已演化的文件**（models-dev 适配、ModelV2 schema 与上游 Model.Info 有结构差距）→ **适配后移植**，本文档写明全部适配点。上游基线 2026-10-20（`UPSTREAM-BASELINE.md`），本地镜像 `D:\AI\Codes\opencode`。

上游架构（移植源）：

```
models.dev API: reasoning + reasoning_options[]
                      │  {type:toggle} {type:effort,values[]} {type:budget_tokens,min,max}
                      ▼
上游 core/src/variant.ts
  supports(Reasoning) → Support[]（标准能力，effort 带模型自声明取值白名单）
  resolve(model, supports) → Variants[]
                      │  按 model.package 查 PROTOCOLS（60+ 条目）
                      ▼
  Variant = { id, settings?, headers?, body? }   ← settings = ai-sdk providerOptions
                      ▼
上游 packages/ai 协议栈把 settings 注入对应 provider 的 SDK 调用
```

fork 现状（适配目标）：`ModelV2.Info.variants` 只有 `{id, headers, body}`（`schema/src/model.ts:91-94`），无 settings 层；消费链 `session/runner/model.ts` 的 `withVariant` 合并 headers/body；`packages/llm` 有 `providerOptions` 通道（`llm.ts:34,42`）但目前无人从 variants 注入；models-dev 适配（`core/src/plugin/models-dev.ts:105`）显式 `draft.variants = []` 清空。

## Goals / Non-Goals

**Goals**：内置 provider 与自定义 OpenAI 兼容端点的模型按元数据自动获得推理档位；GLM 硬编码被通用机制取代；方言表覆盖 fork 已接入的全部 provider 包名。

**Non-Goals**（见 proposal 非目标）：config 显式 reasoning、UI 手动编辑、上游 packages/ai 协议栈、上游自有 provider 包名。

## Decisions

### D1: 移植产物落点为 core 内新模块 `core/src/reasoning-variant/`，不复活上游文件路径

上游文件是 `packages/core/src/variant.ts` + `packages/core/src/modal/models.ts` 的解析段。fork 按仓库惯例（`src/config` 的 self-export 模式、插件目录惯例）新建 `core/src/plugin/reasoning-variant.ts`（与现有 `plugin/variant.ts` 同级的单文件插件形态），删除旧 `plugin/variant.ts` 时原位替换。

- **理由**：fork 的 GLM 硬编码本就占用 `plugin/variant.ts` 位置，替换后文件职责单一；上游的 modal/models.ts 解析段并入 fork 的 models-dev 适配调用点。
- **替代方案**：照搬上游路径 `core/src/variant.ts`——与 fork 插件组织惯例不符，放弃。

### D2: 协议表只保留 fork 实际存在的包名，映射关系逐条核对

上游 PROTOCOLS 表的 key 分三类：
1. `@ai-sdk/*` 与 aisdk 包名（fork 同样使用，`anthropic.ts`/`openai-compatible.ts` 插件以相同包名匹配）——**直接保留**；
2. 上游自有 `@opencode/ai/providers/*`——fork 无对应包，**跳过并在表内注释标注**；
3. 条件分支引用上游特定模型/端点行为的条目（如 `Provider.aisdk("gitlab-ai-provider")`）——fork 若未接入该 provider 则跳过。

- **理由**：fork 的 provider 接入集合（`core/src/plugin/provider/` 目录）与上游不同，搬全表会引入死条目（防冗余规则）。
- **核对清单（tasks）**：对 fork provider 目录逐个确认包名在表中的条目存在。

### D3: settings overlay 映射进 fork 的 providerOptions + body 双通道

上游 variant 的 `settings`（如 `reasoningEffort`、`thinking`）是 ai-sdk providerOptions。fork 的消费链分两步：`withVariant`（合并 headers/body）→ `withDefaults`（组装 route）。适配：

- 方言表中纯 SDK 语义键（`reasoningEffort`、`thinking`、`enableThinking`、`reasoningBudget` 等）→ 翻译为 fork 的 **providerOptions 注入**：`session/runner/model.ts` 的 `withVariant` 扩展为同时输出 providerOptions，`packages/llm` 的 LLMRequest 已支持该字段（`llm.ts:42`），只需接通组装点。
- 方言表中本来就是 HTTP 语义的键（`body.chat_template_kwargs`、`body.thinking`、`additionalModelRequestFields` 等）→ 维持原样进 `body` overlay。
- 个别键在 fork llm 协议层已建模的（anthropic-messages 的 `thinking`，`llm/src/protocols/anthropic-messages.ts:168`）→ 优先走协议 schema 字段而非裸 body。

- **实现期补充（载体键）**：fork 的 `ModelV2.Info.variants` schema 只有 headers/body，settings 负载无处存放。实现采用载体内键 `opennovel/providerOptions`：方言表把 SDK 语义键存进 `variant.body[carrier]`，`withVariant` 拆包时经 `Schema.decodeUnknownOption(ProviderOptions)` 解码（形状非法按缺省安全丢弃）注入 route defaults，载体内键不残留进 HTTP body overlay。
- **实现期补充（能力核实结论）**：fork 协议层实际可消费的 providerOptions 面比上游窄——openai-responses 收 `{reasoningEffort, reasoningSummary, include}`（reasoningEffort 不含 `max`）；anthropic-messages 只建模 `thinking={type:"enabled",budgetTokens}`（adaptive/effort/关闭形态无类型化通道）。方言表按此收敛：openai 条目生成时滤除 `max`，anthropic 条目仅响应 `budget_tokens` support，不可表达的形态一律不生成（缺省安全）。

- **理由**：双通道映射最大化复用 fork llm 的既有类型化协议；裸 body 仅用于协议层未建模的参数。
- **替代方案**：全部 settings 平铺进 body——anthropic 的 `thinking` 等参数在 fork 的 anthropic-messages 协议已有类型化字段，裸 body 会绕开 schema 校验，放弃。

### D4: models.dev 元数据在 models-dev 适配层解析，不进 ModelV2 schema

`reasoning_options` 的解析（上游 modal/models.ts 的 `variants(remote)` 逻辑）放在 fork `core/src/plugin/models-dev.ts` 的模型填充处：读元数据 → `supports()` → `resolve()` → 写入 `draft.variants`。`ModelV2.Info` 与 `Capabilities` schema 零改动。

- **理由**：schema 变更级联 Protocol/Client/SDK 再生成（记忆：协议变更双再生），本期收益不抵成本；元数据在模型注册时已是 core 可见输入。
- **替代方案**：按上游把 Reasoning 挂进 `capabilities`——留待 config 覆盖提案一并做，避免两次级联。

### D5: GLM 硬编码删除，以移植表回归对拍

删除 `core/src/plugin/variant.ts` 的 VariantPlugin 注册与文件。回归判定：models.dev 元数据中 zhipuai/glm-5.2 系列带 `reasoning_options`，移植后其 variants 由协议表（openai-compatible 条目）生成；对拍验证生成的 variants 至少覆盖原硬编码的 high/max 两档（档位定义以上游为准，原硬编码的 `body.reasoning_effort` 拼写由 openai-compatible 协议条目的 body overlay 原样保留）。

- **实现期补充（nativePackage 回落）**：真实 models.dev 数据（如 zhipuai 的 GLM）只在 provider 级声明 npm/api，模型级无 `provider` 字段；fork 旧 applyModel 只读模型级 npm，导致这类模型一律落成 `native`——旧 GLM 硬编码因此生产从未生效（用户"推理控制几乎不可见"的根因之一）。实现按上游 `nativePackage(provider, model)` 语义补上 provider 级 npm/api 回落。

## Risks / Trade-offs

- **fork 包名与上游假设不符时方言表条目空转**（如 fork 某 provider 走了不同 aisdk 包）→ D2 核对清单在 tasks 中逐条落地；未接入的包名条目不搬，宁可缺不可错。
- **providerOptions 注入点的运行时验证面**（D3）→ 受影响包补测试：variant 解析单测（纯函数，输入元数据/包名，输出 variants）+ withVariant 合并测试；anthropic/openai-compatible 两条链路的请求组装各加一个断言。
- **models.dev 元数据滞后**（新模型未登记 reasoning）→ 这正是非目标中"UI 手动编辑"的动机，本期接受。
- **`reasoning_effort` 对不支持的端点误发**（调研中发现的风险）→ 移植架构天然规避：无元数据声明的模型不生成任何推理档，控件保持禁用占位（上一 change 的呈现）。

## Migration Plan

顺序：移植解析器与协议表（新文件）→ models-dev 接入 → providerOptions 通道接通（llm/runner 小动）→ 删除 GLM 硬编码 → 对拍回归。每步独立可提交；回滚即恢复 GLM 硬编码插件（删除的提交可单独 revert）。无数据迁移。

## Open Questions

无——config 覆盖与 UI 编辑明确后置；上游 packages/ai 不移植；包名核对清单在 tasks 中闭合。
