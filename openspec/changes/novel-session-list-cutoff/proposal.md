# Proposal

## Why

书内会话数据的两条链路都依赖「绑定关系 ∩ 全局 `session.list` 结果」：`session.list`（`/api/session`）有默认分页上限（最新 50 条，按 `time_updated` 倒序），且 HTTP 契约未暴露 `roots` 过滤参数。当一本书目录下的会话总数超过这个窗口时，落在窗口之外的绑定会话会被静默视为"不存在"：

- 切换器与自动回跳：窗口内一条绑定都不剩时显示"暂无会话"、自动回跳失效——用户已在《金牌》（`C:\Novels\audits`）实测：重新打开书籍不显示会话，新建一个会话后才恢复可见。
- 写作流兜底（`findBoundNovelSession`）：批注"执行"/驳回重写指令误判"无绑定会话"而静默新建会话；取消生成、审批栏"查看评审"因找不到主线会话而静默无效。

## What Changes

- `packages/protocol` 的 `SessionsQuery` 新增可选查询参数 `roots`（布尔；服务端 `ListInput` 早已支持，仅暴露到 HTTP 契约）。字符串到布尔的解码遵循仓库既有 Effect 4 惯用法（`SchemaGetter.transform`）。
- `packages/client` 重新生成 SDK（`bun run generate`），使客户端可以传 `roots`。
- `packages/app` 的两处书内会话查询统一改为 `session.list({ roots: true, limit: 1000 })`（共享同一参数常量）：
  - `useBoundNovelSessions`（`src/context/novel-queries.ts`）：服务端先把子代理会话过滤出窗口，绑定会话不再被挤占或截断。
  - `findBoundNovelSession`（`src/pages/novel/workspace-data.ts`）：写作流/审批流/取消操作的主线会话定位不再误判。
- 在 `novel-chat-panel` 与 `annotation-execute-flow` 规格中固化行为契约：书内"会话是否存在/最近会话是谁"的判定不随目录会话总量退化，并补充分页压力场景。

非目标：

- 不改动全局会话页（sessions 页面）、首页卡片、导航标签等展示型"最近会话"窗口的分页语义（`home.tsx`、`layout.tsx`、`novel-sessions.ts`、`directory-sync.ts` 保持现状）。
- 不新增"按绑定 ID 批量取会话"的专用端点（当前 limit 1000 远大于单书根会话量的现实规模；未来真有超大数据书再单独立案）。
- 不改动归档过滤、子代理过滤（客户端过滤逻辑保持现状，作为双保险）。
- 不改动懒创建会话流程与"+"号入口行为。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `novel-chat-panel`: 强化"会话切换器常驻可见"与"未选中会话时自动回到最近绑定会话"——书内绑定会话列表的完整性 MUST NOT 受目录会话总量或全局分页窗口影响；补充"目录下大量子代理会话挤占最近窗口"的场景。
- `annotation-execute-flow`: 强化"AI 批量执行指令"——"最近使用的会话"的判定 MUST 基于完整的绑定关系，不得因分页窗口截断而误判为"不存在"并错误创建新会话。

## Impact

- `packages/protocol`：公开查询参数新增可选 `roots`（向后兼容的纯增量变更）。
- `packages/client`：运行 `bun run generate` 重新生成（禁止手改 `src/generated`）。
- `packages/app`：`src/context/novel-queries.ts` 与 `src/pages/novel/workspace-data.ts` 两处查询参数调整，新增一个共享参数常量。
- `packages/server`、`packages/opennovel`：无需改动——handler 已透传 query，`ListInput`/`listByProject` 已支持 `roots`。
- 兼容性：无数据迁移；现存本地数据（全局库 + 书库）完全兼容，仅查询语义变化。
