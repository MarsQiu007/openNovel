# Spec Delta

## ADDED Requirements

### Requirement: 对话式学习入库保持 unverified 初始状态

通过写作 agent 在对话学习流程中调用入库工具保存的技法,SHALL 以 `unverified` 状态、0.5 置信度存储,与 LLM 提取管线路径一致;入库工具 MUST 复用模糊指令黑名单与无证据过滤,被拒绝的候选 MUST 在工具返回中说明原因。

#### Scenario: 工具落库初始状态

- **WHEN** agent 在学习流程中保存一条合法技法
- **THEN** 该技法以 `unverified`/0.5 存入技法库,可在 App 技法库面板查看

#### Scenario: 模糊指令候选被工具拒绝

- **WHEN** agent 保存的技法 instruction 命中模糊措辞黑名单或无证据
- **THEN** 工具拒绝入库并在返回中给出原因,技法库无变更

### Requirement: 同名合并保留已有状态与置信度

同名技法入库时 SHALL 合并证据条目(按 excerpt 去重),且 MUST NOT 改动已有条目的 `status` 与 `confidence`——尤其不得把 `verified` 条目降级为 `unverified`。

#### Scenario: 合并证据且保留已验证状态

- **WHEN** 新候选与库中 `verified` 技法同名
- **THEN** 证据合并到已有条目,该条目保持 `verified` 状态与原置信度

#### Scenario: 重复证据不去重失败

- **WHEN** 合并来源的证据与已有证据 excerpt 相同
- **THEN** 证据列表中该 excerpt 只出现一次
