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

### Requirement: 用户可导入并审阅整理计划

UI SHALL 允许用户导入或粘贴版本化 `plan_json`，并在 dry run 后按操作展示影响预览。每条操作 SHALL 展示动作类型、实体类型、目标条目、原因和受影响字段；dry run 失败时 SHALL 展示逐条校验错误。第一版 SHALL 不要求复杂 diff 编辑器，但 SHALL 不将未审阅的计划直接标记为可执行。

#### Scenario: 预览合法计划

- **WHEN** 用户提交一个通过 dry run 的 update、merge 或 delete 计划
- **THEN** UI 展示操作数量、每个操作的影响预览，并使执行入口可见

#### Scenario: 展示非法计划

- **WHEN** `plan_json` 无法解析，或包含未知实体、危险引用、Markdown、未分段长文本或保护冲突
- **THEN** UI 展示 dry run 返回的逐条错误，且不提供确认执行入口

#### Scenario: 用户没有计划

- **WHEN** 用户只打开分析报告但没有导入整理计划
- **THEN** UI 保持分析结果可见，并说明需要版本化整理计划才能继续执行

### Requirement: dry run 是 UI 执行路径的前置条件

UI 执行路径 SHALL 先请求 dry run 并且 dry run 通过后才允许用户进入 apply 确认弹层。dry run SHALL 不修改数据。计划内容发生变化后，UI SHALL 失效上一次的执行许可并要求重新 dry run。服务端 SHALL 拒绝没有对应 dry run 摘要、摘要不匹配、或未显式确认的 UI apply 请求。

#### Scenario: 计划变更后重新校验

- **WHEN** 用户在 dry run 通过后修改 `plan_json`
- **THEN** UI 清除可执行状态，apply 入口不可用，要求重新 dry run

#### Scenario: 服务端拒绝绕过 dry run

- **WHEN** UI apply 请求缺少 dry run 摘要、摘要与当前计划不一致，或没有显式确认标记
- **THEN** 服务端返回校验错误且不执行任何操作

### Requirement: 用户确认后才通过 UI 执行计划

UI SHALL 在 apply 前显示确认弹层，内容包括操作数量、update / merge / delete 分布、主要受影响实体和不可自动恢复风险提示。用户取消时 SHALL 不发送 apply 请求；用户确认后 SHALL 发送显式确认和当前 dry run 摘要。服务端 SHALL 在执行前重新校验计划；任一操作失败时 SHALL 停止后续操作并返回已执行、失败和未执行结果。

#### Scenario: 确认后执行

- **WHEN** 用户在确认弹层中明确确认执行
- **THEN** UI 请求 apply，服务端重新校验通过后按计划顺序执行，并返回执行结果

#### Scenario: 取消确认

- **WHEN** 用户在确认弹层中取消
- **THEN** UI 不发送 apply 请求，数据库保持 dry run 后的状态

#### Scenario: 执行中部分失败

- **WHEN** 某个操作校验或写入失败
- **THEN** UI 展示失败原因、已成功操作、未执行操作，并提供重试分析入口

### Requirement: 执行后刷新数据和剩余问题

apply 返回后 UI SHALL 展示执行摘要，并在有真实写入后刷新角色、世界观、关系、剧情线、伏笔和相关引用数据。UI SHALL 在执行后请求新的整理分析并展示剩余问题，不得只显示成功计数而隐藏失败或未执行项。

#### Scenario: 成功执行后复查

- **WHEN** apply 返回全部操作成功
- **THEN** UI 展示执行摘要、级联和历史数量提示，刷新相关设定数据，并展示复查后的剩余问题报告

#### Scenario: 部分失败后复查

- **WHEN** apply 返回部分成功
- **THEN** UI 保留完整执行结果，刷新仍然有效的查询，并展示复查报告中仍然存在的问题

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
