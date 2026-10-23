# Design: e2e-v2-mock

> 输入：两份侦察（被删资产盘点、V2 wire 与幸存套件状态）+ 自行核实的关键事实（v2-adapter 透传面、schema 包 V2 校验来源、session-ui metadata 消费面）。被删资产模板：`git show cdf9c4f0d2^:<path>` 或 `.agent_tmp/deleted-e2e/`。

## 1. 现状与根因

### 1.1 wire 差（根因）

app 消息拉取自 runtime-v2-cutover 起全部走 V2（`server-session.ts:527-561`）：

- 列表 `GET /api/session/{id}/message?limit&order=desc&cursor` → `{data: SessionMessage[], cursor: {previous?, next?}}`；app 反转 desc 为升序后喂 `adaptMessages`，`complete = !cursor.next`。
- 单条 `GET /api/session/{id}/message/{mid}` → `{data: SessionMessage}`；404 按已删除记 tombstone（`server-session.ts:717-724`）。
- 联动路由：`step.ended`/`tool.success` 触发 `GET /api/session/{id}/diff`；`GET /api/session/{id}/todo`；`GET /api/permission/request`、`GET /api/question/request`（体 `{location, data: [...]}`，app 读 `x.data?.data ?? []`）。

幸存 mock-server.ts 只有 V1 路由（`/session/:id/message` 裸数组 + `x-next-cursor` 头），上述 V2 路由**全部不存在**，落 catch-all 返回 `{}`（mock-server.ts:166）。

### 1.2 三档后果

1. **消息历史**：`response.data = {}` 时 `response.data?.cursor.next` 抛 TypeError（可选链只在 `response.data` 本身 nullish 时短路）；TypeError 非瞬时错误不重试，`loadMessages` 失败被调用方吞掉（`.catch(() => {})`）→ **时间线静默为空，页面其余正常渲染**。
2. **session info**：单条 get 同样失败，但 `/api/session` 列表（活路由，V2 信封正确）水合 `remember` → 标题等 info 依赖仍可渲染。
3. **permission/question 列表**：`x.data?.data ?? []` 对 `{}` 优雅降级为空 → dock 永不出现。

### 1.3 在 CI 的死/活表（playwright 收集面）

