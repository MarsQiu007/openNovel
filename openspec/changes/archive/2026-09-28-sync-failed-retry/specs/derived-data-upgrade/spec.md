# Spec Delta

## ADDED Requirements

### Requirement: 升级失败章节显式重试

升级进度 SHALL 为每个失败章节返回对应的同步队列条目 ID。升级视图 SHALL 提供显式的失败章节重试操作；该操作 SHALL 通过同步队列的显式重试能力把选中的 `failed` 条目重置为 `pending`，不得直接修改派生数据同步状态。重试后进度视图 SHALL 反映新的 `pending` / `failed` 聚合结果；消费闸门为暂停时，条目保持 `pending`，待续跑后再消费。

系统 SHALL NOT 在进程启动或进度查询时自动重试 `failed` 升级条目；重试必须由用户显式触发。

#### Scenario: 失败进度携带队列条目 ID

- **WHEN** 升级进度查询返回失败章节列表
- **THEN** 每个失败项包含可用于显式重试的同步队列条目 ID、章节 ID 与失败原因

#### Scenario: 用户重试失败章节

- **WHEN** 用户在升级视图中触发失败章节重试
- **THEN** 对应 `failed` 队列条目变为 `pending` 并清除失败原因
- **AND** 升级进度重新显示该章节为待同步

#### Scenario: 暂停状态下重试保留待同步

- **WHEN** 升级消费闸门为暂停且用户重试失败章节
- **THEN** 队列条目变为 `pending` 但 worker 暂不消费
- **AND** 用户续跑后该条目继续被消费

#### Scenario: 启动不自动重试失败章节

- **WHEN** 桌面端或服务进程重启且存在历史 `failed` 升级条目
- **THEN** 系统不自动发起模型调用或把这些条目改为 `pending`
- **AND** 只有用户显式重试后才重新进入消费队列
