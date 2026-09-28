# derived-data-upgrade Delta

## ADDED Requirements

### Requirement: observer 重建 handler 组合注册与逐章产出

serve 组合层 SHALL 注册章节重建处理器（handler），使升级 Phase 2 入队的逐章 observer 重建任务在生产环境被真实执行。handler 对每章 SHALL 产出：章节摘要三要素（summary、key_events、char_changes）与该章结构化故事主轴条目；产出 SHALL 以触发任务携带的内容指纹落库。handler SHALL 复用确定性管线刷新该章实体引用与段摘要（幂等，按指纹去重）。章节维度的重建产出未成功落库前，该章任务 SHALL NOT 标记已同步。

主轴条目重建 SHALL 仅覆盖有章节归属的条目（chapter_id 指向该章）：先产出该章完整条目集合再整体替换该章既有归属条目，替换失败 SHALL NOT 删空该章既有条目。无章节归属的全局 legacy 主轴条目不在逐章重建范围内，保持其既有状态与读取回退行为。

#### Scenario: handler 注册后升级任务被真实重建

- **WHEN** 升级 Phase 2 入队的某章任务被 worker 消费且 handler 已注册
- **THEN** handler 读取该章正文，产出摘要三要素与该章主轴条目，以任务指纹落库
- **AND** 该章实体引用与段摘要按确定性管线幂等刷新
- **AND** 任务随后按新指纹标记已同步

#### Scenario: 重建产出落库失败不标已同步

- **WHEN** handler 产出过程中 LLM 调用失败或输出无法解析
- **THEN** 该章任务标记 failed 并保留原因，该章历史派生数据保持待校验
- **AND** 该章既有主轴条目不被删空

#### Scenario: 整体替换该章主轴归属条目

- **WHEN** 某章重建产出 K 条结构化主轴条目
- **THEN** 该章既有 chapter_id 归属条目被这 K 条新条目整体替换，新条目携带新指纹与已同步状态
- **AND** 全局 legacy 条目（无章节归属）不受影响，读取侧回退行为不变

#### Scenario: 重复消费按指纹幂等

- **WHEN** 同一章节指纹的任务被重复消费（续跑、重复入队）
- **THEN** 重建产出按指纹幂等落库，不生成重复摘要或重复主轴条目
