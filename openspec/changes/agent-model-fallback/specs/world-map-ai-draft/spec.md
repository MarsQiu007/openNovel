# Spec Delta

## ADDED Requirements

### Requirement: 生成会话钉住当前模型选择

AI 生成地图草稿创建的生成会话 SHALL 在创建时钉住当前模型选择（含推理档位），与对话输入控件栏显示的模型解析结果同源；生成过程的全部模型调用 MUST 使用该钉入模型，不回落到其它 provider。

#### Scenario: 生成草稿使用当前选择的模型

- **WHEN** 用户触发 AI 生成且当前模型选择为某 provider 的某模型
- **THEN** 生成会话以该模型（含档位）创建并执行全部生成调用
