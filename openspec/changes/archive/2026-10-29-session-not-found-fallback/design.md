# Design

## 现状与证据

2026-10-29 在桌面端（dev，开发构建）真实复现：在书“末世指挥官”的右栏对话面板新建轻会话后，
从时间线标题的“更多选项 → 删除”删除当前打开的会话，面板立即显示通用错误页“出了点问题”，
且停留在已删除会话的路由；页面刷新后仍是同一错误页，只能返回书架再重新进入书籍。

临时插桩（已回滚）记录到两段关键证据：

1. 错误来源：`WorkspaceSessionGate` 的 lineage 解析会话失败（`[debug-lineage] throw-failed`），
   抛出的不是本地合成的“会话不存在”，而是 SDK 的 404 错误体。
2. 错误形状：边界确实捕获了错误（`[debug-boundary] caught ... true`），但捕获到的是
   `Error("Unknown error", { cause: { _tag: "SessionNotFoundError", sessionID, message } })`——
   `cause` 本身就是命名错误体，而不是 `cause.body`。`unwrapNamedError` 只识别 `cause.body`，
   于是 `isSessionNotFoundError` 返回 false，`SessionErrorFallback` 落入通用 `<ErrorPage>`。

同时，删除流程在导航到工作台基础视图后立即清理同步缓存并异步刷新归属会话；工作台的
“未选中会话自动回跳”仍可能读取到包含已删除会话的旧集合与指向它的会话记忆，把用户带回
刚删除的会话，再次触发同一错误路径。

## 决策

### D1 统一“会话不存在”判定

扩展 `packages/app/src/utils/server-errors.ts` 的错误解包：命名错误可以出现在两种位置——
`error.cause.body`（未解码的 HTTP 错误）与 `error.cause` 直接就是命名错误体（Solid 的
`castError` 会以 `cause` 承载非 Error 的抛错值）。两种形状都 SHALL 解包成功，且
`isSessionNotFoundError` 继续校验 `_tag === "SessionNotFoundError"` 与 `sessionID` 匹配，
避免把其他命名错误误判为会话缺失。

本地合成的 not-found（`sessionNotFoundError`，消息 `Session not found: <id>`）保持既有判定，
两条路径共用同一句判定谓词。

### D2 lineage 解析失败归一

`pages/session/session-lineage.ts` 在 `resolve` 失败时，若失败可判定为“会话不存在”，
SHALL 以本地合成的 not-found 语义上报（与“已落定但缓存缺失”分支一致），使边界稳定渲染
“会话无法找到”兜底；其他失败（网络、5xx、超时）MUST 保留原始错误，继续走通用错误页。

归一放在 lineage 内部完成，兜底组件与调用方无需理解 SDK 的错误包装形状。

### D3 删除流程的定位顺序

`pages/session/timeline/message-timeline.tsx` 的书内删除（`params.novelID` 存在）调整为：

1. 调用 `session.delete`；
2. 等待归属会话集合重新拉取完成（`queryClient.invalidateQueries` 返回的 Promise，
   TanStack v5 默认在重新拉取结束后 resolve，失败不抛出）；
3. 在同一同步块内从同步 store 移除该会话与后代，再导航到工作台基础视图；
4. 指向已删除会话的会话记忆由工作台的记忆清理 effect 在归属集合刷新落地后清除
   （`settleRememberedSession`：记忆不在刷新后的树中即清除；集合仍在 refreshing 时
   保持原值，避免误清刚新建、尚未进入列表的会话）；
5. 工作台既有的自动回跳按刷新后的集合与清理后的记忆定位：仍有未归档会话则落到最近活跃
   主会话，否则保持基础视图（懒创建空态）。

刷新必须早于缓存移除：刷新期间路由仍指向被删会话，若先清除同步缓存，lineage 会立刻落到
未命中并弹出“会话无法找到”兜底，违背“删除本身不得产生兜底”。记忆清理放在工作台而非
删除流程内，是因为按书存档（`novel.workspace.state.v1`）只在工作台内持有；由集合刷新
驱动清理，无需把存档提升为跨模块状态。

非书内会话（独立会话路由）维持现有“取相邻会话或回首页”行为，不做改动。

### D4 书内兜底返回入口

`SessionRouteErrorBoundary` 增加可选的关闭/返回目标参数，书内工作台传入
`/${dir}/novel/${novelID}`（工作台基础视图）；未提供时保持 `navigate("/")` 的现有行为。
文案复用既有 `session.error.notFound*` 键，不新增 i18n key。

### D5 测试策略（先失败后修复）

- `server-errors` 单元测试：三种形状均判定为会话不存在（`cause.body`、`cause` 即命名体、
  本地消息），且错误 `sessionID` 不匹配或 `_tag` 为其他错误时判定为否。
- `session-lineage` 单元测试：`resolve` 以命名 404 失败时抛出的错误可被 not-found 谓词识别；
  以网络错误失败时保留原错误。
- 书内删除流程：以纯函数/存储注入方式验证删除后回跳目标不包含被删除会话（记忆被清理、
  集合刷新后定位到剩余会话）；删除最后一个会话时不进入错误态。

### D6 持久化序列化必须无追踪（验收补充，2026-10-29）

桌面端验收时发现书内面板出现约 50Hz 的写入回环：工作台的记忆清理 effect（写
`sessionId: undefined`）与记忆写入 effect（把路由会话 id 写回存档）互相重跑，最终在深层
effect 波次中抛 `RangeError: Maximum call stack size exceeded`（约 60 秒必现）。

根因在 `packages/app/src/utils/persist.ts`：`@solid-primitives/storage` 的 `makePersisted`
只对 store 引用本身执行 `untrack`，序列化遍历（`JSON.stringify(store)`）仍在调用方
computation 的追踪上下文中执行。store 代理的 `ownKeys` 与属性读取会把该 computation
订阅到整个 store 的 `$SELF` 节点，于是「清理写入」重跑「记忆写入」、后者写回又重跑前者。

修复：`persisted` 传入整体 `untrack` 的自定义 `serialize`（序列化不代表任何响应式依赖），
`snapshot` 同样在 `untrack` 中执行。回归用例在 `persist.test.ts`：computation 内写入存档后，
外部再写同一 store 不得重跑该 computation。该修复不影响持久化格式与调用方 API。

## 兼容性

- 不改变 Protocol / Server HttpApi，不需要在 `packages/client` 重新生成 SDK。
- 无数据库、持久化结构或本地数据迁移；会话记忆仅是既有按书状态中的一个字段。
- 错误判定放宽仅限“命名错误体”形状，其他错误路径行为不变。

## 风险与取舍

- 等待归属会话集合刷新会让删除后的定位推迟到一次网络往返结束；相比回跳到已删除会话
  （必然错误页），延迟更可接受；拉取失败时定位仍落到基础视图而非错误页。
- 若未来 SDK 更换错误包装形状，D1 的两种解包位置需要随之扩展；判定谓词集中在一处，
  扩展成本低。
