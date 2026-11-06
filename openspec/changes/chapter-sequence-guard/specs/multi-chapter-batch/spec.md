# Spec Delta

## ADDED Requirements

### Requirement: 序号重排使进行中批量作废

章节序号重排动作（删除章节、移卷、显式序号修复）执行时 SHALL 将进行中（running）的批量写作任务作废，并在操作输出中提示重新登记批量。作废 MUST NOT 改动已完成章节的内容与状态。

#### Scenario: 删章期间批量作废

- **WHEN** 存在「第 3 章起共 5 章」的 running 批量时删除第 2 章
- **THEN** 该批量作废，操作输出提示重新登记批量，已完成章节的内容与状态不变

#### Scenario: 无批量时无额外动作

- **WHEN** 不存在 running 批量时执行移卷
- **THEN** 移卷正常完成，不产出批量相关提示
