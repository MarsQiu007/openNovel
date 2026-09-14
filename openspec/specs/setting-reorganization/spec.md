## Purpose

为世界观、角色、关系、剧情线和伏笔提供可审计的 agent 整理工作流：先识别结构问题，再校验版本化整理计划，最后在用户确认后执行受控修改。

## Requirements

### Requirement: 分析世界观设定问题

系统 SHALL 提供 `organize_settings` 的 `analyze` 动作，扫描指定小说的全部 world_entry，并按统一结构返回可整理问题。报告至少 SHALL 覆盖非标准分类、同标题重复、相似标题、空标题或空内容、长单段内容和常见 Markdown 残留。每个问题 SHALL 包含稳定的问题类型、受影响条目标识、证据摘要和建议操作。

#### Scenario: 识别格式与分类问题

- **WHEN** 某本小说存在使用 Markdown 列表的条目、超过 200 字且无换行的条目，以及主分类不在标准分类中的条目
- **THEN** `analyze` 分别返回 Markdown 残留、长单段内容和非标准分类问题，并附受影响条目与证据摘要

#### Scenario: 识别重复与相似标题

- **WHEN** 两条 world_entry 的标题完全相同，另两条标题在去除空白、统一大小写并忽略常见标点后达到相似阈值
- **THEN** `analyze` 返回一个同标题重复组和一个相似标题候选组，且不自动判定必须删除哪一条

#### Scenario: 没有需要整理的问题

- **WHEN** 指定小说的全部 world_entry 分类、标题和内容都通过检查
- **THEN** `analyze` 返回空问题列表，并明确说明当前无需整理

### Requirement: 整理计划必须先通过 dry run

系统 SHALL 提供 `organize_settings` 的 `dry_run` 动作，接受版本化的 `plan_json`。版本 1 计划 SHALL 只允许针对 world_entry 执行 `update`、`merge` 和 `delete` 操作；每个操作 SHALL 指向已存在条目并附带原因。跨实体能力由版本 2 计划扩展。`dry_run` SHALL 校验操作类型、字段白名单、条目存在性、ID 冲突、分类白名单、纯文本与分段约束、merge 源目标关系，以及 merge 源与 delete 目标的活跃引用冲突。校验通过前 SHALL 不修改任何数据。

#### Scenario: 校验合法整理计划

- **WHEN** 计划只包含有效的 world_entry 更新、合并或删除操作，且所有文本满足纯文本和分段规则
- **THEN** `dry_run` 返回通过状态、操作数量、受影响条目和每条操作的影响预览，不写入数据库

#### Scenario: 拒绝危险或无效计划

- **WHEN** 计划引用不存在的条目、重复使用同一 ID、merge 目标与源重叠、写入 Markdown、使用超长单段文本、merge 源仍被活跃引用，或删除仍被章节引用的条目
- **THEN** `dry_run` 返回失败状态和逐条错误，不写入数据库

### Requirement: 用户确认后才执行整理计划

`apply` SHALL 先完整重新校验传入计划；校验失败时 SHALL 不执行任何操作。校验通过后，系统 SHALL 请求运行时用户确认；用户拒绝确认时 SHALL 不修改任何数据。只有确认通过时才按计划顺序执行，且每个操作失败时 SHALL 停止后续操作并返回已执行、未执行和失败原因。

#### Scenario: 用户确认后执行

- **WHEN** 计划通过 `apply` 的重新校验，且用户在运行时确认执行
- **THEN** 系统按计划顺序执行操作，并返回每个操作的成功结果、影响摘要和级联信息

#### Scenario: 用户拒绝执行

- **WHEN** 计划通过校验但用户拒绝运行时确认
- **THEN** 系统返回未执行结果，数据库保持原状

#### Scenario: 执行前再次校验失败

- **WHEN** `apply` 收到未通过 dry run 规则校验的计划
- **THEN** 系统返回校验错误，不请求用户确认，也不修改数据库

### Requirement: 更新与合并写入历史并保持一致性

`update` SHALL 只修改 world_entry 的 category、title 和 content。`merge` SHALL 只允许把多个已存在的源条目合并到一个已存在目标条目，并删除源条目。修改后的 category SHALL 属于标准分类，修改后的 title 和 content SHALL 为纯文本且 content 满足分段规则。真实字段变更 SHALL 写入 description_history；目标条目的 title 或 content 变化 SHALL 重建引用追踪并按现有级联机制生成统改任务。

#### Scenario: 更新分类和内容

- **WHEN** 计划把 world_entry 的非标准分类改为标准分类，并把 Markdown 内容改写为分段纯文本
- **THEN** `apply` 更新字段，写入 description_history，重建引用追踪，并在有章节引用时创建级联任务

#### Scenario: 合并重复条目

