# Spec Delta

## MODIFIED Requirements

### Requirement: 全局模式开关与影子模式

系统 SHALL 提供 `permission.mode` 开关，取值为 `ask`（全人审，默认）/ `judge-shadow` / `judge`，并 SHALL 支持按 agent 覆盖。`judge-shadow` 模式下裁判 SHALL 照常裁决，但被审请求仍弹人审，且界面 SHALL 展示裁判建议；系统 SHALL 记录裁判建议与人审结果的一致率供翻转为强制模式决策。项目级配置 SHALL NOT 单独启用 `judge` 或 `judge-shadow`：仅项目级配置出现裁判模式取值且用户级（全局配置或 agent 配置）未启用裁判模式时，该取值 SHALL 不生效并按 `ask` 处理；项目级配置将模式收严为 `ask` 的取值 SHALL 正常生效（收严方向不受限）。

#### Scenario: 默认零行为变化

- **WHEN** `permission.mode` 未设置或设为 `ask`
- **THEN** 不产生裁判调用，权限判定与人审链路和无裁判时一致（拒绝理由对模型可见的配套修复除外）

#### Scenario: 影子模式双轨运行

- **WHEN** `permission.mode` 为 `judge-shadow` 且裁判建议放行
- **THEN** 请求仍弹人审，审批界面标注裁判建议为放行
- **AND** 系统记录该次裁判建议与人审结果是否一致

#### Scenario: 按 agent 覆盖全局模式

- **WHEN** 某 agent 配置了与全局不同的 `permission.mode`
- **THEN** 该 agent 会话内的权限请求按 agent 级模式处理

#### Scenario: 项目级单独启用裁判模式不生效

- **WHEN** 项目级 opennovel.json 将 `permission.mode` 设为 `judge` 或 `judge-shadow`，且全局配置与该会话 agent 配置均未启用裁判模式
- **THEN** 该会话权限链路按 `ask` 处理，不产生裁判调用，界面提示项目配置中的裁判模式取值未生效

#### Scenario: 项目级收严为手动审批生效

- **WHEN** 全局配置为 `judge` 而项目级 opennovel.json 将 `permission.mode` 设为 `ask`
- **THEN** 该目录下的会话按 `ask` 处理，权限请求回到人审
