# Spec Delta

## MODIFIED Requirements

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
