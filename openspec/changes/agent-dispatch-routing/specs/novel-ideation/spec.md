# Spec Delta

## MODIFIED Requirements

### Requirement: director 路由明确创意请求

director SHALL 按用户意图而非固定关键词表决定是否调度创意家：用户请求创意发散、多个候选方案、灵感点子或开书方案时（无论具体措辞，如"给几个剧情方向""来点创意""帮我想点新剧情""生成几个方向"）SHALL 调度创意家；普通剧情问答、单一建议、设定查询、章节执行和写作流水线 SHALL NOT 自动触发创意家。

#### Scenario: 明确创意请求

- **WHEN** 用户要求"给几个剧情方向""帮我想几个角色""提供素材点子"或"帮我构思新书方案"
- **THEN** director 调度创意家并把用户约束和当前模式传给它

#### Scenario: 关键词表之外的创意措辞

- **WHEN** 用户用"来点创意""生成几个方向""帮我想点新花样"等措辞请求多个候选方案
- **THEN** director 识别出发散候选意图并调度创意家，而不是因措辞不在关键词表内就自己直接回答

#### Scenario: 普通剧情讨论

- **WHEN** 用户只是询问已有剧情、设定或写作建议，没有要求发散候选方案
- **THEN** director 不调度创意家，按普通对话或查询流程响应

### Requirement: 临时灵感采纳必须二次确认

用户采纳 `plot_spark`、`character_spark` 或 `material_spark` 灵感时，director SHALL 先向用户确认落地方式，SHALL NOT 自动写入任何正式数据。确认后，director SHALL 按影响范围路由：只影响下一章走章节大纲流程；影响支线或角色弧走弧光维护流程；影响整卷或主线走 architect；新增设定走 architect 落库流程；修改既有设定走 director 直改流程（定位已存在实体后用设定修改工具修改并保留级联约束）。

#### Scenario: 不自动落库

- **WHEN** 创意家返回 3 个角色灵感且用户尚未明确选择
- **THEN** director 不创建角色记录，也不调用任何设定写入工具

#### Scenario: 只影响下一章

- **WHEN** 用户确认的剧情灵感只改变下一章的推进方式
- **THEN** director 使用章节大纲流程更新或生成对应章节大纲

#### Scenario: 影响更大结构

- **WHEN** 用户确认的剧情灵感会改变支线、角色弧、卷纲或主线
- **THEN** director 交给弧光维护流程或 architect，而不是直接写入章节正文

#### Scenario: 新增设定

- **WHEN** 用户确认某个世界观或角色灵感应成为正式设定且该设定为新实体
- **THEN** director 调度 architect 生成内容并落库，保持既有校验、确认门和级联约束

#### Scenario: 修改既有设定

- **WHEN** 用户确认将灵感合并进一个已存在的设定条目
- **THEN** director 自己定位该条目并完成修改，随后按既有规则执行级联影响检查
