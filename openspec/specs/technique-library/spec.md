# 技法库管理(technique-library)

## Purpose

管理写作技法的入库与生命周期:提供 LLM 逆向提取与人工种子两条入库路径,以本地 SQLite 存储,并通过 unverified → verified 状态机保证未经反馈验证的技法不会获得高置信度。

## Requirements

### Requirement: LLM 提取技法入库保持 unverified 初始状态

通过提取管线(分段 → 高亮 → 蒸馏 → 自过滤)得到的技法,提取命令完成时 SHALL 默认直接入库,入库时 SHALL 以 `unverified` 状态、0.5 置信度存储。提取结果 MUST 始终同时产出 JSON 文件(供人工审阅);用户显式传入退出选项时 SHALL 仅产出 JSON 文件,不入库。

#### Scenario: 提取并入库

- **WHEN** 用户运行提取命令且未显式退出入库
- **THEN** 提取的技法写入 JSON 文件,且每条以 `unverified`/0.5 存入技法库
- **THEN** 无任何一条被标记为 `verified`

#### Scenario: 仅提取不入库

- **WHEN** 用户运行提取命令并显式传入退出入库选项
- **THEN** 提取结果仅写入 JSON 文件,技法库无变更

### Requirement: 种子导入标记为 verified

人工精选的种子技法通过种子导入命令入库时,SHALL 以 `verified` 状态、0.8 置信度存储,与 LLM 提取路径区分。

#### Scenario: 导入种子

- **WHEN** 用户运行种子导入命令导入合法技法 JSON
- **THEN** 每条种子以 `verified`/0.8 存入技法库,可被高置信度检索召回

### Requirement: 提取质量自过滤

提取管线 SHALL 剔除无证据的技法候选,以及指令落在模糊措辞黑名单(如"要注意""避免过度"类不可操作指令)的候选;同名候选 SHALL 合并证据。

#### Scenario: 模糊指令被剔除

- **WHEN** 蒸馏产出的技法指令仅为"要注意对话节奏"
- **THEN** 该候选不进入提取结果,不计入入库数量

### Requirement: 技法库故障不影响写作主流程

技法库(文件损坏、表缺失、驱动异常)不可用时,写作流水线 SHALL 正常运行,技法相关步骤静默降级为空候选,不产生报错。

#### Scenario: 技法库损坏时写作

- **WHEN** 技法存储不可用且流水线运行
- **THEN** 写作流程正常完成,技法候选视为空

### Requirement: 层级判据统一入库

写作技法的 `level`（作用层级） SHALL 按统一判据产出：判据覆盖全部 5 个枚举值（paragraph/sentence/dialogue/description/transition），每个值一句可操作的判定定义，并说明与场景标签（scene_types）的分工——层级描述技法作用的最小文本单元，场景标签描述技法适用的叙事场景，二者不得混用同一判定逻辑。

判据 SHALL 以单一事实源维护，对话学习流程指引、`save_technique` 工具描述与提取蒸馏提示词 MUST 引用同一份判据文本，不得各自改写。

蒸馏提示词的 JSON 示例 MUST NOT 锚定单一层级值（不得以 `"level": "paragraph"` 这类写死示例诱导输出）；高亮阶段判定的层级 SHALL 作为参考信号传入蒸馏提示词，蒸馏输出为层级最终值；蒸馏未产出合法层级时按缺省值兜底。

#### Scenario: 学习流程按判据产出多样层级

- **WHEN** 用户发起"来学习这本书籍的写作技巧"且章节中存在句子级修辞、段落级结构、对话机制等不同粒度的技法
- **THEN** 入库技法的 level 按判据分布到对应枚举值，而非全部为 paragraph

#### Scenario: 蒸馏示例不锚定单一值

- **WHEN** 提取管线蒸馏一批含多种粒度技法的标记段落
- **THEN** 蒸馏提示词的示例不固定任一层级值，产出结果按判据覆盖多个枚举值

