## Purpose

让 AI 批量处理章节批注后，把真实执行结果回填到对应执行轮次，使用户能在历史面板追溯该轮改动、失败原因和关联章节版本。

## ADDED Requirements

### Requirement: 执行轮次与 AI 指令关联
AI 收到批注执行指令时，系统 SHALL 在指令中提供唯一执行轮次 ID。AI 后续提交执行结果时 MUST 使用该 ID 关联正确的轮次。

#### Scenario: 指令包含轮次 ID
- **WHEN** 用户触发批注执行并成功创建执行轮次
- **THEN** AI 收到的执行指令包含该轮次 ID
- **THEN** AI 提交结果后系统更新同一轮次

### Requirement: AI 回填执行结果
系统 SHALL 提供 AI 可调用的执行结果回填能力。回填 MUST 支持执行成功与失败，MUST 写入结果摘要，MUST 校验执行轮次存在。回填成功时，系统 SHALL 自动关联该章节当前最新的章节版本。

#### Scenario: AI 汇报成功
- **WHEN** AI 完成按批注修改章节正文
- **THEN** AI 使用执行轮次 ID 汇报成功结果
- **THEN** 执行轮次状态变为 `completed`
- **THEN** 执行轮次记录结果摘要和该章节最新章节版本 ID

#### Scenario: AI 汇报失败
- **WHEN** AI 无法完成执行或批注无法全部处理
- **THEN** AI 使用执行轮次 ID 汇报失败结果
- **THEN** 执行轮次状态变为 `failed`
- **THEN** 执行轮次记录失败摘要

#### Scenario: 回填目标不存在
- **WHEN** AI 使用不存在的执行轮次 ID 回填结果
- **THEN** 系统拒绝回填
- **THEN** 不修改任何执行轮次数据

### Requirement: 发送成功不等于执行完成
前端成功把执行指令发送到会话后，执行轮次 SHALL 保持 `running`。只有 AI 回填结果后，轮次状态才允许变为 `completed` 或 `failed`；指令发送失败时轮次 MAY 立即标记为 `failed`。

#### Scenario: 指令已发送但 AI 未汇报
- **WHEN** 前端成功发送批注执行指令且 AI 尚未回填
- **THEN** 历史面板显示该轮次仍处于执行或等待回填状态
- **THEN** 轮次状态不是 `completed`

#### Scenario: 指令发送失败
- **WHEN** 执行指令发送或批注关联失败
- **THEN** 执行轮次状态变为 `failed`
- **THEN** 历史面板显示失败摘要

### Requirement: 历史结果展示
历史面板 SHALL 展示每个执行轮次的状态、结果摘要和关联章节版本。旧轮次没有章节版本或结果摘要时，系统 SHALL 降级显示，不视为错误。

#### Scenario: 查看回填结果
- **WHEN** AI 已成功回填某个执行轮次
- **THEN** 历史面板显示该轮次的结果摘要
- **THEN** 历史面板显示该轮次关联的章节版本

#### Scenario: 查看历史空结果
- **WHEN** 用户查看旧执行轮次且其结果摘要或章节版本为空
- **THEN** 历史面板显示空结果或等待回填状态
- **THEN** 面板不因缺少结果数据崩溃或隐藏该轮次