- **WHEN** 计划把重复的源条目合并到目标条目，并为目标提供新的纯文本 content
- **THEN** `apply` 更新目标条目并归档字段历史，删除源条目，返回保留 ID 和删除 ID

#### Scenario: 拒绝合并仍被引用的源条目

- **WHEN** 计划把一个仍被章节正文引用的 world_entry 作为 merge 源
- **THEN** dry_run 返回引用冲突，`apply` 不删除该源条目

#### Scenario: 禁止非标准分类回写

- **WHEN** 整理计划把 category 改为标准分类之外的新值
- **THEN** `dry_run` 和 `apply` 都拒绝该操作

### Requirement: 删除操作必须避开活跃引用

`delete` SHALL 只删除计划中明确列出的已存在 world_entry。当条目仍存在活跃引用时，系统 SHALL 将该操作标记为引用冲突并拒绝执行；用户 SHALL 先合并、改写引用条目或通过常规单条设定流程处理。

#### Scenario: 删除无引用条目

- **WHEN** 计划删除一个没有任何活跃引用的空内容或重复 world_entry
- **THEN** 用户确认后系统删除该条目，并返回删除结果

#### Scenario: 拒绝删除被章节引用的条目

- **WHEN** 计划删除一个仍被章节正文引用的 world_entry
- **THEN** `dry_run` 返回引用冲突，`apply` 不删除该条目

### Requirement: 执行后返回整理结果

`apply` SHALL 返回操作级别结果，包括成功、失败、保留 ID、删除 ID、历史归档数量、级联任务数量和未执行操作。执行完成后，工具输出 SHALL 建议再次运行 `analyze` 确认剩余问题。

#### Scenario: 返回执行摘要

- **WHEN** 一个包含更新和删除的计划执行完成
- **THEN** 输出包含每个操作的结果、历史与级联数量，以及复查建议

#### Scenario: 操作失败时停止

- **WHEN** 执行到某个操作时数据库更新失败
- **THEN** 系统停止执行后续操作，返回失败原因和剩余未执行操作列表

### Requirement: Agent 整理流程受提示词约束

director 提示词和 `organize_settings` 工具描述 SHALL 明确要求 agent 按“分析、生成计划、dry run、向用户说明并等待确认、apply、复查”的顺序工作，禁止直接 apply，禁止虚构条目 ID，禁止自动删除相似条目，禁止写入 Markdown 或未分段长文本。

#### Scenario: 用户要求整理设定

- **WHEN** 用户要求 AI 整理设定
- **THEN** director 提示词要求 AI 先调用 `analyze`，再用 `dry_run` 验证计划，先向用户说明影响并等待确认，然后才执行 `apply`

#### Scenario: AI 试图跳过确认

- **WHEN** AI 尝试直接调用 `apply`
- **THEN** 工具描述和运行时确认机制要求其先完成校验并获得用户确认，否则不修改数据

### Requirement: 跨实体分析与范围过滤

`analyze` SHALL 支持按 `all`、`world_entry`、`character`、`relationship`、`plot_thread` 和 `foreshadowing` 过滤，并返回跨类型结构化报告。除世界观规则外，报告至少 SHALL 检查 character 的重名、relationship 的相同角色对与关系类型重复、plot_thread 的重名、foreshadowing 的相同内容，以及各实体长文本的空字段、Markdown 残留和长单段内容。每个问题 SHALL 标明实体类型、条目标识、证据摘要和建议操作。

#### Scenario: 按类型过滤分析

- **WHEN** 用户或 agent 传入 `scope=character`
- **THEN** `analyze` 只返回 character 相关问题，不返回其他实体的问题

#### Scenario: 识别重复角色与重复关系

- **WHEN** 两个 character 名称完全相同，或两条 relationship 的相同角色对与关系类型重复
- **THEN** `analyze` 分别返回重复组和候选整理建议，不自动删除或合并

#### Scenario: 识别格式问题

- **WHEN** character description、plot_thread description、foreshadowing content 或 relationship description 含 Markdown、超过 200 字且无换行，或关键字段为空
- **THEN** `analyze` 返回对应的格式或空字段问题

### Requirement: 跨实体计划使用版本化结构

跨实体整理计划 SHALL 使用版本 2 的 `plan_json`，每个操作 SHALL 显式声明实体类型。版本 1 计划 SHALL 继续按 world_entry 解析以保持兼容。`dry_run` SHALL 校验实体类型、字段白名单、条目存在性、ID 冲突、merge 源目标关系、活跃引用冲突和文本格式；校验通过前 SHALL 不修改数据。

#### Scenario: 校验版本 2 计划

- **WHEN** 计划包含显式 entity_type 的合法 update、merge 或 delete 操作
- **THEN** `dry_run` 返回跨实体影响预览和通过状态，不写入数据库

