# Design

## D1 现状诊断：显示/提交两条链的断裂点

推理档位的显示与提交目前走两套互不同源的目录：

```
显示链（UI 弹层/芯片）
  /provider/list → v1 Provider service（opennovel/src/provider/provider.ts）
    自定义提供商模型解析：provider.ts:1436-1517
      → ProviderTransform.variants（transform.ts:694+）
        ├─ 按名排除表 transform.ts:740-752：
        │   glm(非5.2)/deepseek/kimi/qwen/minimax… 直接返回 {}   ← GLM 开关无效的根因
        └─ 未排除 → switch(npm) 默认 low/medium/high（{reasoningEffort}）

提交链（V2 会话运行时）
  catalog.model.available() → core Catalog（ModelV2.Info）
    自定义提供商来源：v1 配置文件 → isV1 → migrate.ts migrateModel
      → reasoning/interleaved/temperature/attachment 被静默丢弃（不映射）
      → 仅显式 variants 记录映射到 v2
    withVariant（core/src/session/runner/model.ts:108）：所选档位不在
      model.variants 里 → VariantUnavailableError
```

由此产生两种用户可见的断裂：

1. **GLM 系自定义模型**：`reasoning: true` 被 v1 按名排除表吞掉 → 弹层永远无档位 → "开关点了没用"。
2. **非 GLM 自定义模型**：显示链有三档可选，但提交链 catalog 无这些档位 → 选中即报错 `Variant unavailable`（或回落默认档），显示与提交不同源，违反 `session-composer-controls` 的"显示值与提交值来自同一份解析结果"。

目录内置模型（models.dev）在元数据齐全时两边同由 `reasoning_options` 驱动，无此断裂（v1 的 `reasoningVariants` 优先于按名表）。元数据缺失且 v1 按名表另有规则的残余分歧见 D6 非目标。

## D2 显示链修复：排除表让位于用户显式声明

**决策**：`ProviderTransform.variants` 的按名排除分支（transform.ts:740-752）增加前置条件 `!model.capabilities.reasoning`——模型声明了推理能力（用户开关开启）即跳过排除表，落入 switch 的 `@ai-sdk/openai-compatible` 通用分支，生成 low/medium/high（`WIDELY_SUPPORTED_EFFORTS`）。排除表仅在未声明推理能力时维持既有行为。

**理由**：排除表的存在意义是"别让不支持推理参数的端点误收参数"；用户显式开启开关即自担此责，排除表不应再覆盖用户意图。显式 `config.variants` 合并逻辑（provider.ts:1512 `mergeDeep(variants, model.variants)`）不变，用户手写 variants 仍最高优先。

**注意**：本函数首行 `if (!model.capabilities.reasoning) return {}` 已保证"开关未开 → 无档位"，排除表条件收窄不影响该缺省安全语义。

**与 spec 的张力记录**：`model-reasoning-variants` 要求"不得在代码中按模型名硬编码推理档位规则"。本次不是新增按名规则，而是收窄既有 v1 遗留表的适用条件；v1 Provider service 整体退役、UI 改读 core Catalog 才是彻底归宿（非目标，见 D6）。同规格需求 1 中"推理控件保持禁用占位"的旧表述与常驻分段冲突，本次一并在 delta 中把呈现形态管辖权交给 session-composer-controls（生成规则不变）。

## D3 提交链修复：迁移层展开 reasoning 开关

**决策**：在 `core/src/config/v1/migrate.ts` 的 `migrateModel` 中，`info.reasoning === true` 且模型未显式声明 `variants` 且包名为 `@ai-sdk/openai-compatible` 时，合成三档 variants 写入 v2 配置：

```
low    → body: { reasoning_effort: "low" }
medium → body: { reasoning_effort: "medium" }
high   → body: { reasoning_effort: "high" }
```

**拼写依据**：与 `core/src/plugin/reasoning-variant.ts` 的 `openaiCompatibleChat` 条目一致（注释已背书 GLM/DeepSeek 收 `reasoning_effort`，HTTP body overlay 原样直发）。V2 `withVariant` 将 body 合并进 `request.body` 直发端点，不经过 SDK 语义键。

