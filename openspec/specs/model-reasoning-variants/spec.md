# model-reasoning-variants Specification

## Purpose
TBD - created by archiving change reasoning-variant-port. Update Purpose after archive.

## Requirements

### Requirement: 推理档位由模型元数据驱动生成

fork 已接入的 provider（含用户自定义的 OpenAI 兼容端点）的模型，其推理档位 SHALL 由 models.dev 模型元数据的 `reasoning`/`reasoning_options` 声明解析生成：模型声明推理能力且取值白名单时，推理控件可选档位为声明白名单去掉 default 后的值；模型声明仅支持开关（toggle）时，推理控件呈现开/关两档；模型未声明推理能力时不得生成任何推理档位，推理控件保持禁用占位。不得在代码中按模型名硬编码推理档位规则。

#### Scenario: 自定义 OpenAI 兼容端点的推理模型

- **WHEN** 用户通过自定义入口添加 OpenAI 兼容 provider，其模型在 models.dev 元数据中声明了 `{type: "effort", values: ["low", "high", "max"]}`
- **THEN** 会话输入控件的推理档位选择器呈现 low/high/max 三档，无需用户任何手动配置

#### Scenario: 未声明推理能力的模型

- **WHEN** 模型的元数据没有 reasoning 声明（或 `reasoning: false`）
- **THEN** 推理控件呈现禁用占位，且不向该模型的请求注入任何推理参数

#### Scenario: 取值白名单随模型声明

- **WHEN** 不同模型的元数据声明了不同的 effort 取值集（如一个模型收 `["low","high","max"]`，另一个收 `["low","medium","high"]`）
- **THEN** 各自模型的可选档位与声明一致，跨模型不混用

### Requirement: 推理档位按 provider 协议方言翻译

生成的推理档位 SHALL 按 provider 的 aisdk 包名翻译为对应端点接受的请求参数形态：SDK 语义键（reasoningEffort、thinking、enableThinking 等）经 fork 的 providerOptions 通道注入；HTTP 语义键（chat_template_kwargs 等）进入请求 body；fork 协议层已类型化建模的参数（如 anthropic-messages 的 thinking）优先走协议 schema 字段。无对应协议条目的 provider 包名 SHALL 不生成推理档位（缺省安全，不发未经验证的参数）。

#### Scenario: 参数形态随端点而异

- **WHEN** 同一模型元数据声明经不同 provider 接入（如 GLM 经 zai 官方包与经 OpenAI 兼容端点）
- **THEN** 各自按自己的协议条目拼写参数（SDK 键或 body 键），请求实际发出的参数形态与端点约定一致

#### Scenario: 未知 provider 包不缺省发参

- **WHEN** 模型的 aisdk 包名在协议表中没有条目
- **THEN** 即使元数据声明了推理能力，也不生成推理档位、不注入推理参数

### Requirement: GLM 硬编码规则被通用机制取代

fork 内不得保留按模型名硬编码推理档位的插件；GLM-5.2 系列模型的推理档位 SHALL 由移植的通用解析机制经 zai/openai-compatible 协议条目生成，且档位集合覆盖原硬编码规则提供的档位语义（high/max 档位及思考开关）。

#### Scenario: GLM 模型档位来源替换

- **WHEN** 注册表落地 GLM-5.2 系列模型
- **THEN** 其推理档位来自协议表生成而非硬编码名单，档位语义与原规则对齐（effort 档位 + thinking 开关，具体取值以元数据声明为准）

#### Scenario: 硬编码插件移除

- **WHEN** 全库检索推理档位生成逻辑
- **THEN** 不存在以模型名列表匹配生成推理档位的代码，唯一来源为元数据解析 + 协议表翻译
