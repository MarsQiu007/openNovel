# Tasks

## 1. agent.ts 描述中文化

- [x] 1.1 翻译 default / plan / general / explore 三处 `item.description` 为中文
- [x] 1.2 确认 `PROMPT_*` / `BUILD_SYSTEM` 未改动

## 2. 守门与收尾

- [x] 2.1 core `bun typecheck`、根 `bunx oxlint` 0 errors
- [ ] 2.2 `openspec validate --strict`、收集提交、归档、ff-only 合并 main（不推送）；通知用户重启 dev:desktop 验收

## Implementation Commits

- `d78b3df94` feat(core): 内置 agent 描述中文化
