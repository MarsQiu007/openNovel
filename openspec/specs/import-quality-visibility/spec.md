# import-quality-visibility Specification

## Purpose
TBD - created by archiving change import-quality-visibility. Update Purpose after archive.

## Requirements

### Requirement: 书级待审聚合查询

系统 SHALL 提供按目录一次聚合全书待审数的查询：返回每本书的设定审阅收件箱待审数与章节清理修订待审数及两者之和，无书的目录 SHALL 返回空列表。

#### Scenario: 两源计数按书聚合

- **WHEN** 目录下某书存在 3 条待审设定候选与 2 条待审清理修订提案
- **THEN** 聚合查询对该书返回收件箱待审 3、清理修订待审 2、合计 5

#### Scenario: 空目录返回空列表

- **WHEN** 目录下没有任何书籍
- **THEN** 聚合查询返回空列表

### Requirement: 书架待审角标直达审阅面板

书架卡片 SHALL 在该书待审总数大于零时显示角标；点击角标 SHALL 进入该书工作台并定位到对应审阅面板——清理修订待审数大于零时定位清理修订审阅，否则定位设定审阅收件箱；角标点击 MUST NOT 改变卡片本身打开书的行为。

#### Scenario: 有待审显示角标并直达清理修订

- **WHEN** 某书清理修订待审为 2、收件箱待审为 1
- **THEN** 书架卡片显示合计 3 的角标，点击角标进入工作台并选中清理修订审阅面板

#### Scenario: 仅收件箱待审直达收件箱

- **WHEN** 某书清理修订待审为 0、收件箱待审为 4
- **THEN** 书架卡片显示角标 4，点击角标进入工作台并选中设定审阅收件箱面板

#### Scenario: 无待审不显示角标

- **WHEN** 某书两源待审均为零
- **THEN** 书架卡片不显示待审角标，卡片打开行为正常
