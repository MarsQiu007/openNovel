# Spec Delta

## Purpose

定义 novel-writer 工具的项目根解析不变式：项目根从工具上下文的 `directory` 直接解析，与 SQLite db 路径重定向解耦，保证模式配置、项目配置、快照模式段等所有项目级配置读取永远落在真实项目目录。

## ADDED Requirements

### Requirement: 项目根解析与 db 路径重定向解耦

novel-writer 工具的项目根 SHALL 从工具上下文的 `directory` 直接解析（结果等于 `directory` 本身）；SQLite db 路径重定向机制（`OPENNOVEL_DB`）无论取值为何 SHALL NOT 改变项目根解析结果。

#### Scenario: env 重定向时配置读取位置不变

- **WHEN** `OPENNOVEL_DB` 指向非标准布局路径（不在 `<项目根>/.novel/` 下），工具上下文 `directory` 指向真实项目目录
- **THEN** 项目根解析结果与未设置该 env 时一致，项目级配置（如 `.novel/config.json`）从该目录读取

#### Scenario: 解析为恒等变换

- **WHEN** 工具上下文 `directory` 为任意项目目录路径
- **THEN** 项目根解析结果等于该路径本身

### Requirement: 缺省目录回退 cwd

工具上下文 `directory` 为空（null/undefined）时，项目根 SHALL 回退为 `process.cwd()`。

#### Scenario: 空目录回退进程工作目录

- **WHEN** 工具上下文未提供 `directory`
- **THEN** 项目根解析结果为 `process.cwd()`，无论 `OPENNOVEL_DB` 是否设置