**落点选择的理由**：v1 配置文件是自定义提供商的唯一持久化源（表单整体覆盖写 v1 形状，prefill 亦从 v1 形状回读），每次启动迁移派生 v2——在迁移层展开可保证"编辑保存 → 档位更新"回环自洽（保存仍只写 `reasoning: true`，不引入 v2 专属字段）。显式 `variants` 存在时不展开（用户声明优先）；展开时过滤与显式声明同 id 的档位。

**包名 gate**：仅 `@ai-sdk/openai-compatible`。自定义提供商表单恒定写该 npm（`dialog-custom-provider-form.ts:4`）；其他包名拼写不可知，缺省安全不展开。

## D4 弹层常驻 default 分段

**决策**：四处模型选择弹层（`dialog-select-model.tsx` 的 V1/V2、`dialog-select-model-unpaid.tsx`、`-unpaid-v2.tsx`）的档位分段去掉 `variantOptions().length > 1` 门控，常驻渲染：

- 有档位：`default` 首项 + 各级别（现状不变）。
- 无档位：仅 `default` 一项，样式弱化为 muted 普通文本（复用现有弱提示样式），并在分段标签旁追加弱提示文案（i18n 三语：「该模型未提供推理档位」/「該模型未提供推理檔位」/「No reasoning levels for this model"」）。

**理由**：用户明确要"没有配置多推理就显示 default"；同时消除"模型无档位"与"功能不存在"的发现性混淆。muted 单项不禁用——禁用在单选语境下无操作意义且暗示可切换。

**联动**：芯片后缀逻辑不变（无档位 → 无后缀）。`model.variant.cycle` 快捷键对无档位模型为空操作（list 为空，现状如此）。

## D5 一致性验证矩阵（验收口径）

| 场景 | 显示链（弹层） | 提交链（catalog variants） | 预期 |
|---|---|---|---|
| GLM 自定义模型 + reasoning 开 | low/medium/high（D2） | low/medium/high（D3） | 选中 high → 请求带 `reasoning_effort: "high"` |
| GLM 自定义模型 + reasoning 关 | 无（排除表+首行守卫） | 无（不展开） | 仅 default |
| 非 GLM 自定义模型 + reasoning 开 | low/medium/high（现状已有） | low/medium/high（D3 补齐） | 修复 VariantUnavailableError |
| 任意自定义模型 + 显式 variants | 显式档位 | 显式档位（优先于展开） | 不变 |
| 目录 glm-5.3-flash（无元数据） | 仅 default 单项（D4） | 无 | 请求不注入推理参数 |
| 目录 Thinking Model（有元数据） | default + 声明档位 | 声明档位 | 不变 |

## D6 非目标确认

- 不处理 `interleaved`/`temperature`/`attachment` 开关在 V2 运行时无消费的问题（与 `reasoning` 同期引入的死开关，需单独立案决定接线或下线）。
- 不做 kimi 式档位描述文案、"Recommended" 徽标、解释 tooltip。
- 不改变 models.dev 目录模型的生成逻辑（含 glm-5.3-flash——其档位仍依赖目录元数据或用户显式 variants 补丁）。
- 不合并 v1 Provider service 与 core Catalog 双目录；目录模型在"无元数据但 v1 按名表有规则"的残余分歧场景（如 grok/kimi 经非三协议包）维持现状，待 v1 退役自然消解。
- 无 HttpApi/Protocol 契约变更，SDK 无需再生成。

## D7 测试与验证

- core：`migrate.ts` 既有迁移测试补 reasoning 展开用例（开/关/显式 variants 优先/非 openai-compatible 包不展开）。
- opennovel：`ProviderTransform.variants` 排除表条件用例（capabilities.reasoning=true 的 glm/deepseek/kimi 模型生成三档；false 维持 {}）。
- app：四处弹层分段常驻渲染断言（组件级或 e2e）；i18n 新增弱提示键三语齐全。
- e2e：扩展 `prompt-thinking-level.spec.ts`——mock 一个无 variants 声明的模型，断言弹层分段常驻且仅含 default 单项；既有 Thinking Model 用例回归不变。GLM 双链修复（D2/D3）由 core/opennovel 单测自证——e2e 的 mock-server 绕过真实服务端，覆盖不到 transform.ts 与迁移层。
- 验收：core/opennovel/app 三包 `bun typecheck`、相关包单测、oxlint 无新增告警、e2e 相关用例通过。
