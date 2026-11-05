# Spec Delta

## MODIFIED Requirements

### Requirement: agent 花名册查询的装载就绪可见性

`agent.list` 查询返回的花名册 MUST 包含已完成注册的第一方/文件路径外部插件所注册的 agent；装载失败 MUST 保持兜底（查询不挂死、运行时可继续使用），且 MUST 同步记入配置健康检查的问题清单，经健康状态 API 与设置界面可见（不再仅限日志）。

#### Scenario: 首查等待外部插件就绪

- **WHEN** 服务端 boot 后首次收到 `agent.list`，且配置声明了第一方外部插件（如 `@opennovel-ai/plugin/novel-writer-v2`）
- **THEN** 响应花名册包含该插件注册的 agent；等待有界（超时兜底返回当前已注册集，不挂死）

#### Scenario: 插件装载失败不阻断查询

- **WHEN** 某外部插件装载失败（模块缺失、形状不符等）
- **THEN** `agent.list` 仍返回其余已注册 agent 的花名册，失败原因同时出现在服务端日志与配置健康检查的问题清单

#### Scenario: registry 第三方插件最终一致

- **WHEN** 配置声明了 registry/npm 第三方插件
- **THEN** `agent.list` 不保证其就绪（保持异步装载），其 agent 可在后续查询中出现

#### Scenario: 装载失败进入健康清单

- **WHEN** 某个已配置外部插件加载失败，客户端随后请求配置健康状态
- **THEN** 问题清单包含该插件条目及失败原因，同时 `agent.list` 查询正常返回且不挂死

#### Scenario: 装载成功不记录问题

- **WHEN** 所有已配置外部插件加载成功
- **THEN** 配置健康问题清单不包含任何插件装载记录，花名册包含这些插件注册的 agent

## ADDED Requirements

## REMOVED Requirements
