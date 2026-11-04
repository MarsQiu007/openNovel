# model-reasoning-variants Delta

## MODIFIED Requirements

### Requirement: 推理档位由模型元数据驱动生成

fork 已接入的 provider（含用户自定义的 OpenAI 兼容端点）的模型，其推理档位 SHALL 由 models.dev 模型元数据的 `reasoning`/`reasoning_options` 声明解析生成：模型声明推理能力且取值白名单时，推理控件可选档位为声明白名单去掉 default 后的值；模型声明仅支持开关（toggle）时，可选档位集合为开/关两档；模型未声明推理能力时不得生成任何推理档位。推理控件的呈现形态（分段常驻、空态 default 单项等）由 session-composer-controls 规格管辖，本规格只约束档位生成。不得在代码中按模型名硬编码推理档位规则。

#### Scenario: 自定义 OpenAI 兼容端点的推理模型

- **WHEN** 用户通过自定义入口添加 OpenAI 兼容 provider，其模型在 models.dev 元数据中声明了 `{type: "effort", values: ["low", "high", "max"]}`
- **THEN** 会话输入控件的推理档位选择器呈现 low/high/max 三档，无需用户任何手动配置

#### Scenario: 未声明推理能力的模型

- **WHEN** 模型的元数据没有 reasoning 声明（或 `reasoning: false`）
- **THEN** 不生成任何推理档位且不向该模型的请求注入任何推理参数；模型弹层的推理档位分段仅呈现 default 一项（呈现规则以 session-composer-controls 为准）

#### Scenario: 取值白名单随模型声明

- **WHEN** 不同模型的元数据声明了不同的 effort 取值集（如一个模型收 `["low","high","max"]`，另一个收 `["low","medium","high"]`）
- **THEN** 各自模型的可选档位与声明一致，跨模型不混用

## ADDED Requirements

### Requirement: 用户显式推理声明生成档位

对无 models.dev 元数据的用户自定义 OpenAI 兼容端点，用户在提供商配置中显式声明推理能力（`reasoning: true`）即为该模型的推理能力元数据：系统 SHALL 为其生成 low/medium/high 三档推理档位，并按 `@ai-sdk/openai-compatible` 协议条目拼写为 `reasoning_effort` 请求参数。档位生成 SHALL 同时落于显示链路与会话提交链路，两侧档位集合一致（用户所选档位必须能被提交链路解析）。开关未开启（或未声明）时 SHALL NOT 生成任何档位；模型显式声明的 `variants` 配置优先于开关生成的档位。

#### Scenario: 开启推理能力的自定义模型呈现并提交三档

- **WHEN** 用户为自定义 OpenAI 兼容端点的某模型开启推理能力并保存，打开模型选择弹层选择 high 档后发起会话
- **THEN** 弹层呈现 default 与 low/medium/high 三档，会话请求实际携带 `reasoning_effort: "high"`

#### Scenario: 按名排除表不覆盖用户显式声明

- **WHEN** 用户开启推理能力的自定义模型名命中显示链既有的按名排除表（如 glm/deepseek/kimi/qwen/minimax 系列）
- **THEN** 排除表因用户显式声明推理能力而不再适用，该模型仍呈现 low/medium/high 三档；未开启开关的同名模型维持无档位

#### Scenario: 开关未开不生成档位

- **WHEN** 自定义模型未开启推理能力开关
- **THEN** 显示链路与提交链路均不生成推理档位，模型弹层该模型分段仅含 default，请求不注入推理参数

#### Scenario: 显式 variants 优先于开关展开

- **WHEN** 自定义模型同时存在显式 `variants` 声明与开启的推理能力开关，且两者档位集合不同
- **THEN** 以显式 `variants` 为准，开关展开不追加显式声明之外的档位
