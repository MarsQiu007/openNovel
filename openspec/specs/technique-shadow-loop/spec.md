# Shadow 检索闭环(technique-shadow-loop)

## Purpose

在写作流水线中按场景检索技法候选并记录影子日志,使 pipeline/auditor 能看见候选并逐条反馈,反馈驱动贝叶斯置信度状态机演进——为注入开关的开启提供数据依据。

## Requirements

### Requirement: 按场景检索技法候选
组装写作上下文快照时,系统 SHALL 按推断的场景类型检索匹配的技法候选(默认 top 5,按置信度降序),并 MUST 将每次非空检索写入 shadow log(小说、章节、场景类型、召回的技法 id 与名称)。候选组装 MUST 应用内容性质双闸门(technique-content-nature):本书库中 `scope=adult` 的技法仅在书级与章节级内容性质均判定为成人时进入候选;本书库不存在 adult 技法时,该过滤 MUST NOT 改变任何既有行为。

#### Scenario: 有匹配技法时检索

- **WHEN** 技法库中存在与当前章节场景类型匹配的技法
- **THEN** 快照携带候选列表,且 shadow log 新增一条记录

#### Scenario: 无匹配技法时静默

- **WHEN** 技法库为空或无场景匹配项
- **THEN** 快照候选为空,不写 shadow log,流水线继续

#### Scenario: 闸门排除的技法不写日志

- **WHEN** 本书库存在 adult 技法,但书级或章节级闸门不满足
- **THEN** 该技法不进入候选,shadow log 也不包含它,其余候选行为不变

### Requirement: 技法候选对流水线 agent 可见

组装上下文快照的工具输出 SHALL 包含技法候选段落,每个候选 MUST 携带技法 id、名称与操作指令,使 pipeline 能报告候选、auditor 能引用候选并提交反馈。该段落 MUST 标注 shadow 语义(不得作为 writer 的正文指令,除非注入开关开启)。

#### Scenario: pipeline 看到候选

- **WHEN** 快照组装完成且候选非空
- **THEN** 工具输出中出现带 id、名称、指令的候选列表及 shadow 标注
- **THEN** 工具元数据中包含候选数量

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

### Requirement: 反馈驱动置信度状态机

系统 SHALL 在每次反馈后按贝叶斯加权平均更新技法置信度(先验权重随反馈量递减);当置信度 ≥ 0.75 且有效反馈数 ≥ 5 时,技法状态 MUST 升为 `verified`。

#### Scenario: 置信度演进

- **WHEN** 某技法累计收到 5 条平均分 ≥ 0.75 的反馈
- **THEN** 该技法置信度达到 0.75 以上且状态变为 `verified`

#### Scenario: 无反馈不演进

- **WHEN** 某技法无任何反馈记录
- **THEN** 其置信度与状态保持入库时的初始值

### Requirement: 未验证新品保留曝光位
检索技法候选时,系统 SHALL 在按置信度排序的候选之外为 `unverified` 状态的技法保留曝光位(默认 2 条);双源合并下,曝光位 SHALL 跨本书库与全局库两池按入库时间取最近条目,被取中的条目 MUST 从置信度排序列表中剔除并占据候选尾部固定位(总数上限保持默认 top 5 不变),使新品能够进入 shadow 反馈闭环;库中不存在 `unverified` 技法或另一池无任何条目时,检索行为与结果 MUST 与无曝光位机制/单源时完全一致;曝光位 MUST 在内容性质闸门过滤后的剩余池内选取,被闸门排除的 `unverified` 新品 MUST NOT 通过曝光位进入候选。

#### Scenario: 高置信技法占满时新品仍曝光

- **WHEN** 库中存在不少于 5 条置信度高于 0.5 的技法,且存在最近入库的 `unverified` 新品
- **THEN** 候选列表在置信度前列之外仍包含该新品,且候选总数不超过上限

#### Scenario: 无新品时行为不变

- **WHEN** 库中不存在 `unverified` 技法
- **THEN** 候选仅为置信度排序前列,数量与顺序与无曝光位机制时一致

#### Scenario: 新品进入反馈闭环

- **WHEN** 未验证新品因曝光位进入候选且 auditor 完成章节审计
- **THEN** auditor 对该新品提交技法反馈,参与置信度状态机演进

#### Scenario: 曝光位跨池取最近

- **WHEN** 双源合并检索且两池均存在 `unverified` 新品,其中全局库新品入库时间更近
- **THEN** 曝光位由入库时间最近的条目(可全部来自全局库)占据,且被取中条目不重复占用置信度排序名额

#### Scenario: 单池饱和不吞占跨池名额

- **WHEN** 本书库 `unverified` 新品数量多于曝光位名额
- **THEN** 曝光位仍按跨池最近入库时间选取,不被本书池独占

#### Scenario: 被闸门排除的新品不曝光

- **WHEN** 一条 `unverified` 新品因 `scope=adult` 被内容性质闸门排除
- **THEN** 该新品不参与曝光位竞争,候选结果与无该新品时一致

### Requirement: 场景匹配空交集回退 general

检索技法候选时，系统 MUST 先将技法的场景标签与规范词表求交；交集为空（历史自由文本数据）时 MUST 按 `general` 身份参与场景匹配，不得因标签词表问题将已入库技法整体排除在候选之外。已有规范标签的技法匹配行为 MUST 与回退机制引入前完全一致。

#### Scenario: 自由文本标签技法可被检索

- **WHEN** 技法 `sceneTypes` 为 `["性感场景","约会场景"]`（无规范值）且本章推断场景类型为 `dialogue`
- **THEN** 该技法按 `general` 身份参与候选排序，不因标签问题被过滤

#### Scenario: 规范标签行为不变

- **WHEN** 技法 `sceneTypes` 为 `["dialogue"]` 且本章推断场景类型为 `dialogue`
- **THEN** 匹配结果与回退机制引入前一致

#### Scenario: 规范标签不匹配的场景仍被排除

- **WHEN** 技法 `sceneTypes` 为 `["action"]` 且本章推断场景类型为 `dialogue`
- **THEN** 该技法不进入候选（非空交集不适用回退）

#### Scenario: 曝光位规则不受回退影响

- **WHEN** 回退机制使一条 `unverified` 自由文本技法进入候选
- **THEN** 候选总数上限、置信度排序与未验证新品曝光位规则保持不变
