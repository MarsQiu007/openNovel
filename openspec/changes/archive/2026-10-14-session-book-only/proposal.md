# Proposal

## Why

应用当前存在两个渲染同一 `SessionPage` 的会话宿主——独立会话页面与书籍工作台右栏对话面板，且「自由会话」（未绑定书籍的会话）作为独立页面存在的理由已不成立：绑定会话的唯一宿主本就是书籍工作台，子代理查看却仍绕道首页，形成双宿主并存、入口错位的信息架构冗余。会话应收敛为「必须归属于书籍」，书是唯一容器。

## What Changes

- **BREAKING** 退役独立会话页面：独立会话路由降级为兼容重定向层，绑定会话深链重定向到所属书籍的工作台对话面板，未绑定的遗留会话深链降级到书架并提示。
- **BREAKING** 移除自由会话概念：下线首页「全局对话」分组与首页新建草稿入口，所有新建会话入口均创建书籍绑定会话（书内切换器「+」为唯一常规入口）；已有自由会话数据保留在库中但不再提供常规界面入口。
- 书内会话切换器新增子代理嵌套展示：子代理会话按父会话分组、默认收纳、点开展开，点击在书内右栏打开（懒绑定保证路由可达）。
- 新建会话草稿页（`/new-session`）随自由会话入口一并退役；书内新建走切换器「+」直接创建绑定轻会话。
- 修订 `titlebar-tabs`、`novel-workspace-layout`、`novel-chat-panel` 三份 spec 中涉及自由会话、会话页面与子代理过滤的 requirement。

## Capabilities

### New Capabilities

（无——本变更不引入新系统能力，只收敛既有能力的边界。）

### Modified Capabilities

- `titlebar-tabs`：「会话退出标签体系」改写为「会话归属书籍」——移除自由会话从会话页面进出的规定，明确会话不注册标签、独立会话页面退役、遗留会话/草稿标签清除策略保留。
- `novel-workspace-layout`：「绑定会话统一在工作台打开」扩展为「全部会话统一在书籍工作台打开」——删除未绑定自由会话走独立会话视图的场景，新增遗留未绑定会话深链降级行为。
- `novel-chat-panel`：「会话切换器常驻可见」的子代理排除规则改为嵌套收纳展示——子代理按父会话分组、默认折叠、展开后在书内打开。

## Impact

- **packages/app**（主要改动面）：
  - 路由层 `app.tsx`：独立会话路由改为重定向决策；`/new-session` 草稿页退役。
  - `pages/session.tsx`：独立会话页降级为重定向宿主；`pages/session-route.ts` 路由决策简化。
  - 首页会话面：`pages/sessions.tsx`、`sessions-novel-sidebar.tsx`、`novel-sessions.ts` 移除自由会话分组与入口（级联归档逻辑保留供书籍删除使用）。
  - 书内切换器：`pages/novel/session-switcher.tsx`、`context/novel-queries.ts`（`boundNovelSessions` 放宽 `parentID` 过滤并按父分组）、`workspace-frame.tsx`。
  - 草稿提交链路：`components/prompt-input/submit.ts` 的 `sessionHref` 跳转改为书籍工作台路由。
- **packages/protocol / schema / server / client**：无 API 契约变更，无需重新 generate。
- **packages/desktop / novel-store / plugin / core**：无改动；会话绑定机制（懒绑定）复用现状。
- **数据兼容性**：不删数据、不迁移 schema。已有自由会话记录保留在 SQLite 中，仅失去常规入口；绑定关系表结构不变。i18n locale 文件保持不动。
