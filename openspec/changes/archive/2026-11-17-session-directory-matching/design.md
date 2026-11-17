# Design

## Context

见 proposal.md - Why。已取证的事实约束：

- 服务端 session 表 `directory` 列的存储/读出均为正斜杠存储格式（`directoryColumn`，2026-11-10 修复 location 层树分裂的要义，不可回退）；`session.get/list` 响应的 `location.directory` 因此为正斜杠形态。
- 混合形态的天生来源（三处）：
  1. `session.next.created` 事件 schema 的 `directory: AbsolutePath` 原样透传发布时的位置串（请求头形态）；
  2. `project.worktree` 经 `absoluteColumn` 的 `toPlatform` 在 Windows 读出为反斜杠；
  3. 事件目录戳由服务端 global-event-bridge 生成：`event.location?.directory ?? ctx?.directory`——请求期发布的事件（session.create 等）带请求头形态，会话运行期事件（session runner）带会话行存储形态（正斜杠）。用户 DB 事件行实证同一 payload 内两种形态并存。
- 客户端会话 info 全局缓存（`server-session`）由多源播种：create 响应、`session.get`、`session.list`、事件，写入用 `reconcile` 整体覆盖——条目目录串随最后写入者翻转。
- `pathKey`（`utils/path-key.ts`：分隔符统一、尾斜杠修剪、盘符根补 `/`）是客户端目录判等的既有主流惯例：global-sync 直接以 `directoryKey` 名义 re-export（`global-sync/utils.ts:3`），layout / global / server / persist / prompt-project-selector / home-session-index / layout/helpers（`isRootVisibleSession`、`projectForSession`）等 30+ 处在用。**会话取用链路（directory-sync / bootstrap 清理过滤 / sidebar 归属过滤 / notification）是未对齐的离群点**。
- 事件分发两层结构：全局 emitter 以 raw `event.directory` 为键 emit（`server-sdk.tsx:152`），全局 `listen` 无键全收（`server-sync.tsx:393`，经 `directoryKey` 查 children——已归一），但目录子作用域以 raw 路由目录 `on` 订阅（`server-sdk.tsx:348`）；订阅键与事件键形态错配时子作用域静默漏事件（如 `novel-live.ts:135` 的书籍实时失效退化为 15s 轮询兜底）。

## Goals / Non-Goals

**Goals:**

- 会话 info 按目录作用域的取用、索引、归属过滤在任何播种来源组合下结果稳定，形态差异（分隔符、尾斜杠）不造成漏配。
- 缓存条目的目录串形态在适配出口即归一，消除"最后写入者决定形态"的翻转根源。
- 事件目录在客户端入口处归一，事件路由/合并/通知索引的键形态唯一且稳定。
- 全客户端只有一份目录相等语义（`pathKey`），新增比较点有据可依。

**Non-Goals:**

- 不改动 `Location.Service.directory` / HTTP 头 / `sharedRef` 的原串传递（LayerMap 去重依赖）。
- 不改动服务端 `directoryColumn` 存储读出语义与事件发布侧目录戳（`global-event-bridge`），归一收敛在客户端入口。
- 不改动既有持久化状态的键形态：workspace 状态存储键已是 `pathKey`（`utils/persist.ts:353-371`）；`workspaceExpanded` 的键现状为原串混合形态，属既有的表面性状态问题（折叠展开记忆），本变更只对齐其默认值比较（layout.tsx:597），不改键。
- 不引入大小写归一；不处理 UNC/盘符以外的新路径形态。

## Decisions

### D1：比较点双侧 `pathKey` 归一化

所有"会话/项目 info 目录 vs 作用域目录"的相等判定改为 `pathKey(a) === pathKey(b)`。

- 替代方案：服务端响应归一（违背 11-10 修复语义，会复活 location 层树分裂，排除）；客户端在路由/SDK 入口全局规范化目录串（波及面不可控：持久化键、URL 编码、既有事件流，排除）。
- 落点（已逐点核实）：
  - 核心 bug 点：`context/directory-sync.ts` 的 `index()`（:49）与 `session.get`（:83）。
  - bootstrap 过滤：`global-sync/bootstrap.ts` 的 seededPath（:227）、session_status/permission/question 清理过滤（:260/:312/:342）、`projectID` 的 worktree/sandboxes 匹配（:144；先例：`layout/helpers.ts:114` 同形查找已 pathKey）。
  - 侧栏归属过滤：`sidebar-items.tsx:41`、`sidebar-project.tsx:308`。
  - 通知匹配：`notification.tsx:326`（当前会话已读判定）、`pages/home.tsx:305-312`（project unseen 计数/清除的索引查找）。

### D2：适配出口统一目录串形态

`utils/v2-adapter.ts` 的 `adaptInfo` / `adaptCreated` 出口将 `Session.directory` 归一为 `pathKey` 形态（`subpath` 等其余字段不动），使全局缓存条目形态稳定。事件入口（`server-session.ts:833` applyV2 created、`server-sync.tsx:405` homeSessions）与 `session.list`（`directory-sync.ts:129`）均经这两个出口，一并收敛。其余消费方（如 `server-session.ts:194` 的会话级上下文组装）随之受益。

- 替代方案：仅做 D1 比较点归一——能修 bug，但缓存条目形态仍随播种源翻转，其余裸消费点继续暴露在翻转之下，排除"只修一半"。

### D3：归属判定族对齐，持久化键不动

