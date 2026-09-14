## ADDED Requirements

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
