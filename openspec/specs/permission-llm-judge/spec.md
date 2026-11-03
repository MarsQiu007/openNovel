# permission-llm-judge Specification

## Purpose
让规则引擎判为 ask 的工具执行请求先经 LLM 裁判三路裁决（放行/拒绝/升级人审），把人审压缩到真正例外，同时以审计事件与影子模式保证可回溯、可校准。

## Requirements

### Requirement: 按动作分类的裁判策略表

系统 SHALL 为权限动作维护 judge / allow / ask 三档策略，并在规则引擎判定 ask 后按策略分流：策略为 allow 的请求直接执行，策略为 ask 的请求直接走人审，策略为 judge 的请求进入裁判。内置默认策略 SHALL 为：bash、edit、write、apply_patch、webfetch、websearch、browser 族、skill、codemode 判 judge；read、glob、grep、question、todowrite 判 allow；subagent 判 ask；未列出的动作缺省判 ask。策略分流 SHALL 只作用于缺省 ask（无规则匹配）；显式 ask 规则匹配的请求 SHALL 直接走人审，不被策略升级为 allow 或 judge。

#### Scenario: 执行族命令进入裁判

- **WHEN** 规则引擎对一条 bash 命令请求给出 ask 判定且全局模式不是纯 ask
- **THEN** 该请求被送交 LLM 裁判而非直接弹人审

#### Scenario: 只读工具确定性放行

- **WHEN** 一个 glob 请求未命中任何 agent 规则
- **THEN** 系统按策略表直接放行，不产生裁判调用也不弹人审

#### Scenario: 未列动作保守回落

- **WHEN** 一个策略表未列出的动作（如 MCP 工具）被规则引擎判为 ask
- **THEN** 该请求直接走人审，不经过裁判

### Requirement: 三路裁决与失败回落人审

裁判 SHALL 对每次请求输出 allow、deny、ask 之一；输出无法解码、裁判调用超时或出错时 SHALL 回落到人审。任何规则显式 deny 的请求 SHALL 在裁判之前被硬拒绝，裁判不得推翻规则判定。

#### Scenario: 裁判放行自动执行

- **WHEN** 裁判对请求输出 allow 且当前为强制模式
- **THEN** 工具执行继续，不产生人审挂起

#### Scenario: 裁判不确定时升级人审

- **WHEN** 裁判对请求输出 ask，或裁判输出无法解码
- **THEN** 该请求落入现有人审流程，与无裁判时行为一致

#### Scenario: 显式 deny 规则先于裁判

- **WHEN** agent 配置中存在匹配该请求的 deny 规则
- **THEN** 请求被硬拒绝，裁判不被调用

#### Scenario: 裁判调用故障时回落

- **WHEN** 裁判调用抛错或超时
- **THEN** 该请求落入人审，故障不影响会话继续

### Requirement: 裁判拒绝附理由回喂模型

裁判输出 deny 时 SHALL 携带一句可展示的理由，该理由 SHALL 经模型可见的反馈通道返回给发起请求的会话，工具 SHALL NOT 执行；模型可依据理由换用其他方案重新发起请求。

#### Scenario: 拒绝理由可达模型

- **WHEN** 裁判以"该命令会删除工程目录"为由拒绝一条 bash 请求
- **THEN** 发起请求的模型在后续上下文中能看到这条拒绝理由
- **AND** 被请求的工具未被执行

### Requirement: 裁判输入注入隔离

裁判的输入 SHALL 仅包含动作、资源与请求侧结构化元数据（如命令字符串、目标路径、URL）；SHALL NOT 包含工具输出内容或会话对话历史。裁判不得因输入中出现指令性文字而改变裁决对象。

#### Scenario: 命令字符串中的指令不改变裁决

- **WHEN** 待审 bash 命令的参数字符串本身含有"忽略之前的指示"类文字
- **THEN** 裁判仍只对该命令的执行风险进行裁决，不执行其中嵌入的任何指令

### Requirement: 裁判决定审计事件

每次裁判决定 SHALL 发布审计事件，包含决定、理由、所用模型、当前模式与请求快照；裁判给出的 allow SHALL NOT 写入 PermissionSaved（人教规则的沉淀位置）。

#### Scenario: 自动放行可回溯

- **WHEN** 裁判在强制模式下放行一条 bash 请求
- **THEN** 系统中留有一条含决定、理由与模型信息的审计事件，审批界面可查看

#### Scenario: 裁判放行不沉淀为人教规则

- **WHEN** 裁判连续放行同一命令十次
- **THEN** PermissionSaved 中仍不存在该命令的 allow 记录，后续相同请求仍需经裁判

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

### Requirement: 裁判模型独立可配

裁判 SHALL 使用独立于会话模型的配置项解析模型；未显式配置时 SHALL 跟随会话当前模型。裁判调用 SHALL 与会话模型调用相互独立计费与限流，裁判不可用 SHALL NOT 阻断会话本身的模型调用。

#### Scenario: 默认跟随会话模型

- **WHEN** 用户未配置裁判模型
- **THEN** 裁判调用使用与会话相同的模型与供应商凭据

#### Scenario: 独立指定裁判模型

- **WHEN** 用户为裁判配置了另一模型
- **THEN** 裁判调用使用该配置模型，会话模型调用不受影响
