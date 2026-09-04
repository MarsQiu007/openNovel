# 提案：书内会话切换器

## Why

绑定会话的数据模型支持一本书多个会话（`NovelSessionBinding` 是列表），但 UI 按 1:1 生长：工作台对话面板只显示路由里的那个会话，没有任何"列出本书会话 / 切换 / 新建"的界面——第二个绑定会话一旦产生就成孤儿，只能回 /sessions 页跨页捞取。同时"给书开一个不带写作 prompt 的轻会话"（校对、大纲讨论）没有自然入口，主线写作按钮（WritingFlowButton）创建会话时会强制附带"写下一章"指令。

## What Changes

- 书籍工作台对话面板顶部新增书内会话切换器：显示当前会话标题，下拉列出该书全部未归档绑定会话
- 选择即切换：工作台路由 `/:dir/novel/:novelID/session/:id` 联动更新，主区焦点视图与左栏不受影响，对话面板常驻挂载的会话状态保持
- 新建轻会话：创建会话 + 绑定该书 + 切入新会话，不附带任何自动 prompt（与主线写作流职责分离）
- 归档会话不出现在切换器列表中
- 当前无绑定会话时保持现有空态行为（写作按钮引导创建首个会话）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `novel-workspace-layout`: 新增"书内会话切换"要求（对话面板顶部的切换与新建入口、切换的联动语义、归档过滤）

## Impact

- **packages/app**：`workspace-frame.tsx` 对话面板头部（切换器组件接入点）、`novel-sessions.ts`（书内会话查询组合：绑定关系 × 会话列表过滤，复用 `findBoundNovelSession` 的查询模式）
- **不涉及**：写作流水线与审批闸门、Protocol / Server HttpApi（绑定与建会话 API 均已存在，无需 SDK 再生成）、writing-flow.tsx 主线写作流
- 前置无依赖：不依赖书籍 tab 体系（`book-titlebar-tabs` 另案，可独立实施与归档）
