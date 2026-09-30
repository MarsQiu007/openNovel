# Design

## Context

书内会话数据有两条链路都依赖「绑定关系 ∩ 全局 `session.list` 结果」：

1. 列表链路：`packages/app/src/context/novel-queries.ts` 的 `useBoundNovelSessions` 并行拉取
   `server.novel/session-bindings` 与 `sdk().client.session.list({ directory })`，
   客户端 `boundNovelSessions` 取交集后剔除归档与子代理会话。切换器
   （`session-switcher.tsx`）与自动回跳（`workspace-frame.tsx` 的
   `resolveAutoAdoptTarget`）共用这一 hook。
2. 主线定位链路：`packages/app/src/pages/novel/workspace-data.ts` 的
   `findBoundNovelSession` 用同样模式取第一个未归档绑定会话，供
   `sendNovelSessionInstruction`（批注执行/驳回重写指令）、`cancelGeneration`
   （取消生成）、审批栏"查看评审"三个入口使用。它对"无绑定会话"的误判会直接走
   `createAndBindSession` 静默新建会话，或使取消/跳转静默无效。

`session.list`（`/api/session`）在未传 `limit` 时取最新 50 条（`DefaultSessionsLimit = 50`，
按 `time_updated` 倒序）。服务端 `Session.list` / `listByProject`
（`packages/opennovel/src/session/session.ts`）的 `ListInput` 早已支持
`roots?: boolean`（过滤 `parent_id IS NULL`），但 HTTP 契约 `SessionsQuery`
（`packages/protocol/src/groups/session.ts` 的 `SessionsQueryFields`）没有暴露，
客户端无法使用。

用户环境实测（《金牌》，`C:\Novels\audits`）：目录下 123 个会话中 106 个是子代理
会话，它们频繁刷新 `time_updated`，把 50 条最近窗口几乎占满；该书 15 条在库绑定中
仅 8 条落在窗口内，其余被截掉。窗口内绑定会话数为 0 时，两条链路同时失灵：切换器
显示"暂无会话"、自动回跳失效；写作指令误判"无会话"而新建会话。

## Goals / Non-Goals

**Goals:**

- 书内"会话列表完整性"与"主线会话定位"不再依赖全局列表分页窗口的运气。
- 子代理会话流量不得挤占书内查询的窗口位置。
- 协议变更为纯增量可选参数，向后兼容。

**Non-Goals:**

- 不改动全局会话页、首页卡片、导航标签等展示型"最近会话"窗口的语义
  （`directory-sync.ts`、`home.tsx`、`layout.tsx`、`novel-sessions.ts` 保持现状，
  它们的语义本就是"最近的 N 条"，不是"全部绑定"）。
- 不引入"按绑定 ID 批量取会话"的专用端点或 N 次 `session.get` 循环。
- 不改客户端 `boundNovelSessions` / `findBoundNovelSession` 的过滤语义（保留为双保险）。

## Decisions

### D1：协议暴露 `roots` 参数，客户端两处调用统一传 `roots: true` + 放大 `limit`

在 `SessionsQueryFields` 增加可选布尔字段 `roots`。query string 到布尔的解码遵循
仓库既有 Effect 4 惯用法（参照 `packages/schema/src/schema.ts` 的
`DateTimeUtcFromMillis`）：

```ts
Schema.String.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((s) => s === "true"),
    encode: SchemaGetter.transform((b) => String(b)),
  }),
)
```

注意：Effect 4 beta 没有 `Schema.BooleanFromString`（实测不存在），不能照搬旧
API。handler 现有实现是 `session.list({ ...query, workspaceID, limit })`，`query`
展开即自动透传，`packages/server` 与 `packages/opennovel` 零改动。

备选方案：

- **只在 app 放大 `limit`（如 1000），不动协议**：改动最小，但子代理会话仍在窗口
  内参与排序挤占；目录下会话数一旦超过 limit，老绑定会话照样被截。治标不治本。
- **新增专用端点（服务端 join 出绑定会话）**：最彻底，但要动 novel 协议组与服务端，
  回归面大；当前问题规模不值得。

### D2：`limit` 取固定 1000 而非按绑定数动态计算

`roots: true` 已把窗口收敛到根会话（现实规模 ≪ 1000，实测该书根会话仅 18 个）。
固定 1000 足够覆盖单书全生命周期，避免"绑定数 × 系数"这类启发式在未来数据形态
变化时再次失效。

### D3：两处调用共享同一个参数常量

`useBoundNovelSessions` 与 `findBoundNovelSession` 使用同一
`{ roots: true, limit: 1000 }` 参数（常量在 `novel-queries.ts` 导出、
`workspace-data.ts` 引用），避免魔法数漂移。客户端过滤逻辑
（归档、子代理、未知会话）保留不动，防御其他调用路径的回归。

### D4：客户端组合逻辑保持现状

`boundNovelSessions` 与 `findBoundNovelSession` 的过滤语义不变：即使服务端
`roots` 过滤生效，客户端再滤一次也无害。

## Risks / Trade-offs

- [单书根会话数突破 1000 时仍可能截断] → 规模远超当前现实（单书根会话 ~20）；
  真出现时按 proposal 的非目标另行立项（专用端点/cursor 翻页）。
- [`roots` 进入 cursor 编码] → `withCursor` 只剔除 `limit`，`roots` 会随 cursor
  烘焙，行为正确（翻页保持同一过滤语义），无需额外处理。
- [布尔 query 参数接受任意字符串] → 解码只对 `"true"`/`"false"` 生效，其他值
  走 schema 校验失败路径，与现有 `limit` 等参数行为一致。
- [协议字段命名与服务端 `ListInput.roots` 不一致的未来风险] → 同名对齐，且
  `bun run generate` 后客户端类型直接由协议生成，漂移会在编译期暴露。

## Migration Plan

1. `packages/protocol` 增加 `roots` 查询字段。
2. `packages/client` 运行 `bun run generate` 再生成 SDK（禁止手改 generated）。
3. `packages/app`：`useBoundNovelSessions` 与 `findBoundNovelSession` 改用共享
   参数常量（`roots: true, limit: 1000`）。
4. 回归：单测 + 用户环境验证（重开《金牌》，切换器列出全部绑定会话并自动回跳；
   批注"执行"路由到既有主线会话而非新建会话）。

无数据迁移；回滚即还原三处改动。
