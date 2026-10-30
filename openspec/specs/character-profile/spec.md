# character-profile Specification

## Purpose
定义角色定制档案能力：角色设定从单条自由文本升级为结构化多维档案，覆盖存储形态、录入面（UI + 工具塑造操作）、初始化产出与写作注入契约，保证写作过程逐维度考虑角色设定而非依赖整段描述的碰运气式注入。

## Requirements

### Requirement: 角色档案结构化存储

角色 SHALL 支持结构化档案，核心维度为：身体特征（appearance）、说话习惯（speech，含口头禅与语癖）、语气（tone）、个性（personality）、习惯动作（mannerism）；SHALL 支持用户自定义扩展项（键值对）。档案与既有 `description` 并存：description 语义保持不变，档案为空的角色行为与现状一致。

#### Scenario: 逐维度录入与保存

- **WHEN** 用户在角色面板填写说话习惯「句尾总带『哼』」并保存
- **THEN** 该值以 speech 维度持久化，重新打开面板后原样回显，description 不受影响

#### Scenario: 空档案角色行为不变

- **WHEN** 存量角色未填写任何档案维度
- **THEN** 该角色的召回、快照注入、审计行为与建档前一致，不报错不产生空字段噪音

### Requirement: 档案塑造操作

角色档案 SHALL 支持细粒度塑造操作：按维度更新、删除某维度、自定义扩展项的增删改——通过 agent 工具与 UI 两条路径均可完成；工具塑造操作沿用设定影响面体系，SHALL NOT 绕过既有 pending_settings 流程。

#### Scenario: 单维度更新不整包重写

- **WHEN** agent 收到「把林天的说话习惯改成更简短生硬」的反馈并调用塑造操作
- **THEN** 仅 speech 维度被更新，其余维度与 description 保持不变

#### Scenario: 扩展项增删

- **WHEN** 用户要求为角色增加自定义维度「武器风格：双手重剑」
- **THEN** 扩展项以键值对形式持久化并可按同样方式删除或修改

### Requirement: 初始化产出档案

architect 创建或完善角色时 SHALL 按档案 schema 逐维度产出内容；核心维度逐项可由用户要求，SHALL NOT 将可结构化的设定只写进 description 而绕过档案。

#### Scenario: 新角色建档

- **WHEN** 用户要求创建「左脸有疤、句尾带哼声、外冷内热」的角色
- **THEN** architect 将三项分别落入 appearance、speech、personality 维度并落库，而非拼接进 description

### Requirement: 写作注入分字段渲染

写作快照的活跃角色段 SHALL 分字段渲染档案：核心四维（appearance/speech/tone/personality）逐项前置注入；习惯动作（mannerism）与自定义扩展 SHALL 降频注入（次要行，供场景相关时参考）；writer 对话辨识度规则 SHALL 引用档案字段。仅有 description 无档案的角色 SHALL 按现状整段注入。

#### Scenario: 核心维度前置

- **WHEN** 活跃角色的 speech 维度为「句尾总带『哼』」
- **THEN** 快照该角色行中说话习惯以独立字段呈现，writer 生成其对话时可见

#### Scenario: 习惯动作降频

- **WHEN** 角色 mannerism 为「思考时摩挲左手拇指指环」而本章场景与其无直接关联
- **THEN** 该条目出现在次要行不挤占核心维度位置，writer 在描写该角色动作细节时可参考

#### Scenario: 混合书库兼容

- **WHEN** 同一本书中角色 A 已建档、角色 B 仅有 description
- **THEN** 快照中 A 分字段渲染、B 整段渲染，两者同段共存不互相干扰