#### Scenario: 拒绝混合或未知实体类型

- **WHEN** 版本 2 操作缺少 entity_type、包含不支持的实体类型，或引用不属于目标小说的条目
- **THEN** `dry_run` 返回逐条错误，不写入数据库

#### Scenario: 继续兼容版本 1 计划

- **WHEN** agent 提交旧版本 1 计划且没有声明其他实体类型
- **THEN** 系统按 world_entry 规则校验并保持原有行为

### Requirement: 受限字段更新保持纯文本

`update` SHALL 按实体类型使用字段白名单：world_entry 为 category/title/content，character 为 name/description，plot_thread 为 title/description，foreshadowing 为 content，relationship 为 description。所有长文本 SHALL 为纯文本并满足分段规则；修改不 SHALL 绕过角色主角保护、关系完整性或现有级联机制。真实字段变更 SHALL 写入修改历史，character 或 world_entry 的相关变化 SHALL 重建引用追踪并按现有机制生成级联任务。

#### Scenario: 更新角色描述

- **WHEN** 计划把 character description 从 Markdown 内容改为分段纯文本
- **THEN** `apply` 更新描述、写入历史、重建引用追踪并按现有规则生成级联任务

#### Scenario: 更新剧情线或伏笔

- **WHEN** 计划修改 plot_thread 的 title/description 或 foreshadowing 的 content
- **THEN** `apply` 只修改白名单字段，写入真实变更历史，并保持状态和时间字段不变

#### Scenario: 拒绝 Markdown 或长单段文本

- **WHEN** 任何白名单长文本包含 Markdown、超过 200 字且无换行
- **THEN** `dry_run` 和 `apply` 都拒绝该操作

### Requirement: 角色与关系合并复用安全策略

character merge SHALL 只允许合并同名条目，relationship merge SHALL 只允许合并相同角色对和关系类型的条目。合并 SHALL 保留目标条目、合并描述中尚未包含的独立段落、重定向关系与引用追踪、删除源条目并返回保留与删除 ID。目标描述缩短导致信息丢失风险时 SHALL 拒绝执行；主角和已出场角色不得作为被删除源。

#### Scenario: 合并重复角色

- **WHEN** 两个同名 character 的描述包含互补段落，计划指定其中一个为目标
- **THEN** `apply` 合并独立段落、重定向关系和引用，删除源角色并返回结果

#### Scenario: 合并重复关系

- **WHEN** 两条 relationship 的角色对和类型相同，计划指定目标和源
- **THEN** `apply` 合并描述、删除源关系并返回保留与删除 ID

#### Scenario: 拒绝不同身份的合并

- **WHEN** character 目标与源名称不同，或 relationship 目标与源的角色对、类型不同
- **THEN** `dry_run` 和 `apply` 都拒绝该操作

#### Scenario: 保护已出场角色

- **WHEN** merge 源或 delete 目标是主角，或仍被章节正文引用
- **THEN** `dry_run` 返回保护或引用冲突，`apply` 不删除该条目

### Requirement: 跨实体删除必须避开保护与引用

`delete` SHALL 按实体类型执行白名单删除。删除前 SHALL 检查活跃引用；character 还 SHALL 沿用主角保护和已出场保护，relationship SHALL 不得破坏角色存在性。存在保护或引用冲突时 SHALL 拒绝执行。

#### Scenario: 删除无引用剧情线

- **WHEN** 计划删除一个没有活跃引用的空剧情线
- **THEN** 用户确认后系统删除该条目并返回结果

#### Scenario: 拒绝删除被引用伏笔

- **WHEN** 计划删除一个仍被章节或设定引用的 foreshadowing
- **THEN** `dry_run` 返回引用冲突，`apply` 不删除该条目

#### Scenario: 拒绝删除主角

- **WHEN** 计划删除 role 为 protagonist 的 character
- **THEN** `dry_run` 返回主角保护错误，`apply` 不执行该操作

### Requirement: 跨实体提示词约束

director 提示词和工具描述 SHALL 要求跨实体整理仍按“分析、版本 2 计划、dry run、向用户说明并等待确认、apply、复查”执行；SHALL 禁止虚构跨实体 ID、自动删除相似或重复条目、绕过运行时确认、写入 Markdown 或未分段长文本。

#### Scenario: 跨实体整理请求

- **WHEN** 用户要求整理角色、关系、剧情线或伏笔
- **THEN** AI 先执行跨实体 analyze，再生成版本 2 计划并通过 dry run、用户确认后才 apply

#### Scenario: AI 试图自动合并重名

- **WHEN** AI 只看到重名报告就准备删除或合并
- **THEN** 提示词和计划校验要求其先生成显式目标与源计划、完成 dry run并获得用户确认
