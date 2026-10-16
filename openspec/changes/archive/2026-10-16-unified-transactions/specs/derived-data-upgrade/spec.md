# derived-data-upgrade — 变更增量

## MODIFIED Requirements

### Requirement: 两阶段回填执行

升级执行 SHALL 分两阶段。Phase 1 确定性回填 SHALL 同步执行（零 token），其四个步骤——写入章节正文指纹基准、确定性重建段摘要、扫描实体引用、把 legacy 主轴文本转换为结构化条目（status=legacy，转换后查询侧不再回退旧文本）——SHALL 在单个数据库事务内原子完成：任一步失败 SHALL 整体回滚，数据库回到 Phase 1 开始前状态，MUST NOT 残留任何半成品派生数据。Phase 2 AI 重建 SHALL 批量向同步队列入队逐章 observer 重建任务（source=upgrade），复用手动编辑同步 worker 的既有重建管线。v1 升级粒度 SHALL 为整本书，不支持按卷或章节范围部分升级。

#### Scenario: 确定性阶段同步完成

- **WHEN** 用户确认升级且 Phase 1 开始
- **THEN** 系统在同步调用内完成指纹基准、段摘要、实体引用与 legacy 主轴转换，不消耗 AI 调用

#### Scenario: 确定性阶段中途失败整体回滚

- **WHEN** Phase 1 四步中任一步失败（如实体引用扫描报错）
- **THEN** 该事务内此前已写入的步骤全部回滚，数据库回到 Phase 1 开始前状态，不残留半成品派生数据
- **AND** 升级任务按既有失败语义标记失败，可由用户显式重试

#### Scenario: legacy 主轴转换消除回退

- **WHEN** Phase 1 把 legacy 主轴文本转换为 story_spine_entries（status=legacy）
- **THEN** 后续读取不再回退到旧文本路径，legacy 条目等待 AI 阶段结构化提取覆盖

#### Scenario: AI 阶段批量调度逐章重建

- **WHEN** Phase 1 完成
- **THEN** 系统为每章向同步队列入队 observer 重建任务（source=upgrade），worker 按既有管线逐章重建摘要、引用、段摘要与主轴条目

#### Scenario: 单章失败不阻塞其余章节

- **WHEN** 某章 observer 重建失败
- **THEN** 该章任务标记 failed 并保留失败原因，其余章节任务继续执行

#### Scenario: 已完成项幂等跳过

- **WHEN** 升级再次触发且部分章节已按当前指纹重建
- **THEN** 这些章节按指纹去重跳过，不重复消耗 AI 调用
