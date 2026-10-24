# memory-panel Specification

## Purpose
让作者在书籍工作台中查看、确认、修正 AI 沉淀的记忆卡并直接登记手记，使记忆系统（agent 学到的流动知识）有作者侧的人工闸门与可见性，完成「流动知识 → 作者确认的固化知识」上升管道的最后一公里。

## Requirements

### Requirement: 记忆卡列表与过滤

用户 SHALL 能在书籍工作台的记忆面板查看本书全部记忆卡，并按状态（pending/reviewed/approved/stale/retired）、事实类型、所属章节与关键词过滤；列表 SHALL 分页加载。列表项 SHALL 展示事实陈述、状态、确认度、出处章节与引句。

#### Scenario: 按状态过滤

- **WHEN** 用户选择状态过滤「stale」
- **THEN** 列表只保留状态为 stale 的记忆卡

#### Scenario: 关键词过滤

- **WHEN** 用户输入关键词
- **THEN** 列表只保留事实陈述或引句包含该关键词的记忆卡

#### Scenario: 空列表

- **WHEN** 当前过滤条件下没有任何记忆卡
- **THEN** 面板显示明确的空状态，而不是报错或白屏

### Requirement: 待办计数徽标

记忆面板入口 SHALL 显示待处理记忆卡（pending/reviewed/stale）的计数徽标，计数随列表操作实时刷新。

#### Scenario: 审批后徽标递减

- **WHEN** 用户在面板中批准一张 pending 记忆卡
- **THEN** 入口徽标计数减一，无需手动刷新

### Requirement: 记忆卡编辑与状态流转

用户 SHALL 能对单张记忆卡执行：修正事实陈述文本、批准（→ approved）、作废（→ retired，留痕不删除）。retired 卡 SHALL 仍可在列表中查看但默认被过滤隐藏。

#### Scenario: 批准记忆卡

- **WHEN** 用户对一张 pending 或 reviewed 记忆卡执行批准
- **THEN** 该卡状态变为 approved，并参与后续写作注入召回

#### Scenario: 作废留痕

- **WHEN** 用户对一张记忆卡执行作废
- **THEN** 该卡状态变为 retired，数据行保留不删除，默认视图中不再出现

### Requirement: 撤销整理合并

被事件驱动整理合并而退休的记忆卡（带合并去向留痕）SHALL 能被恢复；恢复后该卡回到 pending 状态并清除合并去向标记，重新走生命周期。

#### Scenario: 恢复被并卡

- **WHEN** 用户对一张带合并去向留痕的 retired 卡执行撤销合并
- **THEN** 该卡状态变为 pending、合并去向清空，且不再随保留卡隐藏

### Requirement: 作者手记登记

用户 SHALL 能直接登记手记事实卡（创建者标记为作者），事实陈述必填；SHALL 能可选地填写原文引句与所属章节作为出处锚点。手记卡创建后进入 pending 状态，与 observer 提取卡走同一生命周期。

#### Scenario: 登记无锚点手记

- **WHEN** 用户只填写事实陈述并提交
- **THEN** 系统创建一张作者手记卡，出处章节与引句为空

#### Scenario: 登记带出处手记

- **WHEN** 用户填写事实陈述并附带引句与章节
- **THEN** 系统创建的手记卡携带该引句与章节锚点，后续正文修订可据此判定失效

### Requirement: 维护报告展示

记忆面板 SHALL 展示记忆维护报告：僵尸卡（stale 失效未消化）清单、planned 设定滞留提醒、retired 归档统计。报告 SHALL 为只读展示，不提供任何自动删除操作。

#### Scenario: 查看僵尸卡清单

- **WHEN** 本书存在 stale 状态的记忆卡
- **THEN** 维护报告区列出这些卡及其出处章节

#### Scenario: 报告无自动动作

- **WHEN** 维护报告显示任何异常项
- **THEN** 面板只呈现信息与计数，不执行也不提供一键清理按钮

### Requirement: 交给 AI 处理通道

用户 SHALL 能把记忆卡的证据与备注拼成指令发送到本书绑定会话，要求 AI 核实或修正该卡；通道行为与设定审查收件箱的「交给 AI 处理」一致。

#### Scenario: 移交记忆卡

- **WHEN** 用户对一张记忆卡选择「交给 AI 处理」并填写备注
- **THEN** 系统将该卡的事实陈述、引句、出处与备注拼成指令发送到绑定会话

### Requirement: 设定树挂载

记忆面板 SHALL 挂载在设定树「AI 设定」节，与「整理」「技法库」节点并列；选中态按书持久化。

#### Scenario: 节点切换

- **WHEN** 用户在设定树选中「记忆」节点
- **THEN** 中央区显示记忆面板，且重新打开该书时恢复选中该节点
