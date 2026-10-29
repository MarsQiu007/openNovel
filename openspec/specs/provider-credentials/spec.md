# provider-credentials Specification

## Purpose
保证 LLM provider 的 API key 在设置界面与 V2 会话运行时之间一致可用：界面保存/移除凭据时两侧凭据存储同步变化，V2 会话运行时按统一优先级解析 key，存量安装无需手工迁移凭据。

## Requirements

### Requirement: 设置界面保存 API key 后两侧凭据存储一致

用户通过设置界面为某个 provider 保存 API key 后，系统 SHALL 同时更新旧版凭据存储与 Integration 凭据库中该 provider 对应的凭据，且两侧值一致；此后该 provider 的 V2 会话 SHALL 在模型请求中携带该 key 的 Authorization 头。

#### Scenario: 保存后 V2 会话即可认证

- **WHEN** 用户在设置界面为自定义 provider 保存 API key，并在该 provider 的模型上发起新的 V2 会话
- **THEN** 模型请求携带该 key 的 Authorization 头，不再出现因缺失凭据导致的认证错误

#### Scenario: 重复保存新 key 后旧 key 不再被使用

- **WHEN** 用户为同一 provider 再次保存不同的 API key
- **THEN** 后续 V2 会话使用新 key 发起请求，任何一侧存储都不再提供旧 key

### Requirement: 移除 provider 凭据时两侧同步移除

用户移除某个 provider 的凭据后，系统 SHALL 同时从旧版凭据存储与 Integration 凭据库中移除该 provider 的对应凭据；移除后 V2 会话运行时 SHALL 不再解析到该 key，且不得从另一侧存储回流出已移除的 key。

#### Scenario: 移除后运行时解析不到 key

- **WHEN** 用户移除某 provider 的凭据，之后该 provider 发起 V2 会话
- **THEN** 模型请求不带该 provider 的 Authorization 头，表现为无凭据而非凭据复活

#### Scenario: 移除 OAuth 类型条目也会清空该 provider 的凭据库

- **WHEN** 某 provider 在凭据库存有 API key，且用户在旧版凭据存储中移除该 provider 的 OAuth 类型条目（登出）
- **THEN** 凭据库中该 provider 的凭据一并被清除，后续 V2 会话不再带 Authorization 头

#### Scenario: 移除未知 provider 不触碰凭据库

- **WHEN** 用户对旧版凭据存储中不存在的 provider 执行移除
- **THEN** 凭据库内容不变

### Requirement: 保存非 API key 类型的条目不写入凭据库

用户通过设置界面保存 OAuth 或 wellknown 类型条目时，系统 SHALL NOT 新增或替换 Integration 凭据库中的凭据，也 SHALL NOT 删除该 provider 已有的凭据；只有 API key 类型的条目参与双写。

#### Scenario: 保存 OAuth 条目不覆盖凭据库中的 API key

- **WHEN** 某 provider 在凭据库中已有 API key，随后 OAuth 流程再次保存该 provider 的 OAuth 类型条目
- **THEN** 凭据库中该 provider 的凭据保持不变，OAuth token 刷新不会清空或覆盖它

### Requirement: 仅旧版存储有 key 的 provider 参与模型可用性判定

模型可用性判定在 Integration 凭据库中该 provider 没有任何凭据时，SHALL 把旧版凭据存储中该 provider 的 API key 条目视为已连接；旧版存储中的 OAuth 或 wellknown 类型条目 SHALL NOT 影响可用性。该判定 SHALL NOT 写入凭据库或发布连接更新事件。

#### Scenario: 升级后存量 provider 仍可选中并发起会话

- **WHEN** 某 provider 仅在旧版凭据存储中存有 API key（凭据库为空），用户打开模型选择并选择其模型发起 V2 会话
- **THEN** 该 provider 及其模型出现在可用模型中，会话解析到该 key 并在请求中携带 Authorization 头

### Requirement: 凭据库未命中时运行时回退旧版凭据存储

V2 会话运行时解析 provider 的 key 时，若 Integration 凭据库中该 provider 没有任何凭据，系统 SHALL 回退到旧版凭据存储中该 provider 的 API key 条目完成解析；回退命中后系统 SHALL 将该 key 写入 Integration 凭据库，使后续解析直接命中凭据库。若凭据库中已有该 provider 的凭据，则 SHALL 以凭据库为准，不再读取旧版存储。

#### Scenario: 仅旧版存储存有 key 的存量 provider 免迁移可用

- **WHEN** 某 provider 仅在旧版凭据存储中存有 API key（升级前配置，未做任何迁移），用户在其模型上发起 V2 会话
- **THEN** 模型请求携带该 key 的 Authorization 头

#### Scenario: 回退命中后凭据库收敛

- **WHEN** 某 provider 首次因凭据库为空而回退命中旧版存储中的 API key，并成功发起 V2 会话
- **THEN** 凭据库中出现该 provider 的凭据，后续解析直接以凭据库为准，不再依赖旧版存储

#### Scenario: 并发首次解析不产生失效凭据

- **WHEN** 同一 provider 的两个 V2 解析在凭据库为空时并发触发回退
- **THEN** 两个解析都得到可用的 key，且凭据库中该 provider 只保留一份可被解析到的最新凭据

#### Scenario: 两库同时存在时凭据库优先

- **WHEN** 某 provider 在 Integration 凭据库与旧版凭据存储中同时存在不同的 key
- **THEN** V2 会话使用凭据库中的 key 发起请求

#### Scenario: 旧版存储无对应条目时解析为空

- **WHEN** 某 provider 在 Integration 凭据库中无凭据，且在旧版凭据存储中没有任何条目
- **THEN** 运行时解析不到 key，模型请求不带 Authorization 头

### Requirement: 旧版存储中的非 API key 条目不参与回退

运行时回退旧版凭据存储时，系统 SHALL 仅使用 API key 类型的条目；旧版存储中的 OAuth 或 wellknown 类型条目 SHALL NOT 被当作 API key 参与 V2 会话的 key 解析。

#### Scenario: OAuth 条目不回退为 key

- **WHEN** 某 provider 在 Integration 凭据库中无凭据，仅在旧版凭据存储中有一个 OAuth 类型条目
- **THEN** V2 会话运行时解析不到 API key，模型请求不带 Authorization 头
