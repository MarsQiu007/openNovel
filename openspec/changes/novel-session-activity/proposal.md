# 书级会话活动指示（novel-session-activity）

> 状态：草稿 — 优先级 P2（2026-09-07 探索会话产出，方案待研究；长期保留在规划池）

## Why

书内活动指示是**目录级而非书级**：`useNovelActivity`（`packages/app/src/context/novel-approval.ts:53`）注释自认 "no reverse novel→session lookup endpoint yet"——同目录下其它项目/书的会话运行会被误显示为本书"写作中"。而反向查询的批量端点 `session-bindings` 已存在并在用（`workspace-data.ts:93`），只是活动指示未接入。

## What Changes

- 书级活动指示：绑定会话列表 × 会话运行状态求交（数据已具备），替代目录级判断。
- 顺带核对批注执行入口的 `sessionBusy` 判定是否同受此问题影响。

## Capabilities

### New Capabilities

- `novel-session-activity`: 书级活动状态的判定与呈现要求。

### Modified Capabilities

（无。）

## Impact

- `packages/app`：`useNovelActivity` 及消费组件（mode-badge、approval-bar 等）。
- `packages/server`：预计无变更（bindings 端点已存在；若需批量会话状态查询则补端点 + `bun run generate`）。
- 无数据模型变更。

**非目标**：本变更不做跨书聚合仪表盘；不改 bindings 数据结构。
