# Spec Delta

## ADDED Requirements

### Requirement: 技法库列表接口对坏数据行容错
技法库列表接口（`technique.list`）返回的每条技法 MUST 满足 `Technique` 协议契约：`lastUsedAt` 为可缺省字段，存储层 MUST NOT 对从未使用（`last_used_at = NULL`）的技法输出显式 `undefined` 值。当个别行因历史脏数据仍不满足契约时，接口 SHALL 跳过该坏行（记录 WARN 日志，含技法 id 与失败原因）并照常返回其余行，MUST NOT 因单行数据缺陷导致整个列表请求失败；技法库面板 MUST 在接口恢复后正常展示可用条目。

#### Scenario: 从未使用的技法正常列出

- **WHEN** 技法库中存在从未被召回使用（`last_used_at = NULL`）的技法，用户打开书内技法库面板
- **THEN** 列表接口正常返回这些条目（不含显式 undefined 字段），面板逐条展示，不出现"操作失败"

#### Scenario: 单行坏数据不拖垮列表

- **WHEN** 技法库中混入一条证据字段不合协议契约的历史脏数据行，用户打开技法库面板
- **THEN** 接口返回其余合法条目，坏行被跳过并留下 WARN 日志（含技法 id 与原因），面板展示可用条目而非整体报错

### Requirement: 技法证据入库完整性校验
所有入库路径保存的技法，其证据条目 MUST 满足 `TechniqueEvidence` 协议契约（`sourceTitle`、`sourceLocation`、`excerpt`、`annotation` 四字段均为字符串）。对话学习路径（`save_technique`）在写入前 SHALL 经统一的证据规范化：缺 `sourceTitle` 时以 `sourceLocation` 回填、其余缺失字符串字段补空串；规范化后仍不满足契约的候选 MUST 被拒绝入库，并在工具返回中说明原因。存量已入库的脏数据 SHALL 由幂等迁移自动修复，重复执行不产生重复写。

#### Scenario: 缺来源书名的证据被规范化入库

- **WHEN** agent 保存的技法证据缺少 `sourceTitle`，但带有 `sourceLocation`（来源位置/书名）
- **THEN** 入库条目以 `sourceLocation` 回填 `sourceTitle`（其余缺失字段补空串），技法正常入库且后续可被列表接口编码返回

#### Scenario: 不可修复的证据被拒绝

- **WHEN** agent 保存的技法证据缺失关键字段且无法按规则补全（如证据元素不是对象）
- **THEN** 该候选被拒绝入库，工具返回说明原因，技法库无变更

#### Scenario: 存量脏数据被幂等修复

- **WHEN** 数据库中存在缺少 `sourceTitle` 的历史技法行，服务打开数据库连接
- **THEN** 迁移自动回填缺失字段（`sourceTitle` 取 `sourceLocation`、其余补空串）；再次建连时迁移为纯 no-op，已有非空字段不被改写