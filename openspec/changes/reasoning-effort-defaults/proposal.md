# Proposal: reasoning-effort-defaults

## Why

推理档位在自定义提供商场景下处于"显示与提交两条链各自为政"的断裂状态：用户在提供商表单里开启"推理能力"开关后，GLM 系模型因显示链（v1 ProviderTransform）的按名排除表永远看不到档位；非 GLM 模型即使弹层出现了档位，V2 会话运行时又因 v1→v2 配置迁移丢弃 `reasoning` 标记而拒绝所选档位（VariantUnavailableError）。同时，模型弹层对未声明推理档位的模型完全隐藏"思考档位"分段，用户无法区分"该模型无档位"与"功能不存在"。custom-provider-manage 规格已承诺"开启推理能力→呈现推理档位"，实现与规格存在明确缺口，需要闭合。

## What Changes

- 模型选择弹层（付费/免费 × V1/V2 共四处）的"思考档位"分段**常驻**：模型有档位时呈现 default + 各级别；未声明档位的模型呈现仅含 default 一项的分段（弱化为普通文本样式），不再整段隐藏。修订 `session-composer-controls` 规格的"推理档位控件显隐由模型数据属性决定"需求。
- 自定义提供商（OpenAI 兼容端点）的**推理能力开关接线到双链**：
  - 显示链：`ProviderTransform.variants` 的按名排除表（glm/deepseek/kimi/qwen/minimax 等）仅在模型未声明推理能力时生效；用户显式开启 `reasoning` 的模型跳过排除表，按 `@ai-sdk/openai-compatible` 通用条目生成 low/medium/high 三档。
  - 提交链：v1→v2 配置迁移（`migrateModel`）将 `reasoning: true` 展开为显式 variants（low/medium/high，body 拼 `reasoning_effort`，与 core 协议表 openai-compatible 条目拼写一致），使 V2 会话运行时 `withVariant` 能解析所选档位并注入请求。
  - 优先级：模型显式声明的 `variants` 配置高于开关展开；开关未开不生成任何档位（缺省安全）。
- **非目标**：
  - 不处理 kimi 式档位描述文案、"Recommended" 徽标、解释 tooltip（UI 对标缓议）。
  - 不处理 `interleaved`/`temperature`/`attachment` 三个在 V2 运行时同样无消费的开关（另行立案）。
  - 不改变 models.dev 目录内置模型的档位生成（glm-5.3-flash 等仍需显式配置补丁）。
  - 不合并 v1 Provider service 与 core Catalog 双目录架构（长期方向留档）。
  - 无 HttpApi/Protocol 契约变更，不需要重新生成 SDK。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `session-composer-controls`：推理档位分段从"按模型数据属性条件显隐"改为"常驻呈现、内容随模型档位数据伸缩"；未声明档位模型的场景改写为"分段仅含 default 一项"。
- `custom-provider-manage`：模型细节参数之"推理能力开关"补充双链生效语义——开启后模型弹层呈现 low/medium/high 三档且所选档位在 V2 会话请求中按 openai-compatible 协议以 `reasoning_effort` 生效（规格现有场景已承诺，本次为缺口修复）。
- `model-reasoning-variants`：新增"用户显式推理声明生成档位"需求——无 models.dev 元数据的自定义 OpenAI 兼容端点，以提供商配置中的 `reasoning: true` 作为推理能力声明生成三档；显式 `variants` 声明优先于开关展开。

## Impact

- **packages/opennovel**：`src/provider/transform.ts` 排除表条件收窄（仅未声明推理能力时排除）。
- **packages/core**：`src/config/v1/migrate.ts` 的 `migrateModel` 增加 `reasoning: true` → variants 展开。
- **packages/app**：`dialog-select-model.tsx`（V1/V2）、`dialog-select-model-unpaid.tsx`/`unpaid-v2.tsx` 四处弹层分段常驻；扩展 `e2e/regression/prompt-thinking-level.spec.ts` 覆盖常驻 default 空态。
- **数据兼容性**：v1 配置文件键集合不变（仍是 `reasoning: true`），既有已开启该开关的自定义模型在迁移后自动获得三档（行为补全，非破坏变更）；弹层新增 default 单项为纯 UI 呈现变化。
