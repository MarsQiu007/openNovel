## MODIFIED Requirements

### Requirement: 种子导入标记为 verified

人工精选的种子技法通过种子导入命令入库时，SHALL 以 `verified` 状态、0.8 置信度存储到当前书籍库，与 LLM 提取路径区分；命令 MUST NOT 提供或默认使用全局通用库归属。

#### Scenario: 导入种子

- **WHEN** 用户运行种子导入命令导入合法技法 JSON
- **THEN** 每条种子以 `verified`/0.8 存入当前书籍库，可被本书检索召回
- **THEN** 全局通用库中不新增条目

### Requirement: 存量层级重分类维护命令

系统 SHALL 提供一次性的技法层级重分类维护入口：只扫描当前书籍库的全部技法，按统一层级判据批量重判 level 并在原条目上更新（保留 id、状态、置信度与证据不变）。命令 MUST NOT 扫描或更新全局通用库，MUST NOT 提供全局库或双源范围选项。

重分类 MUST 幂等可重跑：重复执行不产生重复数据，判定失败或输出超出枚举时保留原值；命令 SHALL 输出重判结果分布供人工审阅。

#### Scenario: 双源重分类

- **WHEN** 用户在任意书目录执行重分类命令，本书库有存量技法
- **THEN** 当前书籍库技法按判据重判 level，全局库不参与扫描，更新后的技法在面板展示新层级

#### Scenario: 幂等重跑

- **WHEN** 重分类命令执行成功后再次执行
- **THEN** 技法库无重复条目、无额外变更，结果分布与首次一致

#### Scenario: 非法判定保留原值

- **WHEN** 某条技法的 LLM 重判输出缺失、无法解析或超出枚举范围
- **THEN** 该技法保留原 level，命令继续处理其余条目并在结果报告中计数

### Requirement: 技法内容性质维度与判断规则

技法 SHALL 携带 `scope` 内容性质（`general` | `adult`，默认 `general`）；对话学习保存时 agent SHALL 逐候选判断——明显通用写法标 `general`，含成人内容或判断存疑标 `adult`。`scope` SHALL 只用于当前书籍库召回的内容性质闸门，MUST NOT 决定条目写入全局库或本书库。种子导入 SHALL 默认写入当前书籍库。

#### Scenario: 学习时逐候选判断

- **WHEN** 学习 agent 处理一条“对话节奏控制”候选
- **THEN** 该候选按内容性质显式判定为 `general` 或 `adult`，判定结果不改变写入当前书籍库这一事实

#### Scenario: 存量数据标注

- **WHEN** 当前书籍库中存在历史技法缺少 `scope` 值
- **THEN** 运行时按 `general` 处理，且该技法仍留在当前书籍库

#### Scenario: 种子默认全局

- **WHEN** 用户运行种子导入命令且未指定任何库归属选项
- **THEN** 种子技法写入当前书籍库，全局库不新增条目

### Requirement: 检索工具空结果反馈区分空库与无匹配

`search_techniques` 检索无结果时 SHALL 区分两种情形给出反馈：当前书籍库无条目时，明确反馈“本书技法库为空”；当前书籍库存在条目但当前过滤条件下无匹配时，反馈 MUST 包含本书库总条数、说明过滤条件命中 0 条，并提示可移除或放宽过滤条件，MUST NOT 表述为“技法库为空”。

#### Scenario: 有过滤条件但库非空

- **WHEN** 当前书籍库共 36 条技法且全部为 `unverified`，agent 以 `status=verified` 发起检索
- **THEN** 工具返回说明过滤后无匹配、本书库共 36 条且均为未验证状态，并提示可移除状态过滤，不得表述为技法库为空

#### Scenario: 双库均无条目

- **WHEN** 当前书籍库没有任何技法，且全局通用库已退役清理，agent 发起任意检索
- **THEN** 工具明确反馈本书技法库为空

## ADDED Requirements

### Requirement: 所有入库路径写入本书库

提取入库、种子导入、对话式学习保存和手工创建 SHALL 全部写入当前书籍库。任何入库路径 MUST NOT 创建、查询或依赖全局通用库；`scope` 造成的写法差异只允许作用于内容性质闸门。

#### Scenario: 提取结果入库

- **WHEN** 用户在当前书籍目录运行提取命令且未选择仅输出 JSON
- **THEN** 提取出的技法进入当前书籍库

#### Scenario: 对话学习入库

- **WHEN** 学习 agent 保存一条 `scope=general` 或 `scope=adult` 技法
- **THEN** 该技法进入当前书籍库，其他书籍不召回它

### Requirement: 技法管理接口只访问本书库

技法列表、详情、创建、更新与删除接口 SHALL 只访问当前书籍库；接口 MUST NOT 接受 `global`、`all` 或 `targetLibrary` 这类跨库范围/归属参数。更新 `scope` MUST NOT 触发跨库迁移。

#### Scenario: 列表只返回本书条目

- **WHEN** 客户端请求技法列表
- **THEN** 返回当前书籍库条目，不合并任何全局库条目

#### Scenario: 编辑性质不迁移

- **WHEN** 用户编辑某条技法的 `scope`
- **THEN** 接口在当前书籍库中更新该技法，不移动存储位置
