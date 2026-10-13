# Design

## Context

当前 `SessionPage` 有两个宿主：独立会话路由与书籍工作台右栏对话面板。会话打开已统一经过 `openSessionRouted` + `resolveSessionRoute` 纯函数决策：绑定会话进书籍工作台，未绑定会话进独立会话页。首页会话面（sessions 页）按书籍分组列出会话并附「全局对话」未绑定分组，子代理会话以嵌套行挂在父会话下（点击经统一打开动作落在书内）。书内切换器（`NovelSessionSwitcher`）的数据源 `boundNovelSessions` 显式过滤 `session.parentID`。草稿流程以独立页面形态存在（`/new-session`），提交后跳独立会话路由。懒绑定机制保证子代理会话会被绑定到所属书籍。

## Goals / Non-Goals

**Goals:**

- 独立会话路由降级为重定向宿主：绑定深链重定向进书，遗留未绑定深链降级到书架
- 首页会话面移除自由会话分组与新建草稿入口，保留「书籍会话快捷入口」语义
- 书内切换器嵌套展示子代理会话（默认折叠、展开查看、书内打开）
- 草稿页与草稿 tab 逻辑退役，书内切换器「+」成为唯一常规新建入口

**Non-Goals:**

- 不删除、不迁移任何会话数据；不改 SQLite schema 与服务端 API 契约（无需 SDK 再生成）
- 不处理 CLI/TUI 侧创建的会话（无 UI 入口即可，不做主动清理）
- 不改 i18n locale 文件；下线界面遗留的未用 key 保留，子代理嵌套复用既有 `home.sessions.sidebar.subagent` 文案

## Decisions

### D1 独立会话路由保留路径、替换渲染内容为重定向

删除路由会让历史深链 404；保留路径并把 `SessionPage` 替换为轻量重定向组件（复用 `resolveSessionRoute`：绑定 → `replace` 跳书内会话路由；未绑定 → 跳书架 + toast 提示）。独立会话页面专属组件（`SessionNovelPanel`、`ResolvedTargetSessionRoute`、`TargetSessionPage`）随之移除；`session-panel-width` 与 `session-panel-layout` 经核实被工作台内嵌的 `Page()` 共用，保留。备选的「删路由 + 全局 404」方案对存量链接不友好，弃。

### D2 首页会话面保留但语义收敛为书籍会话快捷入口

`sessions.tsx` 列表与小说分组侧栏保留——所有行均为绑定会话，点击仍走统一打开动作进书内；移除「全局对话」未绑定分组（`showUnbound` 链路）、自由会话行与首页新建草稿入口。理由：书架页保留「快速回到某本书的对话」的可达性，删除整页属于超出本变更范围的首页信息架构重排。备选「整页下线」留待后续首页重设计提案。

### D3 切换器子代理嵌套：数据层按父分组，孤儿不展示

`boundNovelSessions` 返回结构扩展为「主会话 + children 子代理列表」（同一次目录会话查询内用 `session.parentID` 分组，不新增请求）。父会话归档或缺失的子代理（孤儿）不展示，避免悬空入口。切换器下拉渲染两层菜单，复用 `home.sessions.sidebar.subagent` 文案做视觉区分；点击子代理子项导航 `/:dir/novel/:novelID/session/:subagentID`——`SessionPage` 对子会话已有的 prompt 禁用逻辑（`session.child.promptDisabled`）自然生效，只需读视图不需新增限制。

### D4 草稿页整体退役而非改造成书内草稿

书内「+」已实现「创建 + 绑定 + 切入」且不发自动 prompt，草稿页在其之上没有独立价值。删除 `/new-session` 页面、`tabs.newDraft` 入口与 `prompt-input/submit.ts` 的草稿提升分支（全仓 grep `draftId|newDraft|new-session` 审计后移除）。备选「把草稿页嵌进书内对话面板」增加两套空态交互，收益为零，弃。

### D5 路由决策函数保留纯函数形态、语义改为二值

`resolveSessionRoute` 保留独立模块与单测（无 router 依赖便于测试），返回类型从 `novel | tab` 改为 `novel | orphan`：`orphan` 由调用方执行「书架 + 提示」降级。绑定查询失败仍按未绑定降级，会话始终有去处。

## Risks / Trade-offs

- [历史深链或外部集成硬编码独立会话路由] → D1 重定向层保路径不变，仅替换渲染内容
- [首页会话列表可能残留已无绑定关系的自由会话行] → 列表渲染以绑定关系取交集（复用现有过滤），查不到绑定即不显示
- [草稿相关代码分散，删除遗漏形成死代码] → 实现时以 `draftId|newDraft|new-session` 全仓 grep 审计，tasks 列显式清单项
- [切换器嵌套菜单在小宽度右栏中的可用性] → 复用首页侧栏已验证的嵌套行样式与折叠交互，子项缩进层级浅（一级）

## Migration Plan

单功能分支交付，纯 UI 层变更，无 schema/API 迁移。回滚策略：revert 分支即可，存量自由会话数据自始至终未动。

## Open Questions

（无——首页会话列表保留语义、孤儿子代理不展示、草稿页整体退役均已在本设计中定死。）
