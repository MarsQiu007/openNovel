## Purpose

为小说工作台提供书籍级派生数据升级能力：升级引入数据回填需求的版本自行声明回填任务，用户在打开旧书时可见待升级项与成本预估，显式触发后按确定性 / AI 两阶段回填，消除 AI 写作上下文中的待校验旧记忆。

## ADDED Requirements

### Requirement: 升级任务注册表

系统 SHALL 维护升级任务注册表：每个引入数据回填需求的版本 SHALL 在注册表声明回填任务（任务含版本标识、种类 deterministic / ai、目标与幂等适用判定），客户端 SHALL 能查询某本小说未执行的注册任务。纯 schema 迁移（加列、加表等不改变派生数据语义）SHALL NOT 注册回填任务；"某版本升级是否需要回填数据"SHALL 由注册表回答，而非人工判断。

#### Scenario: 版本声明回填任务

- **WHEN** 某版本引入新鲜度契约（如正文指纹基准）使既有派生数据需要回填
- **THEN** 该版本在注册表登记对应的回填任务（kind、target、appliesTo 判定）
- **AND** 打开含旧数据的小说时，客户端能查询到该未执行任务

#### Scenario: 纯 schema 迁移不注册任务

- **WHEN** 某次升级只做加列或加表、不引入新的派生数据口径
- **THEN** 注册表不新增任务，旧书不会因该版本显示待升级提示

#### Scenario: 已满足任务幂等跳过

- **WHEN** 一本小说的派生数据已满足某注册任务的判定（如指纹基准已存在）
- **THEN** 该任务对该小说不显示为未执行，重复触发升级也不会重复执行

### Requirement: 待升级检测与打开提示

客户端打开书籍时 SHALL 查询该小说的未执行升级任务；存在未执行任务时，工作台 SHALL 展示"可升级到当前版本"的提示横幅。未升级书籍的打开、阅读、导出与基础编辑行为 SHALL 与现状一致（兼容层与惰性重建继续有效），提示 SHALL NOT 阻塞任何现有操作。

#### Scenario: 旧书打开显示升级提示

- **WHEN** 用户打开一本存在未执行升级任务的小说
- **THEN** 工作台顶部显示可升级提示横幅，不阻塞阅读与编辑

#### Scenario: 已最新书籍无提示

- **WHEN** 用户打开一本没有未执行升级任务的小说
- **THEN** 工作台不显示升级提示

#### Scenario: 未升级书行为不变

- **WHEN** 用户忽略提示直接阅读或编辑未升级书籍
- **THEN** 阅读、导出与基础编辑行为与升级前一致，惰性重建继续有效

### Requirement: 升级成本预估与显式触发

触发升级前，系统 SHALL 展示待升级项清单与成本预估：确定性项 SHALL 标注免费（零 token），AI 重建项 SHALL 按章数估算调用次数（约 N 章 × 1 次 observer 重建调用，每章调用覆盖章节摘要三要素、实体引用、段摘要与该章主轴条目）。升级 SHALL 只在用户显式确认后执行；系统 SHALL NOT 静默执行全量扫描，也 SHALL NOT 在打开书籍时自动升级。

#### Scenario: 展示预估后确认执行

- **WHEN** 用户在工作台点击升级并查看预估（N 项确定性免费 + 约 N 次 AI 调用）
- **THEN** 用户确认后系统才开始执行升级

#### Scenario: 未确认不执行

- **WHEN** 用户关闭预估展示或未点击确认
- **THEN** 系统不执行任何回填，不产生任何 AI 调用，书籍数据保持不变

### Requirement: 两阶段回填执行

升级执行 SHALL 分两阶段。Phase 1 确定性回填 SHALL 同步执行（零 token）：写入章节正文指纹基准、确定性重建段摘要、扫描实体引用、把 legacy 主轴文本转换为结构化条目（status=legacy，转换后查询侧不再回退旧文本）。Phase 2 AI 重建 SHALL 批量向同步队列入队逐章 observer 重建任务（source=upgrade），复用手动编辑同步 worker 的既有重建管线。v1 升级粒度 SHALL 为整本书，不支持按卷或章节范围部分升级。

#### Scenario: 确定性阶段同步完成

- **WHEN** 用户确认升级且 Phase 1 开始
- **THEN** 系统在同步调用内完成指纹基准、段摘要、实体引用与 legacy 主轴转换，不消耗 AI 调用

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

### Requirement: 升级进度可见、可暂停、可续跑

升级进度 SHALL 按来源聚合同步队列状态（synced / pending / failed / 总数）展示。用户 SHALL 能暂停升级：暂停后 worker SHALL 停止消费 upgrade 来源任务，队列条目保留。升级消费闸门状态 SHALL 持久化，进程重启后 SHALL 保持暂停或续跑的最后状态。续跑 SHALL 重新开放消费，已完成项 SHALL 按指纹去重幂等跳过。单章失败原因 SHALL 可查。

#### Scenario: 进度聚合展示

- **WHEN** 升级执行中用户查看进度
- **THEN** 展示已同步、待同步、失败章节数与总数

#### Scenario: 暂停保留队列

- **WHEN** 用户暂停升级
- **THEN** worker 停止消费 upgrade 来源任务，已入队条目与状态保留，手动编辑触发的重建不受影响

#### Scenario: 续跑幂等继续

- **WHEN** 用户续跑已暂停的升级
- **THEN** worker 重新消费 upgrade 任务，已 synced 的章节跳过，failed 章节按既有重试语义处理

#### Scenario: 失败原因可查

- **WHEN** 某章升级失败
- **THEN** 进度视图能查看该章失败原因

### Requirement: 升级诚实性约束

派生数据 SHALL 只有在内容真正重建后才允许标记为已同步：Phase 1 确定性回填 SHALL 写入真实计算出的指纹与派生结果，Phase 2 SHALL 在 observer 重建产出后才更新派生数据。任何路径 SHALL NOT 把未重建的旧派生数据直接标记为已同步或清除其待校验状态；重建失败章节的旧数据 SHALL 保持待校验可见。

#### Scenario: 重建后标记已同步

- **WHEN** 某章 observer 重建成功
- **THEN** 该章摘要、引用、段摘要与主轴条目以新指纹标记 synced，待校验状态消除

#### Scenario: 拒绝伪造已同步

- **WHEN** 任何代码路径尝试在未重建的情况下把旧派生数据标记为已同步
- **THEN** 系统拒绝该写入

#### Scenario: 失败章节保持待校验

- **WHEN** 某章升级重建 failed
- **THEN** 该章旧派生数据保持缺指纹的待校验状态，不伪造、不覆盖
