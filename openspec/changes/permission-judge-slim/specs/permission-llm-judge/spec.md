# permission-llm-judge Delta

## MODIFIED Requirements

### Requirement: 按动作分类的裁判策略表

系统 SHALL 以内置常量表为权限动作维护 judge / allow / ask 三档策略，并在规则引擎判定 ask 后按策略分流：策略为 allow 的请求直接执行，策略为 ask 的请求直接走人审，策略为 judge 的请求进入裁判。内置默认策略 SHALL 为：bash、edit、write、apply_patch、webfetch、websearch、browser 族、skill、codemode 判 judge；read、glob、grep、question、todowrite 判 allow；subagent 判 ask；未列出的动作缺省判 ask。策略表 SHALL NOT 提供任何用户配置入口（配置文件、界面或其他覆盖通道均不得改动内置表）。策略分流 SHALL 只作用于缺省 ask（无规则匹配）；显式 ask 规则匹配的请求 SHALL 直接走人审，不被策略升级为 allow 或 judge。

#### Scenario: 执行族命令进入裁判

- **WHEN** 规则引擎对一条 bash 命令请求给出 ask 判定且全局模式不是纯 ask
- **THEN** 该请求被送交 LLM 裁判而非直接弹人审

#### Scenario: 只读工具确定性放行

- **WHEN** 一个 glob 请求未命中任何 agent 规则
- **THEN** 系统按内置策略表直接放行，不产生裁判调用也不弹人审

#### Scenario: 未列动作保守回落

- **WHEN** 一个内置策略表未列出的动作（如 MCP 工具）被规则引擎判为 ask
- **THEN** 该请求直接走人审，不经过裁判

#### Scenario: 配置覆盖不生效

- **WHEN** 配置文件中书写针对某动作的策略覆盖（如 `permission.policy`）
- **THEN** 该书写被忽略，分流结果始终以内置策略表为准

### Requirement: 全局模式开关与影子模式

系统 SHALL 提供 `permission.mode` 开关，取值为 `ask`（全人审，默认）/ `judge-shadow` / `judge`，并 SHALL NOT 支持按 agent 覆盖。`judge-shadow` 模式下裁判 SHALL 照常裁决，但被审请求仍弹人审，且界面 SHALL 展示裁判建议；系统 SHALL 记录裁判建议与人审结果的一致率供翻转为强制模式决策。项目级配置 SHALL NOT 单独启用 `judge` 或 `judge-shadow`：仅项目级配置出现裁判模式取值且用户级（全局配置）未启用裁判模式时，该取值 SHALL 不生效并按 `ask` 处理；项目级配置将模式收严为 `ask` 的取值 SHALL 正常生效（收严方向不受限）。

#### Scenario: 默认零行为变化

- **WHEN** `permission.mode` 未设置或设为 `ask`
- **THEN** 不产生裁判调用，权限判定与人审链路和无裁判时一致（拒绝理由对模型可见的配套修复除外）

#### Scenario: 影子模式双轨运行

- **WHEN** `permission.mode` 为 `judge-shadow` 且裁判建议放行
- **THEN** 请求仍弹人审，审批界面标注裁判建议为放行
- **AND** 系统记录该次裁判建议与人审结果是否一致

#### Scenario: 项目级单独启用裁判模式不生效

- **WHEN** 项目级 opennovel.json 将 `permission.mode` 设为 `judge` 或 `judge-shadow`，且全局配置未启用裁判模式
- **THEN** 该会话权限链路按 `ask` 处理，不产生裁判调用，界面提示项目配置中的裁判模式取值未生效

#### Scenario: 项目级收严为手动审批生效

- **WHEN** 全局配置为 `judge` 而项目级 opennovel.json 将 `permission.mode` 设为 `ask`
- **THEN** 该目录下的会话按 `ask` 处理，权限请求回到人审

#### Scenario: 按 agent 覆盖全局模式

- **WHEN** 某 agent 配置段书写了与全局不同的 `permission.mode`
- **THEN** 该书写被忽略，会话按全局与项目级解析出的模式处理
