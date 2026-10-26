# config-reload-propagate Specification

## Purpose
定义全局配置变更（PATCH `/global/config`）向 location 运行时的传播语义——不仅让 instance scope 销毁重建，还必须让 location 层缓存条目失效，使下一次查询（如 `agent.list`）读到新配置，无需等待空闲超时或重启 server。

## Requirements

### Requirement: 全局配置变更后 location 层必须失效

PATCH `/global/config` 在 `changed: true` 时，除销毁 instance scope 外，还必须使所有活跃 location 的 LocationServiceMap 缓存条目失效；失效后下一次 `LocationServiceMap.get(ref)` 调用 SHALL 触发按当前全局配置重建 location 层（含重读全局配置与重放全部 transform）。

#### Scenario: 切换智能体模型后立刻查询 agent.list

- **WHEN** 客户端 PATCH `/global/config` 把 `agent.general.model` 从 `provider-a/m-x` 改为 `provider-b/m-y`，响应 200
- **AND** 立刻 GET `/api/agent?location[directory]=<dir>` 查询智能体花名册
- **THEN** 响应中 `general` 的 `model.id` 为 `m-y`、`model.providerID` 为 `provider-b`（新值），不是 `m-x`

#### Scenario: 失效后再次查询读到新值

- **WHEN** PATCH 已使 location 层失效
- **AND** 客户端连续两次 GET `/api/agent?location[directory]=<dir>`（间隔任意时长）
- **THEN** 两次响应的 `general.model` 均为新值，不再回退到旧值

#### Scenario: 失效前已运行的 Effect 不受影响

- **WHEN** PATCH 触发 location 层失效时，已有 session / 工具调用在跑（持有的是失效前 layer 的 service 实例）
- **THEN** 这些在跑的 Effect 继续用旧 layer 完成当前工作（不被打断、不抛错）
- **AND** 它们完成后，service 实例随 ScopedCache 引用计数自然回收

### Requirement: 失效失败 SHALL 不阻断 PATCH 响应

location 层失效操作（逐个 ref 调用 `invalidate`）若抛出异常，SHALL 被吞错并记录日志，PATCH `/global/config` 的 200 响应和全局配置文件的落盘结果 MUST NOT 受影响。

#### Scenario: 单个 ref 失效抛错

- **WHEN** PATCH `/global/config` 触发失效时，某一个 location ref 的 `invalidate` 抛错（例如该 ref 正处于 layer 构建中）
- **THEN** PATCH 仍返回 200，全局配置文件仍写入新值
- **AND** 错误被记录到日志（含出错的 directory / workspaceID）
- **AND** 其他 ref 的失效继续执行，不被中断

#### Scenario: 全部 ref 失效均失败

- **WHEN** PATCH 触发失效时，所有活跃 ref 的 `invalidate` 均失败
- **THEN** PATCH 仍返回 200，全局配置文件仍写入新值
- **AND** 后续 GET `/api/agent` 读到旧值（与失效前行为一致），不出现服务端崩溃或挂起
