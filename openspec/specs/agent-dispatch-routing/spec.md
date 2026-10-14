# agent-dispatch-routing Specification

## Purpose

约束 director 把生成类任务调度到专职子 agent（章节大纲→outliner、新设定→architect、创意发散→ideator），并以权限收敛和静态校验保证路由与调度表长期一致，防止主 agent 越权代劳导致专职 agent 产线（含跨章事件段规则）失效。

## Requirements

### Requirement: 章节大纲生成调度 outliner

director SHALL 在用户请求生成、重新生成或批量生成章节大纲时通过 task 工具调度 @outliner 子 agent（传入 novel_id、chapter_number 和用户原始约束），由 @outliner 组装上下文快照并调用大纲落库工具持久化。director SHALL NOT 自己撰写大纲内容后直接落库。批量生成 SHALL 逐章调度。

#### Scenario: 生成单章大纲

- **WHEN** 用户说"生成第X章大纲"或"生成大纲"
- **THEN** director 调度 @outliner 生成并落库章节大纲，自己不撰写大纲内容

#### Scenario: 重新生成已有章纲

- **WHEN** 用户要求重新生成某章大纲且该章已有大纲记录
- **THEN** director 仍调度 @outliner，落库工具按章节序号幂等更新原记录

#### Scenario: 批量生成

- **WHEN** 用户要求一次生成多章大纲
- **THEN** director 逐章调度 @outliner，每章独立生成落库

#### Scenario: 卷大纲例外

- **WHEN** 用户要求生成或更新卷大纲
- **THEN** director 可使用卷大纲工具直接写入实际内容（无专职卷大纲 agent 的显式例外）

### Requirement: 新增设定调度 architect 与修改设定由 director 执行

director SHALL 将"新增设定实体"（为数据库中不存在的角色、世界观条目、关系、剧情线或伏笔从零生成内容）调度 @architect 落库；已存在实体的字段修改（改名、补充描述、状态调整）SHALL 由 director 自己定位并修改，保留确认门与级联统改约束。新旧判定以设定列表查询的存在性为准，不以模型记忆为准。

#### Scenario: 新增设定实体

- **WHEN** 用户要求生成一个新的角色、世界观条目、关系或剧情线设定
- **THEN** director 调度 @architect 生成内容并落库，自己不直接调用批量设定写入工具生成新实体

#### Scenario: 修改已存在实体

- **WHEN** 用户要求修改一个已存在于库中的设定条目
- **THEN** director 自己调用设定修改工具完成修改，并按既有规则跑级联影响检查

#### Scenario: 灵感采纳新增设定

- **WHEN** 用户确认把一条候选灵感转为正式设定且该设定为新实体
- **THEN** director 调度 @architect 落库，而不是自己直接写入

### Requirement: director 大纲落库权限收敛

系统 SHALL 将 director 的章节大纲落库工具权限标记为 deny（精确规则优先于通配规则），使 director 直接调用该工具时被拒绝；@outliner SHALL 保持该工具 allow。工具描述 SHALL 保持职责中性，不将大纲内容归属为 director 生成。

#### Scenario: director 直调被拒

- **WHEN** director 尝试直接调用章节大纲落库工具
- **THEN** 权限层拒绝执行并给出拒绝信息，director 转而调度 @outliner

#### Scenario: outliner 正常落库

- **WHEN** @outliner 生成创作意图后调用章节大纲落库工具
- **THEN** 工具正常执行并持久化大纲

#### Scenario: 工具描述不归属 director

- **WHEN** 读取章节大纲落库工具的描述文案
- **THEN** 描述不包含"由 director 生成大纲内容"类归属措辞

### Requirement: 路由与调度一致性静态校验

系统 SHALL 提供针对 director 提示词与 agent 权限表的静态校验测试，断言：章节大纲生成路由指向 @outliner、创意发散路由按意图判定、调度表声明的 @outliner/@ideator/@architect 职责与路由段无"表上派给子 agent、路由却自己动手"的矛盾，以及 director 的大纲落库权限为 deny。提示词或权限表回退到代劳写法时测试 SHALL 失败。

#### Scenario: 当前实现通过校验

- **WHEN** 运行一致性静态校验测试
- **THEN** 全部断言通过

#### Scenario: 路由回退被捕获

- **WHEN** 有人把大纲路由改回"director 自己撰写大纲内容"或把权限改回 allow
- **THEN** 静态校验测试失败并指出回退位置
