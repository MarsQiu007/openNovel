# agent-desc-zh：内置 agent 描述中文化

## 背景

`packages/core/src/plugin/agent.ts` 的 `ctx.agent.transform` 引导块里，`default` / `plan` / `general` / `explore` 四个内置 agent 的 `description` 硬编码为英文。智能体面板显示英文描述，与 novel-writer 插件的 12 个中文写作 agent 描述语言不一致。

## 目标

把上述三处硬编码 `description` 翻成中文，使面板描述语言统一。`system` prompt（`BUILD_SYSTEM` / `PROMPT_EXPLORE` / `PROMPT_COMPACTION` / `PROMPT_TITLE` / `PROMPT_SUMMARY`）是模型指令、不出现在面板，不翻。

## 非目标

- 不改动 `system` prompt（模型指令，非 UI 文案）；
- 不改动 novel-writer 插件的写作 agent 描述；
- 不改动权限规则、agent ID、mode、category 等行为字段。
