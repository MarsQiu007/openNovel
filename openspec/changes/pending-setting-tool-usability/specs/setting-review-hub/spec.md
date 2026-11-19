# setting-review-hub (Delta)

## Modified Requirements

### Requirement: 候选审阅复用既有操作语义

收件箱对候选条目 SHALL 提供接受、拒绝与合并操作，并与 agent 工具共用同一套共享服务实现（单一事实源）；接受候选 SHALL 保持既有行为：写入对应正式表、执行引用扫描与统一影响面联动、置候选状态。接受 relationship 类型候选时 MUST 先将候选 payload 中的临时角色 ID 解析为角色正式表中的实际 ID 再写入关系表（多级解析：直接 ID 查找 → 已接受角色候选反查角色名 → 角色表按名查找）；两级都失败时报明确错误（含候选 ID 与临时角色 ID），不抛未处理的外键约束异常。

#### Scenario: UI 接受候选与工具行为一致

- **WHEN** 用户在收件箱接受一条候选
- **THEN** 正式表写入、引用扫描与影响面联动与 agent 工具接受同一候选时完全一致

#### Scenario: 合并候选

- **WHEN** 用户选择多条同类候选执行合并
- **THEN** 生成一个新的正式条目，源候选置为 merged 并记录合并去向

#### Scenario: 接受 relationship 候选成功（直接 ID 命中）

- **WHEN** agent 或用户接受一条 relationship 类型候选，其 char_a_id 与角色候选接受时使用的 suggested_entity_id 一致
- **THEN** 直接在角色正式表中命中该 ID，写入关系表，接受成功且无外键约束异常

#### Scenario: 接受 relationship 候选成功（候选反查命中）

- **WHEN** relationship 候选的 char_a_id 在角色正式表中不存在，但存在一条 status=accepted 且 suggested_entity_id 与之匹配的角色候选
- **THEN** 系统从该角色候选的 payload.name 取角色名，到角色正式表按名查找实际 ID 后写入关系表，接受成功且无外键约束异常

#### Scenario: relationship 候选引用的角色不存在

- **WHEN** 关系候选的 char_a_id 或 char_b_id 无法通过直接 ID 查找和角色候选反查解析为任何正式角色
- **THEN** 工具返回明确错误（含候选 ID 和临时角色 ID），提示先接受对应角色候选，候选状态不变，不产生外键约束异常

## Added Requirements

### Requirement: 候选列表返回完整标识

`list_pending_settings` 工具 SHALL 在展示文本中携带完整 UUID 格式的候选 ID（而非 8 字符短前缀），agent 可直接从展示文本取完整 ID 用于后续调用。`accept_pending_setting` 的 pending_id 参数 SHALL 同时支持完整 UUID 和 8 字符前缀匹配（前缀命中多条时报歧义错误）。工具 SHALL 支持 status 枚举包含 `all` 值以一次性查看全部状态的候选；缺省值保持 `pending` 不变。

#### Scenario: 列表展示完整 ID

- **WHEN** agent 调用 `list_pending_settings` 查看候选
- **THEN** 展示文本中每条候选的 ID 为完整 UUID，agent 可直接从输出文本中复制该 ID 调用 `accept_pending_setting`

#### Scenario: accept 支持前缀匹配

- **WHEN** agent 使用 8 字符短前缀（如 `4a0a1eea`）调用 `accept_pending_setting`
- **THEN** 若前缀恰好匹配一条候选则直接接受成功；若匹配多条则返回歧义错误并列出匹配的候选

#### Scenario: 查看 all 状态

- **WHEN** agent 调用 `list_pending_settings` 并传 `status: "all"`
- **THEN** 返回包含 pending、accepted、rejected、merged 四种状态的候选，不产生参数校验失败

### Requirement: 批量接受候选

系统 SHALL 提供 `batch_accept_pending_settings` 工具，接受候选 ID 列表，逐条调用共享服务执行接受，返回每条候选的接受结果（成功 / 失败 / 原因）。批量工具 SHALL 复用 `accept_pending_setting` 的同一服务实现（含 relationship 角色 ID 解析与引用扫描），不引入第二套接受逻辑。部分失败时不回滚已成功的候选，返回结构中标记各条结果。

#### Scenario: 批量接受全部成功

- **WHEN** agent 传入 3 条有效的候选 ID 调用 `batch_accept_pending_settings`
- **THEN** 3 条候选全部接受成功，返回结构中每条结果为成功

#### Scenario: 批量接受部分失败

- **WHEN** agent 传入 3 条候选 ID，其中 1 条的 relationship 角色解析失败
- **THEN** 2 条有效候选接受成功，1 条失败并返回原因（含候选 ID 和错误信息），已成功的候选不回滚

### Requirement: 收件箱徽标与条目状态可见性

设定收件箱的徽标计数 SHALL 只统计待审（pending）状态的候选条目，已接受、已拒绝或已合并的候选不再计入徽标。收件箱列表 SHALL 在默认状态下只显示待审条目；每个条目 SHALL 渲染状态标识，使用户可以区分待审与已处理。用户 SHALL 可以通过「显示已处理」开关查看已接受、已拒绝或已合并的条目。

#### Scenario: 徽标只计 pending

- **WHEN** 某本书有 3 条 pending 候选、5 条已接受候选、2 条已拒绝候选
- **THEN** 收件箱徽标显示 3，已接受和已拒绝的候选不计入

#### Scenario: 接受后徽标递减

- **WHEN** 用户接受一条 pending 候选
- **THEN** 徽标计数减 1，该候选从默认列表中消失，不再出现在待审视图

#### Scenario: 显示已处理

- **WHEN** 用户打开「显示已处理」开关
- **THEN** 列表在待审条目之后追加显示已接受、已拒绝和已合并的条目，每条带有对应的状态标识
