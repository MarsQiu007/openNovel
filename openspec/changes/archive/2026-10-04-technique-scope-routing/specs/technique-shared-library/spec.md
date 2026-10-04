# Spec Delta

## Purpose

全局通用技法库：存放跨书共享的 general 写作技法，使通用写法一次学习处处可用；成人技法留在产出它的书库内。路由即分离——写入侧按内容性质决定存储位置，召回侧双源合并，无需任何书级开关或人工分类操作。

## ADDED Requirements

### Requirement: 通用技法入全局库、成人技法入本书库

对话学习保存技法时，系统 SHALL 按技法的 `scope` 路由存储：`general` 写入全局通用技法库（novel-store 管理的专用 techniques.db），`adult` 写入当前书籍的技法库。`scope` SHALL 由学习 agent 逐候选显式判断（工具层必填，拿不准一律 `adult`），用户 MUST NOT 需要进行任何开关设置或分类操作。

#### Scenario: 通用写法进全局库

- **WHEN** 学习 agent 从任意书籍提炼出"对话节奏控制"并判定为通用写法
- **THEN** 该技法以 `scope=general` 写入全局库，其他所有书籍的写作均可召回

#### Scenario: 成人技法留本书

- **WHEN** 学习 agent 从成人内容章节提炼出成人技法
- **THEN** 该技法写入当前书籍的技法库，其他书籍的写作召回不到它

#### Scenario: 判断存疑从紧

- **WHEN** 学习 agent 无法确定候选的性质
- **THEN** 按 `adult` 处理（留在本书库），不得写入全局库

#### Scenario: 工具层强制显式判断

- **WHEN** 学习 agent 调用 `save_technique` 未传 `scope`
- **THEN** 工具拒绝执行，不写入任何库

### Requirement: 召回双源合并

写作上下文快照检索技法候选时，系统 SHALL 同时检索本书库与全局通用库，合并去重后统一按场景匹配与置信度排序裁剪；`unverified` 新品曝光位 SHALL 跨两池按入库时间取最近条目；候选 MUST 携带来源库标记供 shadow 日志与反馈链路引用。

#### Scenario: 通用书召回全局技法

- **WHEN** 一本从未学习过技法的通用书进入写作流水线
- **THEN** 快照候选包含全局库中场景匹配的高置信技法

#### Scenario: 成人书双源召回

- **WHEN** 成人书进入写作流水线且本书库有成人技法、全局库有通用技法
- **THEN** 两类技法均可进入候选（全局 general + 本书 adult），通用书永远召回不到成人技法

### Requirement: 反馈与状态机跨库归集

auditor 提交技法反馈时，反馈 SHALL 写入被评技法所在库；置信度状态机 SHALL 在对应库内演进；全局技法的反馈跨书积累计数。同名技法 MUST NOT 跨库自动合并证据。

#### Scenario: 全局技法跨书积累反馈

- **WHEN** 同一全局技法在两本不同书的写作中各获得反馈
- **THEN** 两条反馈都计入该技法的反馈总数，驱动其置信度与 verified 晋升

#### Scenario: 跨库同名不合并

- **WHEN** 本书库存在 adult 技法与全局库某 general 技法同名
- **THEN** 学习合并只在本库内匹配同名目标，不得把 adult 证据并入全局技法