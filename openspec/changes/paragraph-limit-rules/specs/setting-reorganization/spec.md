## MODIFIED Requirements

### Requirement: 分析世界观设定问题

系统 SHALL 提供 `organize_settings` 的 `analyze` 动作，扫描指定小说的全部 world_entry，并按统一结构返回可整理问题。报告至少 SHALL 覆盖非标准分类、同标题重复、相似标题、空标题或空内容、单个段落超过 600 字和常见 Markdown 残留。每个问题 SHALL 包含稳定的问题类型、受影响条目标识、证据摘要和建议操作。

#### Scenario: 识别格式与分类问题

- **WHEN** 某本小说存在使用 Markdown 列表的条目、包含 600 字以上单段的条目，以及主分类不在标准分类中的条目
- **THEN** `analyze` 分别返回 Markdown 残留、长单段内容和非标准分类问题，并附受影响条目与证据摘要

#### Scenario: 不标记 300 字连贯段落

- **WHEN** 某个 world_entry content 只有一个 300 字且语义连贯的段落
- **THEN** `analyze` 不返回长单段内容问题

#### Scenario: 识别重复与相似标题

- **WHEN** 两条 world_entry 的标题完全相同，另两条标题在去除空白、统一大小写并忽略常见标点后达到相似阈值
- **THEN** `analyze` 返回一个同标题重复组和一个相似标题候选组，且不自动判定必须删除哪一条

#### Scenario: 没有需要整理的问题

- **WHEN** 指定小说的全部 world_entry 分类、标题和内容都通过检查
- **THEN** `analyze` 返回空问题列表，并明确说明当前无需整理

### Requirement: 跨实体分析与范围过滤

`analyze` SHALL 支持按 `all`、`world_entry`、`character`、`relationship`、`plot_thread` 和 `foreshadowing` 过滤，并返回跨类型结构化报告。除世界观规则外，报告至少 SHALL 检查 character 的重名、relationship 的相同角色对与关系类型重复、plot_thread 的重名、foreshadowing 的相同内容，以及各实体长文本的空字段、Markdown 残留和超过 600 字的单个段落。每个问题 SHALL 标明实体类型、条目标识、证据摘要和建议操作。

#### Scenario: 按类型过滤分析

- **WHEN** 用户或 agent 传入 `scope=character`
- **THEN** `analyze` 只返回 character 相关问题，不返回其他实体的问题

#### Scenario: 识别重复角色与重复关系

- **WHEN** 两个 character 名称完全相同，或两条 relationship 的相同角色对与关系类型重复
- **THEN** `analyze` 分别返回重复组和候选整理建议，不自动删除或合并

#### Scenario: 识别格式问题

- **WHEN** character description、plot_thread description、foreshadowing content 或 relationship description 含 Markdown、包含超过 600 字的单段，或关键字段为空
- **THEN** `analyze` 返回对应的格式、长段落或空字段问题

#### Scenario: 不标记 300 字角色描述

- **WHEN** character description 是一个 300 字且语义连贯的纯文本段落
- **THEN** `analyze` 不返回长单段内容问题

### Requirement: 受限字段更新保持纯文本

`update` SHALL 按实体类型使用字段白名单：world_entry 为 category/title/content，character 为 name/description，plot_thread 为 title/description，foreshadowing 为 content，relationship 为 description。所有长文本 SHALL 为纯文本；任一规范化段落超过 600 字时 SHALL 拒绝。修改 SHALL NOT 绕过角色主角保护、关系完整性或现有级联机制。真实字段变更 SHALL 写入修改历史，character 或 world_entry 的相关变化 SHALL 重建引用追踪并按现有机制生成级联任务。

#### Scenario: 更新角色描述

- **WHEN** 计划把 character description 从 Markdown 内容改为分段纯文本
- **THEN** `apply` 更新描述、写入历史、重建引用追踪并按现有规则生成级联任务

#### Scenario: 接受 300 字角色描述

- **WHEN** 计划把 character description 更新为一个 300 字且语义连贯的纯文本段落
- **THEN** `dry_run` 通过校验，用户确认后 `apply` 才能写入

#### Scenario: 更新剧情线或伏笔

- **WHEN** 计划修改 plot_thread 的 title/description 或 foreshadowing 的 content
- **THEN** `apply` 只修改白名单字段，写入真实变更历史，并保持状态和时间字段不变

#### Scenario: 拒绝 Markdown 或长单段文本

- **WHEN** 任何白名单长文本包含 Markdown，或任一规范化段落超过 600 字
- **THEN** `dry_run` 和 `apply` 都拒绝该操作

## ADDED Requirements

### Requirement: 长段落整理建议按单段长度判断

`analyze` SHALL 把长段落问题定义为一个规范化段落超过 600 字，SHALL NOT 仅因字段总字数超过 600 而报告问题。证据 SHALL 标明字段和该段字数；建议 SHALL 引导按主题分段并控制单段在约 80–220 字。自动生成分段计划时，系统 SHALL 只拆分超过阈值的具体段落，保留既有其他段落，并优先在句号、感叹号或问号边界分段。

#### Scenario: 只标记超长段落

- **WHEN** 一个字段包含两个较短段落和一个 650 字段落
- **THEN** `analyze` 只针对该 650 字段落返回长段落问题

#### Scenario: 不因总字数误报

- **WHEN** 一个字段由三个 250 字段落组成，字段总字数为 750
- **THEN** `analyze` 不返回长单段内容问题

#### Scenario: 自动分段保留既有段落

- **WHEN** AI 根据长段落问题生成分段计划
- **THEN** 计划只改写超过 600 字的段落，保留未超长段落的文本和顺序
