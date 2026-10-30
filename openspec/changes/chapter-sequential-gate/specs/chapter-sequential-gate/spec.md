# Spec Delta

## Purpose

定义 review 模式下正文写作的逐章串行门禁：前置章节未全部通过审批时，后续章节的正文写入与修订被工具层硬拦截，保证「写一章、审一章、再写下一章」的人工把关节奏不被 agent 跳章破坏。

## ADDED Requirements

### Requirement: review 模式逐章串行门禁

review 模式（`writing_mode=review`）下，正文写入与修订工具（`write_chapter` / `revise_chapter`）落笔前 SHALL 校验：该书章节序号（order）小于目标章节的全部章节均已通过（状态为 `final` 或 `published`）。存在未通过章节（`draft` / `pending_review` / `rejected` 等）时 SHALL 拒绝本次写入，SHALL NOT 以任何参数组合绕过。

#### Scenario: 前置待审章节拦截

- **WHEN** review 模式下第 2 章处于待审核状态，agent 尝试写入第 3 章
- **THEN** 写入被拒绝，库中第 3 章内容保持不变

#### Scenario: 前置驳回章节拦截

- **WHEN** review 模式下第 2 章被驳回且尚未重写通过，agent 尝试写入或修订第 4 章
- **THEN** 写入与修订均被拒绝

#### Scenario: 前置全部通过放行

- **WHEN** 目标章节之前（order 更小）的章节全部为 `final` 或 `published`
- **THEN** 目标章节可正常写入与修订，包括重写被驳回的目标章节自身（驳回重写循环不受阻）

### Requirement: auto 模式与规划工作不受拦截

串行门禁 SHALL 仅在 review 模式生效：auto 模式下正文写入不因前置章节状态被拒绝（串行节奏由流水线决策表保证）。大纲与规划类工作（生成、修改后续章节的大纲）SHALL NOT 受本门禁影响。

#### Scenario: auto 模式连写

- **WHEN** auto 模式下流水线完成第 1 章状态提交后继续第 2 章
- **THEN** 第 2 章写入不因第 1 章状态被拒绝（第 1 章由流水线自行置为通过）

#### Scenario: 提前规划后续大纲不被拦

- **WHEN** review 模式下第 2 章待审核，architect 生成第 5 章大纲
- **THEN** 大纲生成与保存不受门禁影响，仅该章正文写入被拦截

### Requirement: 拒绝反馈指明处理路径

门禁拒绝时，拒绝消息 SHALL 报出第一个未通过章节的序号、标题与当前状态，并指引先处理该章节（审批通过或重写通过）后再进行后续章节工作。

#### Scenario: 拒绝消息可指导行动

- **WHEN** 第 2 章（标题「夜雨初停」）待审核时尝试写第 3 章被拒
- **THEN** 拒绝消息含「第 2 章」「夜雨初停」、其当前状态与先处理前置章节的指引

### Requirement: 提示层与门禁一致性静态校验

writer 提示词与写作快照渲染 SHALL 说明 review 模式逐章串行约束（前置未通过不得写后续正文）；系统 SHALL 提供静态校验测试断言提示词约束段存在、且两个正文写入工具均已接入门禁校验。

#### Scenario: 静态校验覆盖提示词与工具接入

- **WHEN** 运行静态校验测试
- **THEN** writer 提示词含逐章串行约束段，且 write_chapter / revise_chapter 的门禁调用点均存在
