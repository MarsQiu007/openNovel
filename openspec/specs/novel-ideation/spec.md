# novel-ideation Specification

## Purpose

为长篇小说创作提供独立的创意发散层：创意家根据用户请求和当前项目上下文生成结构化候选方案，同时保持只读边界，避免灵感探索污染正式设定。

## Requirements


### Requirement: 创意家提供四种创作模式

系统 SHALL 提供名为 `ideator` 的子 agent，并 SHALL 支持 `book_pitch`、`plot_spark`、`character_spark` 和 `material_spark` 四种模式。创意家 SHALL 输出候选方案供用户审阅，SHALL NOT 直接创建、更新或删除小说设定、章节、卷、大纲或弧光。

#### Scenario: 开书前方案发散

- **WHEN** director 以 `book_pitch` 模式调度创意家
- **THEN** 创意家返回 3 个差异化故事方向，而不是直接初始化书籍或写入设定

#### Scenario: 剧情灵感发散

- **WHEN** 用户明确请求剧情灵感，且当前项目已有设定或剧情进展
- **THEN** 创意家基于当前上下文返回候选剧情方向，并说明对既有弧光的影响

#### Scenario: 角色灵感发散

- **WHEN** 用户明确请求角色灵感
- **THEN** 创意家返回候选角色或关系灵感，并说明动机、冲突和潜在用途

#### Scenario: 素材灵感发散

- **WHEN** 用户明确请求世界观、地点、组织、道具、意象或母题素材
- **THEN** 创意家返回候选素材灵感，并说明故事内用途、限制和代价

### Requirement: 创意家保持只读

创意家 SHALL 只能访问读取类项目上下文能力，包括设定列表、设定详情、设定搜索、结构线弧光、历史召回和必要时的章节正文。创意家 SHALL NOT 调用设定写入、设定删除、角色写入、大纲写入、弧光写入、章节写入、状态提交或项目配置修改等能力。

#### Scenario: 只读取当前设定

- **WHEN** 创意家为已有小说生成临时灵感
- **THEN** 它可以读取相关设定、弧光和历史召回，用于保证灵感与既有故事一致

#### Scenario: 禁止直接落库

- **WHEN** 创意家产出一个看似可用的角色、世界观或剧情灵感
- **THEN** 它不写入任何数据库记录，只把候选方案返回给 director

### Requirement: 候选灵感使用统一结构

创意家 SHALL 为每个候选方案输出统一结构，至少包含标题、一句话概念、核心冲突或用途、为什么现在有效、对既有故事的影响、风险或代价、下一步落地建议。除用户明确要求不同数量外，每次 SHALL 输出 3 个刻意差异化的候选方案。

#### Scenario: 三个候选方案

- **WHEN** 用户请求剧情、角色、素材或开书灵感且未指定数量
- **THEN** 创意家输出 3 个方向不同的候选，而不是 3 个同质化变体

#### Scenario: 方案影响说明

- **WHEN** 当前项目已有设定、弧光或章节进展
- **THEN** 每个候选方案都说明它对既有故事的影响和潜在风险

### Requirement: director 路由明确创意请求

director SHALL 只在用户明确请求创意发散、候选方案、灵感或开书方案时调度创意家。普通剧情问答、设定查询、章节执行和写作流水线 SHALL NOT 自动触发创意家。

#### Scenario: 明确创意请求

- **WHEN** 用户要求“给几个剧情方向”“帮我想几个角色”“提供素材点子”或“帮我构思新书方案”
- **THEN** director 调度创意家并把用户约束和当前模式传给它

#### Scenario: 普通剧情讨论

- **WHEN** 用户只是询问已有剧情、设定或写作建议，没有要求发散候选方案
- **THEN** director 不调度创意家，按普通对话或查询流程响应

### Requirement: 开书前方案确认流程

在 interactive 初始化中，当用户已有完整故事方向时，director SHALL 可以直接整理方案并调度 architect。当用户想法模糊或请求候选方案时，director SHALL 先调度创意家生成 book pitch，等待用户选择、合并或修改后形成 creative brief，并在用户明确确认后才调度 architect 落库。

#### Scenario: 用户想法完整

