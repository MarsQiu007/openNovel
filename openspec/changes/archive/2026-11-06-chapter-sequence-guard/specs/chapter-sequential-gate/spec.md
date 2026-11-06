# Spec Delta

## MODIFIED Requirements

### Requirement: auto 模式与规划工作不受拦截

串行门禁 SHALL 仅在 review 模式生效：auto 模式下正文写入不因前置章节状态被拒绝（串行节奏由流水线决策表保证）。大纲与规划类工作（生成、修改后续章节的大纲）SHALL NOT 受本门禁（审批状态门禁）影响；但章纲生成仍受章节连续性门禁约束——生成第 N 章（N>1）大纲时第 N-1 章记录须已存在，该约束由 chapter-sequence 能力定义，不属于本门禁的放行范围。

#### Scenario: auto 模式连写

- **WHEN** auto 模式下流水线完成第 1 章状态提交后继续第 2 章
- **THEN** 第 2 章写入不因第 1 章状态被拒绝（第 1 章由流水线自行置为通过）

#### Scenario: 提前规划后续大纲不被拦

- **WHEN** review 模式下第 2 章待审核，architect 生成第 5 章大纲（第 1~4 章记录均已存在）
- **THEN** 大纲生成与保存不受本门禁影响，仅该章正文写入被拦截

#### Scenario: 跳号规划受连续性门禁拦截

- **WHEN** review 模式下全书仅 3 章，architect 尝试生成第 5 章大纲（第 4 章记录不存在）
- **THEN** 该生成被章节连续性门禁拒绝，本门禁的放行条款不适用