| Spec | 状态 | 死因/活因 |
|---|---|---|
| smoke/session-timeline.spec.ts | 死 | 3 用例全靠 pageMessages 331 part 播种与 `onMessages` 回调；test1 等 `before` 请求到 120s 超时 |
| regression/session-timeline-collapse-state.spec.ts | 死 | 断言的 part 来自 pageMessages 播种；后续 SSE 事件依附的消息不存在 |
| regression/session-timeline-context-resize.spec.ts | 死 | 同上 |
| regression/subagent-child-navigation.spec.ts | 死 | 子会话标题派生自父会话 task part；另自注册 V1 `/session/:id` 路由 |
| regression/session-request-docks.spec.ts | 半死 | test1/2 靠 `/question`、`/permission` 列表播种 dock → 空；test3 走 SSE `question.asked` 伪事件（apply 仍处理 V1 词汇）可能仍绿 |
| 其余 9 个 regression + novel 10 + 顶层 4 + reproduction 2 | 活 | 断言不依赖消息；TypeError 被吞后优雅降级 |
| performance/timeline/* | 死（不进 CI） | CI `testIgnore: performance/**` |

### 1.4 独失覆盖与幸存等价物

幸存等价物（不重复建设）：smoke ≈ 工具族静态准入 + 锚定；collapse-state ≈ 折叠保留 + 身份保持；context-resize ≈ context 组视觉过渡；request-docks test3 ≈ SSE question 流；`performance/unit/visual-stability.test.ts` ≈ 分析器纯函数校准。

独失清单中属本提案范围（去重后）：SSE 传输契约 7 用例、历史分页协议断言、reasoning/Thinking 投影矩阵、工具错误卡与 provider 标签矩阵、重复投递幂等与增量更新、turn 结构投影（TurnDivider/compaction/中断行）、context 组归并规则、fixture 校验基础设施。属后续提案：视觉连续性 11 场景、像素级预言机、locale/无障碍、performance V2 化。

## 2. 总体方案

三波串行（Wave 2/3 依赖 Wave 1 的 fixture 与路由面）：

- **Wave 1 — mock 基建 V2 化**：路由面 + fixture 工厂 + 校验防线 + catch-all 404 化 + 死参数清理。守门：全量 e2e 复跑，9 个活 spec 不回归。
- **Wave 2 — 复活 5 个 CI 死 spec**：fixture/事件切 V2，断言骨架保留。守门：5 spec 全绿。
- **Wave 3 — 独失覆盖重建**：transport-contract / streaming-projection / history-pagination 三个新 spec。守门：新增覆盖绿 + 全量 e2e 绿。

事件注入机制二选一（均幸存，按需选用）：mock-server `events` 一次性队列（`/global/event` 静态 SSE，简单 spec）；`installSseTransport`（fetch 劫持、可编程流：send/burst/split/heartbeat/close/error + 连接与 ack 台账，传输契约与流式 spec）。

## 3. Wave 1：V2 mock 基建

### 3.1 路由面（mock-server.ts 重写）

新增（信封形状以 SDK gen 类型为准，`packages/sdk/js/src/v2/gen/types.gen.ts`）：

- `GET /api/session/{id}/message`：query `limit`/`order`/`cursor`；mock 内部存升序数组，`order=desc` 反转后切片；响应 `{data, cursor: {next?}}`——**必须带 `cursor` 对象**，否则 app 在 `response.data?.cursor.next` 抛 TypeError。cursor 沿用现存不透明 token 模式（`cursor_N` Map 换回 messageID，无效游标 400）。
- `GET /api/session/{id}/message/{mid}`：命中 `{data: SessionMessage}`；未命中 404（`MessageNotFoundError` 形状）——app 对父消息补拉走此路由，404 记 tombstone 是正常路径。
- `GET /api/session/{id}`：`{data: SessionV2Info}`（复用现存 `v2Session()` 投影）。
- `GET /api/session/{id}/diff` → `{data: []}`；`GET /api/session/{id}/todo` → `{data: []}`（可配置）。
- `GET /api/permission/request` → `{location, data: PermissionV2Request[]}`；`GET /api/question/request` → `{location, data: QuestionV2Request[]}`（可配置）。
- `POST /api/session/{id}/question/{requestID}/reply`、`POST /api/session/{id}/permission/{requestID}/reply`：捕获请求体供 spec 断言（request-docks test1/2 的回复断言切 V2 路由后依赖），返回 200 空体。

**V2 读路由审计（404 容忍，无需 mock）**：以下路由 app 实际请求但全部走 `x.data?.data ?? []/?? {}` 优雅降级，404 与现状 `{}` 渲染结果一致——`/api/agent`（bootstrap.ts:190）、`/api/session/active`（:250）、`/api/command`（:299）、`/api/reference`（mock 已有活路由，保留）。`client.v2.project.list` 目前只是 TODO 注释（home-session-index.ts:152），home 实际走 `sdk.project.list()`（V1 `/project` 路由，保留）。mutation 面政策：session.update/delete/prompt/interrupt/revert/compact/wait 等走乐观更新不理会响应体，404 容忍不兜；仅 reply POST 需兜住（见上）。

删除（逐一核对确证死）：`/session` V1 系列（`/session/:id/message[/{mid}]`、单条 `/session/:id` 及其 todo/children/diff 子路由、`/session` 旧列表、`/session/status`）、`/permission`、`/question`、`/agent`（G6 已删对应 SDK 组，app 走 `/api/agent`）。

**保留（活路由，误删即把活 spec 变死）**：`/provider`、`/path`、`/project/current`、`/config` 是 bootstrap 的 `x.data!` 非空断言消费（bootstrap.ts:184/196/281/246），404 会炸 bootstrap；`/vcs`（static + `/vcs/diff`）、`/file`、`/file/content`、`/find/file` 是活 spec 的 config 依赖（review-line-comment/review-image-flash/review-open-file/file-browser 等；bootstrap.ts:290 的 `sdk.vcs.get()` 走 `?? store.vcs` 降级，404 本身安全但 static 路由本就该留）；staticRoutes/emptyObject/emptyList 兜底不动。

**catch-all 改显式 404**（消灭 `{}` 静默吞错）。安全性论证：hey-api 在 404 时不填 `response.data`，`response.data?.cursor.next` 整体短路为 undefined → `cursor=undefined`、`complete=true`、消息空——与现状（TypeError 被吞）渲染结果一致，且 9 个活 spec 的 `?? []` 降级路径对 404 同样成立。`x.data!` 非空断言消费者清单（provider.list/path.get/config.get/project.current/vcs.get）对应路由全部保留 mock，不在 404 影响面内。Wave 1 守门复跑全量 e2e 验证此论证。

### 3.2 config 字段更替

死字段（挂 V1 死路由）：`pageMessages`/`message`/`onMessages`/`onMessage`（单条消息回调，挂 `/session/:id/message/:mid`）/`messageDelay`/`beforeMessagesResponse`/`onArchive`/`todos`（挂 `/session/:id/todo`）/`sessionStatus`（`/session/status` 已死，bootstrap.ts:247 注释确认 V2 无此端点；review-terminal-stacked 的该 config 是死参数）。`onMessage` 无 V2 替代（V2 单条路由只服务父消息补拉的 404/tombstone 语义，无需回调）；`todos` 由 `v2Todos` 接班。
新字段：`v2Messages: SessionMessage[]`（升序）、`onV2Messages(phase: "start"|"end")`、`beforeV2MessagesResponse`（挂起钩子）、`v2Todos`/`v2Permissions`/`v2Questions`/`v2Diff`。
9 个活 spec 的死参数（pageMessages、sessionStatus 等）顺手移除。

### 3.3 v2-fixture 工厂与校验防线（新建 `e2e/utils/v2-fixture.ts`）

工厂（输出 SDK gen 的 `SessionMessage` 联合成员，静态类型约束）：

- `v2UserMessage({id, text, files?, agents?})`——`{type:"user", id, time:{created}, text, ...}`。
- `v2AssistantMessage({id, agent, model, content, ...})`——`content` 项三种：`v2TextContent`、`v2ReasoningContent`、`v2ToolContent`。
- `v2ToolContent` 四态（对齐 adapter 映射，`v2-adapter.ts:170-218`）：
  - pending：`input` 是 **JSON string**（adapter `JSON.parse`，失败降级空对象 + raw）。
  - running/completed：`structured` 整体透传为视图模型 `metadata`、`structured.title` 提为 title；completed 的 `content: LlmToolContent[]` 经 `serializeToolContent` 拍平为 output。
  - error：`error.message` → 视图模型 `error` 字符串。
  - session-ui 消费面（已核实）：子会话链接 `structured.sessionId`（tool 名 `"task"`，`message-part.tsx:1570-1579`）、websearch 标签 `structured.provider`（`:1972`）、question 答案 `structured.answers`、edit/write `structured.filediff`、apply_patch `structured.files`、评论条 text part `metadata.opennovelComment`。
- `v2Compaction({id, reason, summary, recent})`。
- `v2History(count)`：N 对 user+assistant 历史 turn。
- 事件工厂：`v2Event(type, properties)` 产出 SSE 帧信封 `{directory, payload: {id, type, properties}}`；`v2StreamTurn(...)` 产出最小 6 帧事件序列（见 §6）。

运行时校验（接班被删 fixture 的防线）：消息经 `@opennovel-ai/schema/session-message` 的 union schema、事件 properties 经 `@opennovel-ai/schema/session-event` 对应事件 schema 解码（`errors: "all"` + 严格 excess property，对齐被删 fixture.ts:73-85 的严格度）。fixture 自检沿用被删 `validateTimelineMessages` 思路改 V2 结构：重复消息/part ID、assistant 前必须有 user/compaction（parentID 链）、tool content 归属。

自检单测：`e2e/utils/v2-fixture.spec.ts`，用 `@playwright/test` 写纯 node 断言（不用 page fixture）——合法构造通过/畸形抛错/自检拒绝重复 ID。Playwright 默认 testMatch 会收集 `e2e/**/*.spec.ts` 并进 CI（比被删 fixture.test.ts 的本地 bun test 更强）；**不能写成 `.test.ts`**——根 playwright.config 无 testMatch 覆盖，默认 pattern 同样匹配 `**/*.test.ts`，bun:test 导入在 Playwright 下即炸。

## 4. Wave 2：复活 5 个 CI 死 spec

逐一改造（断言骨架保留，模板取 git 历史/转储）：

1. **smoke/session-timeline**（spec 540 行 + fixture 315 行）：fixture 72 turn/331 part 混合工具族字面量改 V2 `SessionMessage` 形状（经 v2-fixture 工厂 + 校验）；`pageMessages`→`v2Messages`、`onMessages`→`onV2Messages`；分页断言从 `x-next-cursor`/`before` 改 cursor 参数形状。
2. **session-timeline-collapse-state**（443 行）：播种切 `v2Messages`；事件从 `message.part.updated` 改 V2 词汇（`session.next.tool.progress`/`tool.success`/`text.delta` 信封）。 sticky header、shadowRoot 计数、rowKey 等断言不动。
3. **session-timeline-context-resize**（378 行）：播种切 `v2Messages`；context 组 part（read/glob/grep/list）经 v2ToolContent 构造。
4. **subagent-child-navigation**：父会话 task part 用 `v2ToolContent`（completed，`structured: {sessionId: <childID>}`，tool 名 `"task"`）；删除自注册的 V1 `/session/:id` 路由，改靠 `/api/session` 列表（`v2Session` 投影已带 parentID）。
5. **session-request-docks**：test1/2 播种改 `/api/question/request`、`/api/permission/request`（`{location, data}` 信封）；回复断言同步切 V2——test1 的 `POST /question/question-request/reply` body `{answers}` 改 `POST /api/session/{id}/question/{requestID}/reply`，test2 的 `POST /session/{id}/permissions/{rid}` body `{response:"once"}` 改 `POST /api/session/{id}/permission/{requestID}/reply`（body 形状以 SDK gen 为准，mock 兜住这两个 POST 并捕获请求体）；test3 的 SSE `question.asked`/`question.rejected` 改 `question.v2.asked`/`question.v2.rejected`（对齐生产 wire 词汇；apply 兼容 V1 词汇但 server 不再发送）。

## 5. Wave 3：独失覆盖重建（去重后）

### 5.1 `e2e/regression/session-transport-contract.spec.ts`（新，7 用例）

复刻被删 transport.spec 骨架（git 历史模板），事件 payload 换 V2 最小事件集（text.delta 链天然适合 split/burst 的渲染完整性断言）：单连接复用与 ack 台账、burst 单 chunk 多事件、按字节切点 split（多字节码点 ☃ 从字节中间切开）、heartbeat 免扰、clean close 重连（`endedBy === "close"`）、stream error 重连、Last-Event-ID 头、非事件 fetch 穿透。基建 `installSseTransport` 不动。

### 5.2 `e2e/regression/session-streaming-projection.spec.ts`（新）

合并被删 projection/tool-projection/reasoning-projection/tool-state/context-state 的独失核心（去重幸存等价物）：

- 最小 6 帧流式回合：text delta 逐帧上屏（app 侧相邻 delta 合并已在 server-sdk 单测覆盖，这里断言端到端渲染结果）。
- reasoning 矩阵：`reasoning.started/delta/ended` × `showReasoningSummaries` 开关 × 空/空白/带标题；Thinking→reasoning→text 接力无空窗。
- 工具四态迁移：`tool.called → tool.progress → tool.success/failed`；9 族工具 error 卡片（bash/edit/write/apply_patch/webfetch/websearch/task/skill/自定义 MCP）；question 的 dismissed 与普通 error 区分；websearch `structured.provider` 三态标签。
- 重复投递幂等（同一 `tool.success` 重发不重置手动展开态）与增量更新（websearch 链接 1→2、question 答案更新）。
- context 组归并：read/glob/grep/list 相邻成组、被 text 分隔的边界、组首成员删除保 `data-timeline-key`、Exploring→Explored 标题迁移。
- turn 结构：TurnDivider 行序、compaction 行（`compaction.ended` 事件）、中断独立成行。
- 不重复：折叠态保留（collapse-state）、组视觉过渡（context-resize）、工具族静态准入（smoke）。

### 5.3 `e2e/regression/session-history-pagination.spec.ts`（新）

V2 分页协议断言（被删 history-root 的 V2 化）：

- 两阶段请求序列：首页 `limit=20&order=desc` 无 cursor；滚顶触发历史页 `limit=200&order=desc&cursor=<token>`（具体 limit 以实现时 server-session.ts 实际调用为准）。
- cursor 参数形状：不透明 token、服务端换回 messageID、无效游标 400。
- 父消息补拉：assistant 的 parentID 不在已载页时 `GET /api/session/{id}/message/{mid}` 恰好一次；404 记 tombstone 不重复拉。
- 历史页挂起期间（`beforeV2MessagesResponse` 钩子）SSE 事件到达：可见锚点零位移（断言方案参照 smoke 的锚定断言，不引入视觉探针）。

## 6. 最小事件集与 wire 形状参照（侦察结论冻结）

SSE 帧信封：`{"directory": <app 目录>, "payload": {"id": "evt_...", "type": "<事件字面量>", "properties": {...}}}`；directory 必须匹配 app 当前目录（缺省按 "global" 处理）；`type === "sync"` 的帧被 app 丢弃。

user→assistant 流式回合最小 6 帧：

1. `session.next.prompted` `{timestamp, sessionID, messageID, prompt: {text}, delivery: "steer"}`
2. `session.next.step.started` `{timestamp, sessionID, assistantMessageID, agent, model: {id, providerID}}`
3. `session.next.text.started` `{timestamp, sessionID, assistantMessageID, textID}`
4. `session.next.text.delta` `{timestamp, sessionID, assistantMessageID, textID, delta}` ×N
5. `session.next.text.ended` `{timestamp, sessionID, assistantMessageID, textID, text}`
6. `session.next.step.ended` `{timestamp, sessionID, assistantMessageID, finish, cost, tokens}`——**触发 `GET /api/session/{id}/diff`，mock 必须兜住**

工具回合：`tool.called`（input 起始，Record 形状，区别于消息投影 pending 态的 JSON string）→ `tool.progress`（完整快照，app 按 callID 只留最新）→ `tool.success`/`tool.failed`（结算，亦触发 fetchDiff；`failed.error` 必填）。`Tool.Called/Success` 的 `provider: {executed, metadata?}` 等字段全集以 `@opennovel-ai/schema/session-event` 的 `SessionEvent.Tool.*` schema 为准，校验防线（§3.3）强制齐全。question/permission：`question.v2.asked/replied/rejected`、`permission.v2.asked/replied`。reasoning：`reasoning.started/delta/ended`（delta 事件的 id 字段是 `reasoningID`）。compaction：`compaction.ended`。

会话水合靠 `/api/session` 列表（无需 `session.next.created`；测新建会话流时另发，properties 必填 `timestamp/sessionID/projectID/directory/title/version`）。

adapter 硬约束（fixture 必须满足，缺字段直接抛 TypeError）：assistant 必填 `id/time.created/agent/model{id,providerID}/content`；`SessionV2Info` 必填 `location.directory`；`system/synthetic/shell/agent-switched/model-switched` 消息类型被 adapter 丢弃（首版不渲染，fixture 不用构造）。

## 7. 验证与守门

- 每波完成：`packages/app` 下 `bun typecheck` + 根 oxlint 0 errors；对应范围 e2e 复跑绿。
- Wave 1 守门：全量 e2e（`bun run test:e2e:local`，packages/app 下）——9 个活 spec 不回归（catch-all 404 化论证的实证）。
- Wave 2 守门：5 个复活 spec 全绿。
- Wave 3 守门：3 个新 spec 绿 + 全量 e2e 绿。
- 收尾：tasks.md 勾选与 Implementation Commits、`openspec validate e2e-v2-mock --strict`、归档。

## 8. 偏差记录（执行中补）

（执行过程中与设计冲突的现实，逐条记录于此。）