- **WHEN** 用户在开书时已经提供清晰的书名、题材、梗概、主要角色和世界观方向
- **THEN** director 可以不调度创意家，直接把用户方案整理为初始化依据

#### Scenario: 用户想法模糊

- **WHEN** 用户只提供模糊题材或一句话点子，并希望系统帮助发散
- **THEN** director 先让创意家输出候选方案，等用户选择或合并后生成 creative brief

#### Scenario: 落库前确认

- **WHEN** 用户从候选方案中选择或合并出一个方向
- **THEN** director 向用户呈现最终 creative brief，并在获得明确确认后才调度 architect

### Requirement: auto 初始化使用推荐方案

当初始化模式为 auto 且需要方案发散时，创意家 SHALL 输出 3 个方案并标记推荐方案。director SHALL 将推荐方案作为 creative brief 交给 architect，SHALL NOT 停下来等待用户选择，并且 SHALL 在汇报中保留另外两个备选方向。

#### Scenario: 自动初始化

- **WHEN** `setup_mode` 为 auto 且用户只提供基础信息
- **THEN** director 将创意家推荐的第 1 个方案交给 architect，同时在汇报中列出备选方向

#### Scenario: 用户事后切换方向

- **WHEN** 用户要求改用备选方案
- **THEN** director 使用该备选信息重新组织 creative brief，并遵循现有初始化和设定修改流程

### Requirement: 临时灵感采纳必须二次确认

用户采纳 `plot_spark`、`character_spark` 或 `material_spark` 灵感时，director SHALL 先向用户确认落地方式，SHALL NOT 自动写入任何正式数据。确认后，director SHALL 按影响范围路由：只影响下一章走章节大纲流程；影响支线或角色弧走弧光维护流程；影响整卷或主线走 architect；新增或修改设定走设定写入流程。

#### Scenario: 不自动落库

- **WHEN** 创意家返回 3 个角色灵感且用户尚未明确选择
- **THEN** director 不创建角色记录，也不调用任何设定写入工具

#### Scenario: 只影响下一章

- **WHEN** 用户确认的剧情灵感只改变下一章的推进方式
- **THEN** director 使用章节大纲流程更新或生成对应章节大纲

#### Scenario: 影响更大结构

- **WHEN** 用户确认的剧情灵感会改变支线、角色弧、卷纲或主线
- **THEN** director 交给弧光维护流程或 architect，而不是直接写入章节正文

#### Scenario: 新增设定

- **WHEN** 用户确认某个世界观或角色灵感应成为正式设定
- **THEN** director 使用现有设定写入流程，并保持既有校验、确认门和级联约束

### Requirement: architect 消费已确认创意方案

architect SHALL 将 director 传入的已确认 creative brief 视为硬约束，并在此基础上完成世界观、角色、关系、剧情弧、卷纲和风格指南的结构化设计。architect SHALL NOT 主动替换用户已确认的方向。若 brief 明显不可执行，architect SHALL 停止并说明结构风险，交回 director 处理。

#### Scenario: 按确认方向落库

- **WHEN** director 把用户确认的 creative brief 交给 architect
- **THEN** architect 基于该 brief 生成结构化设定，而不是重新提出另一个故事方向

#### Scenario: brief 存在结构风险

- **WHEN** architect 发现 brief 与题材规则、既有设定或长篇弧光存在明显冲突
- **THEN** 它停止落库，向 director 说明不可执行原因和风险，而不是擅自修改方向

#### Scenario: 局部执行风险

- **WHEN** brief 可执行但存在小范围风险或需要取舍
- **THEN** architect 可以继续执行，并在方案摘要中明确标注风险

### Requirement: 写作流水线不自动调用创意家

章节写作流水线 SHALL NOT 在 plan、compose、write、audit、revise、reflect、sync 或 next 阶段自动调度创意家。流水线发现结构或质量问题时应按现有流程报告或修订；是否需要新的灵感由 director 或用户决定。

#### Scenario: 审计失败

- **WHEN** 章节审计失败且流水线完成自动修订
- **THEN** 流水线按现有结果报告或停止，不自动调用创意家改变故事方向

#### Scenario: 用户反馈套路化

- **WHEN** 用户向 director 表示后续剧情太套路，希望获得新方向
- **THEN** 由 director 调度创意家，而不是让正在执行的流水线自行改变剧情方向
