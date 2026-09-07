# 书籍级会话活动指示（novel-session-activity）

> 状态：已细化 — 优先级 P2，2026-09-08 确认复用绑定查询，不新增服务端接口

## Why

当前 `useNovelActivity` 只判断当前目录内是否有任意会话在运行。多本书共享一个项目/目录时，其他书的会话运行会让当前书被错误标记为“写作中”。

## What Changes

- 书籍活动改为“当前书绑定会话列表 × 会话运行状态”求交集。
- 工作台活动指示使用同一书籍级判定。
- 批注执行面板的会话占用判断复用同一判定函数。

## Capabilities

### New Capabilities

- `novel-session-activity`: 书籍级会话活动判定与实时更新要求。

### Modified Capabilities

（无。不修改绑定数据结构和公开 API。）

## Impact

- `packages/app`：活动钩子、工作台和批注执行面板。
- 不修改 `packages/server`；不需要重新生成 SDK。
- 不引入数据模型变更。

**非目标**：不聚合跨目录会话；不新增反向查询端点；不改变会话生命周期。