#### Scenario: 缺省兜底

- **WHEN** 蒸馏输出缺少 level 字段或值不在枚举内
- **THEN** 该技法按缺省层级入库，提取流程不报错

### Requirement: 存量层级重分类维护命令

系统 SHALL 提供一次性的技法层级重分类维护入口：扫描本书库与全局通用库两个来源的全部技法，按统一层级判据批量重判 level 并在原条目上更新（保留 id、状态、置信度与证据不变）。

重分类 MUST 幂等可重跑：重复执行不产生重复数据，判定失败或输出超出枚举时保留原值；命令 SHALL 输出重判结果分布供人工审阅。

#### Scenario: 双源重分类

- **WHEN** 用户在任意书目录执行重分类命令，本书库与全局库均有存量技法
- **THEN** 两个来源的技法均按判据重判 level，更新后的技法在面板展示新层级

#### Scenario: 幂等重跑

- **WHEN** 重分类命令执行成功后再次执行
- **THEN** 技法库无重复条目、无额外变更，结果分布与首次一致

#### Scenario: 非法判定保留原值

- **WHEN** 某条技法的 LLM 重判输出缺失、无法解析或超出枚举范围
- **THEN** 该技法保留原 level，命令继续处理其余条目并在结果报告中计数

### Requirement: 对话式学习入库保持 unverified 初始状态

通过写作 agent 在对话学习流程中调用入库工具保存的技法,SHALL 以 `unverified` 状态、0.5 置信度存储,与 LLM 提取管线路径一致;入库工具 MUST 复用模糊指令黑名单与无证据过滤,被拒绝的候选 MUST 在工具返回中说明原因。

#### Scenario: 工具落库初始状态

- **WHEN** agent 在学习流程中保存一条合法技法
- **THEN** 该技法以 `unverified`/0.5 存入技法库,可在 App 技法库面板查看

#### Scenario: 模糊指令候选被工具拒绝

- **WHEN** agent 保存的技法 instruction 命中模糊措辞黑名单或无证据
- **THEN** 工具拒绝入库并在返回中给出原因,技法库无变更

### Requirement: 同名合并保留已有状态与置信度

同名技法入库时 SHALL 合并证据条目(按 excerpt 去重),且 MUST NOT 改动已有条目的 `status` 与 `confidence`——尤其不得把 `verified` 条目降级为 `unverified`。

#### Scenario: 合并证据且保留已验证状态

- **WHEN** 新候选与库中 `verified` 技法同名
- **THEN** 证据合并到已有条目,该条目保持 `verified` 状态与原置信度

#### Scenario: 重复证据不去重失败

- **WHEN** 合并来源的证据与已有证据 excerpt 相同
- **THEN** 证据列表中该 excerpt 只出现一次

### Requirement: 技法内容性质维度与判断规则

技法 SHALL 携带 `scope` 内容性质（`general` | `adult`，默认 `general`）；对话学习保存时 agent SHALL 逐候选判断——明显通用写法（对话节奏、悬念铺设、视角控制等）标 `general`，含成人内容或判断存疑标 `adult`；种子导入 SHALL 默认写入全局通用库（`--local` 显式指定时保留写入本书库的旧行为）。

#### Scenario: 学习时逐候选判断

- **WHEN** 一章同时提炼出"悬念铺设"（通用）与"亲密场景描写"（成人）两条候选
- **THEN** 前者以 `scope=general` 入全局库，后者以 `scope=adult` 入本书库

#### Scenario: 存量数据标注

- **WHEN** 本变更实施时存在已入库的未标注技法（scope 列默认 general）
- **THEN** 实施任务对存量数据完成 agent 批量判定标注，成人技法标 `adult` 并保持本书库位置

#### Scenario: 种子默认全局

- **WHEN** 用户运行种子导入命令且未指定 `--local`
- **THEN** 种子技法以 `scope=general` 写入全局通用库，全部书籍可用
