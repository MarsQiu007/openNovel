# agent-desc-zh Specification

## Purpose
定义内置写作 agent 的 description 字段使用简体中文，保证调度界面与 director 分派表中各 agent 的摘要统一为中文可读，避免中英混排的展示漂移。

## Requirements

### Requirement: 内置 agent 描述中文

`packages/core/src/plugin/agent.ts` 引导块中 `default` / `plan` / `general` / `explore` 四个内置 agent 的 `description` MUST 为中文。

#### Scenario: 面板显示中文描述

- **WHEN** 用户打开智能体面板查看 default / plan / general / explore
- **THEN** 描述显示为中文，不再是英文

#### Scenario: system prompt 不变

- **WHEN** 检查 `BUILD_SYSTEM` / `PROMPT_EXPLORE` / `PROMPT_COMPACTION` / `PROMPT_TITLE` / `PROMPT_SUMMARY`
- **THEN** 仍为英文，未改动
