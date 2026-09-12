## Purpose

让用户在设定中心直接查看设定整理问题、审阅版本化整理计划、确认受控执行，并清楚看到执行结果和剩余风险，同时保留 agent 整理路径的安全确认流程。

## ADDED Requirements

### Requirement: 设定中心提供整理报告入口

设定中心 SHALL 提供用户可见的“整理”入口。激活后系统 SHALL 请求当前小说的跨实体整理分析，并展示问题数量、问题类型、实体类型、受影响条目、证据摘要和建议。没有问题时 SHALL 展示“无需整理”状态；加载失败时 SHALL 展示可读错误并允许重试。

#### Scenario: 查看问题报告

- **WHEN** 用户打开设定中心的整理入口且当前小说存在格式、重复或引用风险问题
- **THEN** UI 展示按问题和实体组织的结果，并显示每条问题的证据摘要和建议

#### Scenario: 查看无需整理状态

- **WHEN** 当前小说没有通过分析识别出的问题
- **THEN** UI 展示无需整理状态，不显示执行计划操作

#### Scenario: 分析失败

- **WHEN** 分析请求失败
- **THEN** UI 保持现有设定数据不变，展示错误信息并提供重试入口

### Requirement: AI 一键整理委托受控会话

UI SHALL 提供在有整理问题时可见的 AI 一键整理入口。用户激活后，UI SHALL 将真实 `novel_id`、当前 analyze 返回的问题和条目 ID 发送到该小说的未归档绑定会话；没有绑定会话时 SHALL 创建并绑定新会话。指令 SHALL 明确要求 agent 使用 `organize_settings` 完成 analyze → dry_run → 用户确认 → apply → analyze 复查，SHALL 禁止猜测 `novel_id` 或使用旁路工具直接修改，且 SHALL NOT 代替 agent 的运行时确认。

#### Scenario: 一键整理发送受控指令

- **WHEN** 用户在存在整理问题的小说上点击 AI 一键整理
- **THEN** UI 使用真实 `novel_id` 和 analyze 条目 ID 构造指令，发送到绑定会话，并进入该会话

#### Scenario: 没有绑定会话时创建会话

- **WHEN** 当前小说还没有未归档的绑定会话
- **THEN** UI 创建新会话、绑定当前小说，再发送受控整理指令

#### Scenario: 指令不得绕过受控流程

- **WHEN** AI 接收 UI 一键整理指令
- **THEN** AI 只使用指令中的真实 `novel_id` 和 analyze 返回的条目 ID，先 dry run 并等待用户确认后才 apply

### Requirement: UI 不提供直接执行路径

UI SHALL NOT 提供 plan_json 导入、dry run 预览、确认弹层或直接 apply 按钮。UI SHALL NOT 调用 dry-run 或 apply 端点修改数据；服务端 dry-run / apply 契约保留时，不得因 UI 简化而移除其计划校验和显式确认约束。

#### Scenario: 用户查看整理面板

- **WHEN** 用户打开设定整理面板
- **THEN** UI 只展示 analyze 报告、AI 一键整理和重新分析入口，不出现计划导入或直接执行控件

#### Scenario: 受控流程失败或等待确认

- **WHEN** agent 的 dry run 或 apply 失败，或流程等待运行时确认
- **THEN** UI 不在整理面板中伪造成功结果，由绑定会话展示流程状态、错误和确认请求

### Requirement: Agent 整理流程保持独立受控

新增 UI 路径 SHALL NOT 移除 `organize_settings` 的 analyze、dry_run、运行时确认、apply 和复查行为。agent 通过工具执行 apply 时 SHALL 仍请求运行时用户确认，并遵循现有计划校验和安全约束。

#### Scenario: Agent 执行整理

- **WHEN** AI 请求通过 `organize_settings` 执行计划
- **THEN** 系统仍然弹出运行时确认；确认后才执行，且执行前重新校验计划

#### Scenario: UI 路径不影响 Agent 路径

- **WHEN** 用户在 UI 中完成一次整理后再要求 AI 整理
- **THEN** AI 仍必须从或再次进入 analyze、dry run、确认、apply、复查流程，不继承 UI 的确认结果

### Requirement: 设定整理内容按纯文本展示

整理报告、计划原因、预览和执行结果中的设定长文本 SHALL 按纯文本段落展示，保留换行分段；UI SHALL NOT 对设定文本应用 Markdown 渲染或把列表、标题、链接语法转换为富文本结构。

#### Scenario: 展示分段纯文本

- **WHEN** 报告或计划预览包含包含换行分段的设定文本
- **THEN** UI 按原文段落展示换行，不渲染 Markdown 元素

#### Scenario: 防止语法意外渲染

- **WHEN** 文本中包含类似 Markdown 的符号
- **THEN** UI 将其作为普通字符显示，不生成标题、链接、列表或其他富文本结构
