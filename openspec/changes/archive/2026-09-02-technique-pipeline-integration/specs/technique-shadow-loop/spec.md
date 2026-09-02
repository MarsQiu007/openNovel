# Shadow 检索闭环(technique-shadow-loop)

## Purpose

在写作流水线中按场景检索技法候选并记录影子日志,使 pipeline/auditor 能看见候选并逐条反馈,反馈驱动贝叶斯置信度状态机演进——为注入开关的开启提供数据依据。

## ADDED Requirements

### Requirement: 按场景检索技法候选

组装写作上下文快照时,系统 SHALL 按推断的场景类型检索匹配的技法候选(默认 top 5,按置信度降序),并 MUST 将每次非空检索写入 shadow log(小说、章节、场景类型、召回的技法 id 与名称)。

#### Scenario: 有匹配技法时检索

- **WHEN** 技法库中存在与当前章节场景类型匹配的技法
- **THEN** 快照携带候选列表,且 shadow log 新增一条记录

#### Scenario: 无匹配技法时静默

- **WHEN** 技法库为空或无场景匹配项
- **THEN** 快照候选为空,不写 shadow log,流水线继续

### Requirement: 技法候选对流水线 agent 可见

组装上下文快照的工具输出 SHALL 包含技法候选段落,每个候选 MUST 携带技法 id、名称与操作指令,使 pipeline 能报告候选、auditor 能引用候选并提交反馈。该段落 MUST 标注 shadow 语义(不得作为 writer 的正文指令,除非注入开关开启)。

#### Scenario: pipeline 看到候选

- **WHEN** 快照组装完成且候选非空
- **THEN** 工具输出中出现带 id、名称、指令的候选列表及 shadow 标注
- **THEN** 工具元数据中包含候选数量

### Requirement: auditor 逐条反馈技法运用情况

当快照候选非空时,流水线 MUST 将候选(id/名称/指令)传递给 auditor;auditor SHALL 对每条候选评估本章运用情况并提交反馈(0-1 评分、是否被运用、评语),反馈持久化到技法反馈表。

#### Scenario: auditor 提交反馈

- **WHEN** 候选非空且 auditor 完成章节审计
- **THEN** 每条候选在技法反馈表中有一条对应记录

#### Scenario: 候选为空时跳过

- **WHEN** 快照候选为空
- **THEN** auditor 跳过技法评估,不提交技法反馈

### Requirement: 反馈驱动置信度状态机

系统 SHALL 在每次反馈后按贝叶斯加权平均更新技法置信度(先验权重随反馈量递减);当置信度 ≥ 0.75 且有效反馈数 ≥ 5 时,技法状态 MUST 升为 `verified`。

#### Scenario: 置信度演进

- **WHEN** 某技法累计收到 5 条平均分 ≥ 0.75 的反馈
- **THEN** 该技法置信度达到 0.75 以上且状态变为 `verified`

#### Scenario: 无反馈不演进

- **WHEN** 某技法无任何反馈记录
- **THEN** 其置信度与状态保持入库时的初始值
