# Spec Delta

## ADDED Requirements

### Requirement: 失败任务显式重试

系统 SHALL 提供手动编辑同步失败任务的显式重试能力。重试请求 SHALL 指定当前小说与一个或多个同步队列条目 ID；对状态为 `failed` 且属于该小说的条目，系统 SHALL 将其重置为 `pending` 并清除失败原因。重试 SHALL NOT 修改 `pending`、`synced` 或 `skipped` 条目，也 SHALL NOT 在未重建的情况下把条目标记为 `synced`。重试响应 SHALL 报告被重置的条目数量与未被重置的条目数量。

同指纹的 `failed` 条目再次入队或重试时，系统 SHALL 复用既有队列记录并回到 `pending`，不得保留重复的 `failed` 记录导致失败计数永久残留。

#### Scenario: 重试失败条目回到待同步

- **WHEN** 用户对属于当前小说的 `failed` 同步条目发起显式重试
- **THEN** 该条目状态变为 `pending`，失败原因被清除
- **AND** 运行中的同步 worker 可以重新消费该条目

#### Scenario: 非失败条目不被重试修改

- **WHEN** 重试请求包含 `pending`、`synced`、`skipped` 或不属于当前小说的条目 ID
- **THEN** 这些条目保持原状态与原失败原因不变
- **AND** 响应中的未被重置数量反映这些条目

#### Scenario: 同指纹失败重试不产生重复记录

- **WHEN** 某章节或设定字段的 `failed` 条目按相同来源指纹重新入队或显式重试
- **THEN** 系统复用该条目记录并使其回到 `pending`
- **AND** 同步状态查询不会同时返回一条 `failed` 与一条同指纹 `pending` 记录

#### Scenario: 重试不伪造已同步

- **WHEN** 用户重试的失败条目尚未完成 observer 重建
- **THEN** 系统只把该条目重置为 `pending`
- **AND** 不会把该条目或其派生数据直接标记为 `synced`
