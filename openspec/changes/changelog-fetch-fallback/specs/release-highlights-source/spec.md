## ADDED Requirements

### Requirement: 版本亮点数据源远端优先内置兜底

应用内版本更新亮点弹窗 SHALL 优先从远端 changelog 数据源加载；远端不可用（404、网络失败、格式非法）时 SHALL 回退到构建产物内置的 changelog 快照；两者皆不可用时 SHALL 静默跳过，不弹错误提示。

#### Scenario: 远端不可用回退内置快照

- **WHEN** 远端 changelog 地址返回 404 或请求失败，且构建产物内置快照存在
- **THEN** 亮点弹窗使用内置快照数据正常展示

#### Scenario: 远端可用时不读快照

- **WHEN** 远端 changelog 加载成功且解析出亮点
- **THEN** 亮点数据来自远端，内置快照不参与

#### Scenario: 双源皆不可用静默跳过

- **WHEN** 远端不可用且内置快照缺失或为空
- **THEN** 应用不弹任何错误提示，正常继续运行

### Requirement: 数据源失败不产生重复请求

版本亮点数据加载 SHALL 在一次版本变更检查内只发起有限次请求；数据源失败 MUST NOT 触发无限重试或请求风暴。

#### Scenario: 失败后不风暴重试

- **WHEN** 远端 changelog 请求失败且回退完成
- **THEN** 同一版本变更检查周期内不再对远端发起重复请求