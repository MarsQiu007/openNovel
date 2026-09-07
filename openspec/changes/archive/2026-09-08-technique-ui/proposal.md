# 技法库用户界面（technique-ui）

> 状态：已细化 — 优先级 P2（2026-09-07 探索会话产出）

## Why

技法系统后端链路已闭合（提取入库 → shadow 检索 → auditor 反馈 → 贝叶斯置信度 → 门控注入），但前端没有技法界面：用户无法查看技法库内容、无法增删改技法、看不到置信度与反馈记录；注入开关只能手工改 `.novel/config.json`。

技法沉淀是“越用越强”的核心资产，无 UI 等于资产不可见。

## What Changes

- 技法库管理界面：列表/筛选/详情（名称、指令、置信度、状态、反馈记录）、人工录入与编辑、删除确认。
- 技法注入开关的前端呈现（读写 `.novel/config.json` 的 `technique_injection`）。
- 服务端补齐技法管理 CRUD 和注入开关 API。
- 不新增 agent 检索工具；写作管线已有检索继续保留。

## Capabilities

### New Capabilities

- `technique-ui`: 技法库的查看、管理、删除确认和注入开关行为要求。

### Modified Capabilities

（无。）

## Impact

- `packages/app`：技法管理界面（书籍工作台右栏新面板）。
- `packages/server`：技法 CRUD 端点与注入开关端点。
- `packages/client`：新增端点后重新生成 SDK。
- `packages/novel-store`：技法数据访问和共享注入开关读写。
- `packages/schema` / `packages/protocol`：技法契约。
- **本地数据兼容性**：技法三表已存在，预计无迁移；删除技法时同时清理其反馈记录。

**非目标**：本变更不改技法提取/反馈/置信度算法；不改 shadow→injection 的门控语义。