`directory === project.worktree` 归属判定族改用 `pathKey` 比较：`layout.tsx:597`（默认展开判定）、`layout.tsx:554`（autoselect 自动选回上次项目——`server.projects.last()` 为持久化 store，`context/server.tsx:139-140`，历史值形态与列表 worktree 跨源）、`session.tsx:717`（新会话工作区选择）、`components/session/session-new-view.tsx:34`、`pages/home.tsx:834`、`sidebar-workspace.tsx:75/:316`（同文件 :317 已 pathKey，属同函数内新旧并存）、`sidebar-project.tsx:299`。改动机械、验证面清晰。

### D4：事件目录在客户端入口归一（新增决策）

在 SSE 事件进入客户端的唯一入口归一 `event.directory`，并把目录子作用域的订阅键同样归一：

- 入口：`server-sdk.tsx` 事件入队处（:221-223）将 `event.directory ?? "global"` 过 `pathKey` 后再入队——下游 emit 键（:152）、相邻增量合并键（`coalesceServerEvents` :83）、通知 append 键、`applyDirectoryEvent`、children 查找全部随之一致。
- 订阅侧：`server-sdk.tsx` 暴露的 `event.on`（:293）包装为 `emitter.on(directoryKey(key), fn)`（`listen` 无键透传不动）——`createDirSdkContext`（:348）与 `novel-live.ts:135` 等订阅方自动对齐，形态错配不再静默漏事件。
- 备选方案：逐订阅点归一（21 处订阅/分发点逐个改）——遗漏风险高且无单一真源，排除。
- 语义变化登记：监听方拿到的 `e.name` 由混合形态收敛为存储规范形态（正斜杠），回传 API 安全——已核实 `AbsolutePath` 为纯字符串品牌（`packages/schema/src/schema.ts:16`，无 toPlatform/fromPlatform 转换），且正斜杠恰与 session 行存储格式一致；通知索引键随之统一，home/侧栏查找配合 D1 归一后命中。

### D5：`pathKey` 语义边界沿用既有先例

`pathKey` 不做大小写归一（Windows 下 `D:\X` vs `d:\x` 仍不相等）——与 layout/helpers 现有用法一致；大小写等价超出本次取证范围，列入 Risks 而非需求。

## 排除清单（已核实，明确不改）

- `session.tsx:866`（`sdk().directory !== dir`）——同源自比较的计时器防抖守卫。
- `session.tsx:698`（`directory !== root`）——root 与 directory 均由同次调用的 `reviewRootDirectory`/`reviewDiffDirectory` 推导，同源同形。
- `layout.tsx:1368/:1428`（`directory === root`）——deleteWorkspace 系参数来自同一 workspaceIds 列表，同源。
- `layout.tsx:274/:280`（hoverProject / peek 匹配）与 `sidebar-project.tsx:41/:280`（拖拽 overlay、currentProject 链）——写入侧均为 nav/列表渲染的 worktree 值（:210/:1890/:290），currentProject 匹配已 pathKey（:1303），同源。
- `home.tsx:281`（selectProject 项目存在性判定）与 `layout/helpers.ts:65/:76`——项目选择族，选择状态与参数均来自项目列表/目录选择器，同源；`home.tsx:903`（`~/path` 显示化简）home 与 worktree 同源读出。
- `server-sync.tsx:92/:94`（`directory === null`）、`context/sdk.tsx:13`（typeof 判断）——哨兵/类型判断，非路径相等语义。
- `context/file/tree-store.ts:66/:111`、`context/file.tsx:186/:195`（`scope() !== directory`）——文件浏览子系统的 watcher 作用域判定，proposal 非目标明确不动文件/diff 子系统。
- `context/server.tsx:91-132`（项目 open/close/touch/remove 的列表操作族）——与项目选择族同源（directory 参数来自 UI 交互链），同族排除。
- `sidebar-items.tsx:189/:195`（nav 预取列表条目匹配）——item 与 session 同源列表，D2 归一后形态统一；匹配失败仅退化预取范围，非正确性路径。
- `child-store.ts:145`（`directory !== skip`）——skip 参数同源列表迭代。
- `child-store.ts` 系——实例键已是 `pathKey`（`directoryKey` re-export）。
- 持久化写入侧（`utils/persist.ts:353-371` 已 pathKey；`server.tsx:143` lastProject 写入）——持久化键与写入形态不动，只归一读取比较（见 D3 的 layout.tsx:554）。
- 服务端 `directoryColumn`、`Location.Service`、`sharedRef`、事件发布侧目录戳——非目标（见 Non-Goals）。

## Risks / Trade-offs

- [持久化状态中既有混合形态键与新语义长期并存] → 持久化键本变更不动；workspace 状态存储键已 pathKey；`workspaceExpanded` 表面性问题（折叠记忆偶发失效）登记不修。
- [intake 归一改变监听方拿到的 `e.name` 形态] → 收敛到服务端存储规范形态，属预期统一；事件路由单测覆盖（订阅键形态差异下 dir 订阅仍收到会话事件）。
- [on 包装需保持退订语义不变] → 包装函数直接透传 `emitter.on` 返回的 unsubscribe。
- [比较点穷举可能有漏] → 实现任务以 `grep "directory === " / "directory !== "` 全量清单为输入，收尾任务复核 diff 并复查新增比较点（含本设计排除清单逐项确认）。
- [Windows 路径大小写差异] → 不在本变更范围；若后续立案，`pathKey` 是唯一需要扩展的语义点。

## Migration Plan

无数据迁移、无协议变更、无 SDK 再生成。纯客户端行为修复，随常规发布渠道生效；用户侧表现为重开会话后发送恢复正常、书籍实时失效不再依赖轮询兜底。
