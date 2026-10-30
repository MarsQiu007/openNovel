# Spec Delta

## MODIFIED Requirements

### Requirement: 审核模式暂停

项目处于 review 模式时，任一章进入待审核状态后系统 SHALL 停止后续章节，等待用户处理；后续章节的正文写入尝试 SHALL 被写入工具硬拦截，拒绝消息报出未通过的前置章节信息，而不仅是流程约定；单次覆盖只影响当章，SHALL NOT 让批量绕过后续审核。

#### Scenario: review 模式完成第一章

- **WHEN** review 模式下批量第一章已进入待审核状态
- **THEN** 系统停止剩余章节并说明等待审批

#### Scenario: 违约写入尝试被工具拦截

- **WHEN** review 模式下批量第一章待审核，writer 尝试对第二章调用正文写入
- **THEN** 写入工具硬拦截该调用，拒绝消息报出第一章的序号、标题与待审状态

#### Scenario: 审批后继续

- **WHEN** 用户处理完待审核章节并要求继续
- **THEN** 系统从下一个未完成章节继续批量计划
