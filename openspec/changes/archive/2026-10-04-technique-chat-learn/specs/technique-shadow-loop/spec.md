# Spec Delta

## MODIFIED Requirements

### Requirement: auditor 逐条反馈技法运用情况

当快照候选非空时,流水线 MUST 将待反馈技法(id/名称/指令)传递给 auditor——shadow 模式(注入开关关闭)传递全部候选,注入模式(注入开关开启)仅传递 pipeline agent 评估确认的最终列表;auditor SHALL 对每条传入技法评估本章运用情况并提交反馈(0-1 评分、是否被运用、评语),反馈持久化到技法反馈表;未被传入的候选不提交反馈。

#### Scenario: auditor 提交反馈

- **WHEN** 候选非空且 auditor 完成章节审计
- **THEN** 每条传入技法在技法反馈表中有一条对应记录

#### Scenario: 候选为空时跳过

- **WHEN** 快照候选为空
- **THEN** auditor 跳过技法评估,不提交技法反馈

#### Scenario: 注入模式仅反馈确认列表

- **WHEN** 注入开关开启且 agent 从候选中确认了部分技法
- **THEN** auditor 仅对已确认技法提交反馈,被 agent 否决的候选无反馈记录

## ADDED Requirements

### Requirement: 未验证新品保留曝光位

检索技法候选时,系统 SHALL 在按置信度排序的候选之外,为 `unverified` 状态的技法保留曝光位(默认 2 条,按入库时间最新优先),并将其并入候选列表(总数上限保持默认 top 5 不变),使新品能够进入 shadow 反馈闭环;库中不存在 `unverified` 技法时,检索行为与结果 MUST 与无曝光位机制时完全一致。

#### Scenario: 高置信技法占满时新品仍曝光

- **WHEN** 库中存在不少于 5 条置信度高于 0.5 的技法,且存在最近入库的 `unverified` 新品
- **THEN** 候选列表在置信度前列之外仍包含该新品,且候选总数不超过上限

#### Scenario: 无新品时行为不变

- **WHEN** 库中不存在 `unverified` 技法
- **THEN** 候选仅为置信度排序前列,数量与顺序与无曝光位机制时一致

#### Scenario: 新品进入反馈闭环

- **WHEN** 未验证新品因曝光位进入候选且 auditor 完成章节审计
- **THEN** auditor 对该新品提交技法反馈,参与置信度状态机演进
