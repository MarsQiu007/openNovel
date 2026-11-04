# custom-provider-manage Delta

## MODIFIED Requirements

### Requirement: 自定义提供商的模型可配置细节参数

创建或编辑自定义提供商时，系统 SHALL 允许为每个模型配置以下细节参数并随提供商记录持久化：上下文长度（`limit.context`）、可选输入上限（`limit.input`）、输出上限（`limit.output`）、推理能力开关（`reasoning`）、逐段推理（`interleaved`）、采样开关（`temperature`）、工具调用开关（`tool_call`）、附件开关（`attachment`）、输入/输出成本（`cost.input`/`cost.output`）、模型状态（`status`）、模型家族（`family`）。留空的可选参数 SHALL NOT 写入配置（回落运行时缺省）。

推理能力开关（`reasoning`）开启时，该模型 SHALL 在模型选择弹层呈现 low/medium/high 三档推理档位（与显示链路同源），且所选档位 SHALL 在会话请求中按 OpenAI 兼容协议以 `reasoning_effort` 参数实际生效；开关未开启时该模型 SHALL NOT 呈现推理档位。模型显式声明的 `variants` 配置优先于开关生成的档位。

#### Scenario: 设置上下文长度与推理能力后生效

- **WHEN** 用户为自定义提供商的某模型填入上下文长度 131072、开启推理能力并保存，随后在该模型发起会话并选择推理档位
- **THEN** 会话运行时使用该上下文长度进行窗口管理，该模型呈现推理档位选择（由推理能力驱动）；即使模型名命中显示链的按名排除表（如 GLM 系），开关开启仍呈现 low/medium/high 三档

#### Scenario: 推理档位在会话请求中生效

- **WHEN** 用户对一个开启推理能力的自定义模型选择 high 档并发起会话
- **THEN** 会话请求携带 `reasoning_effort: "high"` 参数，模型芯片显示档位后缀，显示值与提交值一致

#### Scenario: 显式 variants 声明优先于推理开关

- **WHEN** 用户为自定义模型同时配置显式 `variants`（如仅 high 一档）并开启推理能力
- **THEN** 弹层呈现 default 与显式声明的档位集合（显式声明优先），档位展开不追加与显式声明冲突的档位

#### Scenario: 留空细节参数回落缺省

- **WHEN** 用户新建自定义提供商，模型行未展开或未填写任何细节参数
- **THEN** 保存的配置不含这些键，运行时按既有缺省行为处理（与今天的创建路径一致）

#### Scenario: 编辑时细节参数回显

- **WHEN** 用户打开一个模型细节参数已持久化的自定义提供商进行编辑
- **THEN** 表单回显已存的上下文长度、推理开关等值，修改保存后再次打开为新值
