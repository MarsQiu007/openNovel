# 技法库用户界面（technique-ui）

> 状态：草稿 — 优先级 P2（2026-09-07 探索会话产出，方案待研究；长期保留在规划池）

## Why

技法系统后端链路已闭合（提取入库 → shadow 检索 → auditor 反馈 → 贝叶斯置信度 → 门控注入，代码全部接通），但**前端无任何技法界面**（app 全目录搜 technique 零命中）：用户无法查看技法库内容、无法增删改技法、看不到置信度与反馈记录；开关只能改 `.novel/config.json`。同时 agent 只有 `record_technique_feedback` 写入口，不能按需检索技法库（检索/注入是 prompt 注入机制）。

技法沉淀是"越用越强"的核心资产，无 UI 等于资产不可见。

## What Changes

- 技法库管理界面：列表/检索/详情（名称、指令、置信度、状态、反馈记录）、人工录入与编辑（种子入库路径已存在）。
- 技法注入开关的前端呈现（读写 `.novel/config.json` 的 technique_injection）。
- 研究可选：agent 侧技法检索工具（让 director/librarian 能主动查询技法库）。
- 服务端如缺技法 CRUD 端点则补齐（现状待核实）。

## Capabilities

### New Capabilities

- `technique-ui`: 技法库的查看/管理/开关行为要求。

### Modified Capabilities

（无。）

## Impact

- `packages/app`：技法管理界面（工作台新面板或独立视图）。
- `packages/server`：技法 CRUD 端点（若缺）。
- `packages/client`：若新增端点需 `bun run generate` 重新生成 SDK。
- `packages/plugin`：检索工具（若纳入）。
- **本地数据兼容性**：技法三表已存在（techniques/technique_feedback/technique_shadow_log），预计无迁移。

**非目标**：本变更不改技法提取/反馈/置信度算法；不改 shadow→injection 的门控语义。
