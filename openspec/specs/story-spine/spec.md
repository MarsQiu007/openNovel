# story-spine Specification

## Purpose
滚动维护的叙事主线，将全书已发生剧情压缩为一段连贯的故事主轴，writer 每章生成时始终可见，解决中后期章节"知道最近发生了什么但不知道故事整体走到了哪里"的问题。

## Requirements

### Requirement: 每章提交后主轴追加一条确定性条目

章节状态提交（`commit_observer_delta`）完成后，系统 SHALL 从该章的 observer delta 中确定性拼接一条主轴条目并追加到 `story_spine` 字段末尾。条目格式为：`第N章：{主要事件概述}。{悬念/未兑现}`。主轴更新 SHALL 使用结构化数据（章节摘要 + 关键事件），MUST NOT 依赖 LLM 自由生成。

#### Scenario: 第 5 章提交后主轴更新

- **WHEN** 第 5 章的 observer delta 被提交
- **THEN** `story_spine` 字段末尾追加一条以"第5章："开头的条目
- **AND** 条目内容来自该章的 `chapter_summary` delta（标题 + 摘要 + 关键事件）
- **AND** 不调用 LLM

#### Scenario: 空摘要时不追加

- **WHEN** 某章的 observer delta 中没有 `chapter_summary` 类型条目
- **THEN** `story_spine` 不追加任何内容
- **AND** 已有主轴内容保持不变

### Requirement: 主轴始终在 writer 上下文中可见

上下文快照 SHALL 在最前部渲染 `story_spine` 为"故事主轴"段落。主轴 SHALL 分配独立的预算上限（500 token），超出时从最早条目开始截断（保留最近的剧情）。当 `story_spine` 为空（新书或旧数据）时 SHALL 不渲染该段落。

#### Scenario: 第 9 章时主轴覆盖第 1-8 章

- **WHEN** writer 准备生成第 9 章
- **THEN** 上下文快照开头包含"故事主轴"段落
- **AND** 该段落包含第 1-8 章的压缩叙事条目
- **AND** writer 能从中了解故事整体走向和未兑现的伏笔

#### Scenario: 旧书无主轴时正常生成

- **WHEN** `story_spine` 字段为 null 或空字符串
- **THEN** 上下文快照不渲染"故事主轴"段落
- **AND** writer 上下文的其余部分不受影响

### Requirement: 主轴条目包含悬念和未兑现信息

主轴条目 SHALL 包含该章的悬念或未兑现信息（从 observer delta 的 `foreshadow`（state=planted）和 `plot_thread`（status=open）中提取）。当该章没有新的伏笔或线索时，条目可省略悬念部分。

#### Scenario: 章节有新伏笔时主轴包含悬念

- **WHEN** 第 N 章的 observer delta 包含一个 `foreshadow` 类型条目且 state 为 planted
- **THEN** 主轴条目末尾包含该伏笔的内容摘要
- **AND** 标注为"伏笔：{内容前 30 字}..."

#### Scenario: 无悬念时省略

- **WHEN** 第 N 章没有新的伏笔或开启的线索
- **THEN** 主轴条目仅包含事件概述，不含悬念部分
