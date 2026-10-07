# Spec Delta

## Purpose

将 technique-content-nature 的书级判定要求由"被动信号推断"更新为"显式声明列判定"（与 book-content-nature 能力配套），章节级判定与双闸门过滤语义不变。

## RENAMED Requirements

- `书级内容性质被动信号判定` -> `书级内容性质显式声明判定`

## MODIFIED Requirements

### Requirement: 书级内容性质显式声明判定
每本书的书级内容性质 SHALL 由 novels 表 `content_nature` 显式列判定（`'general' | 'adult'`，默认 `'general'`），运行时 MUST NOT 以书库技法存在性等被动信号推断。书级性质随显式写入变化（创建声明、检测确认、协议更新），adult 技法的增删不再影响书级判定。读取失败或缺失 MUST 按 `'general'` 从紧回落，不中断写作主流程。

#### Scenario: 显式声明为 adult 的书
- **WHEN** 该书 `content_nature='adult'`（创建声明或检测确认）
- **THEN** 写作召回启用章节级闸门，adult 技法在章节判定为成人时进入候选

#### Scenario: 默认普通书
- **WHEN** 该书 `content_nature='general'`（默认或显式声明）
- **THEN** 即使书库中存在 adult 技法，书级闸门也不放行，adult 技法不进候选

#### Scenario: 读列失败从紧回落
- **WHEN** 读取书级性质失败（数据库异常或行缺失）
- **THEN** 按 `general` 处理，adult 候选不出现，写作流程不中断

### Requirement: 章节级内容性质判断
组装写作上下文快照时，调用方 agent SHALL 通过工具参数给出当前章节的内容性质判断（成人/通用）；该参数仅在本书 `content_nature='adult'` 且书库存在 `scope=adult` 技法时影响候选。参数缺失或非法时系统 MUST 按非成人处理（从紧）。章节判断随当次召回进行，MUST NOT 持久化存储，且工具执行层 MUST NOT 为此发起额外 LLM 调用。

#### Scenario: 成人书中的非成人章节
- **WHEN** 书级性质为 adult 的书正在写作一场战斗章节，调用方判断本章为非成人
- **THEN** 该次召回的候选不含 adult 技法

#### Scenario: 参数未传从紧
- **WHEN** 调用方未传章节内容性质参数（旧提示词、自定义调用方）
- **THEN** 按非成人处理，adult 技法候选不出现

#### Scenario: 纯通用书快速路径
- **WHEN** 书库中不存在任何 adult 技法
- **THEN** 章节参数不影响候选，候选行为与既有完全一致

### Requirement: adult 技法候选双闸门过滤
检索技法候选时，本书库中 `scope=adult` 的技法 MUST 同时通过书级闸门（该书 `content_nature='adult'`）与章节闸门（当前章节判断为成人）才允许进入候选列表；任一闸门不满足则该技法 MUST NOT 进入候选，且不写 shadow 日志。全局通用库中的 `general` 技法 MUST NOT 受此过滤影响。

#### Scenario: 通用书召回不到成人技法
- **WHEN** 通用书（`content_nature='general'`）进入写作流水线，本书库存在 adult 技法
- **THEN** 候选列表不含任何 `scope=adult` 技法

#### Scenario: 成人书的成人章节双源可见
- **WHEN** 书级 `content_nature='adult'` 的书当前章节判断为成人
- **THEN** 候选同时包含全局 general 技法与本书 adult 技法

#### Scenario: 闸门不波及全局技法
- **WHEN** 任何书在任意章节检索候选
- **THEN** 全局通用库技法的可见性与既有行为完全一致
