# Design: perf-benchmark-v2

> 测试面迁移提案：把 `packages/app/e2e/performance/` 的 benchmark 套件从已删除的 V1 mock 形态迁到 V2 wire。生产代码零改动。依据：e2e-v2-mock 归档提案（V2 mock 能力面）、逐文件侦察报告（V1 残留清单）、`utils/v2-fixture.ts` 工厂与 `utils/mock-server.ts` 现形态。

## 迁移映射总表

| V1 形态（已删） | V2 对应（现成） | 语义差异 |
| --- | --- | --- |
| `pageMessages(sessionID, limit, before)` 返回 `{items, cursor: 消息ID}` | `v2Messages(sessionID)` 返回升序全量数组 | 分页责任上移到 mock 服务端（不透明 cursor token + `{data, cursor:{next}}` 信封，mock-server.ts:165-184）；fixture 不再手写切片 |
| `onMessages({sessionID, before, phase})` | `onV2Messages({sessionID, cursor, limit, phase})` | `before`（消息 ID）改 `cursor`（上一页末条 ID，由 mock 从 token 解出）；phase 语义不变 |
| `beforeMessagesResponse` | `beforeV2MessagesResponse` | 一一对应（gated response） |
| `messageDelay: number` | 无内建键 | 延迟语义由调用方在 `beforeV2MessagesResponse` 内 `await sleep(ms)` 自行实现（D3） |
| `message(sessionID, messageID)` + `onMessage` | 单条 GET 从 `v2Messages` 数组内 find（mock-server.ts:158-163） | 无独立 config 键；父消息须包含在目标会话的 `v2Messages` 列表中（D4） |
| 消息模型 `{info, parts}` | 单体 `SessionMessage`（user 文本直挂 `message.text`；assistant parts 更名 `content`） | 全部 `.info.id` 访问改 `.id`；构造走 v2-fixture 工厂（D1） |
| SSE `message.part.updated` / `message.part.delta` | `session.next.text.started` / `session.next.text.delta` / `session.next.text.ended`（配 `step.started`/`step.ended`） | 词汇对齐生产 server 真实 wire；经 `v2Event` 工厂严格校验（D2） |
| user `info.summary.diffs`（turn 级 diff） | 无对应字段 | V2 adapter（utils/v2-adapter.ts adaptUser）不合成 `summary.diffs`；会话级 diff 走 `GET /api/session/{id}/diff`（mock 键 `v2Diff`）（D5） |

## 决策

### D1：消息构造走 v2-fixture 工厂，保留确定性 ID

`session-timeline-benchmark.fixture.ts` 的 `performanceTurn(index)` 与 `session-timeline-stress.fixture.ts` 的 `userMessage/assistantMessage` 改用 `v2UserMessage`/`v2AssistantMessage`/`v2Text`/`v2Reasoning`/`v2Tool` 工厂：

- 工厂的 `id?`/`created?` 入参保留套件既有的确定性 ID 方案（`msg_0000_NNNN_*`、`prt_*`），spec 的 `data-timeline-part-id` 定位与 `waitForStableTimeline(lastMessageID)` 不断。
- 内容形态（reasoning 每 5 回合、edit 每 8、write 每 12、patch 每 16；lorem 文本与 markdown 生成器）原样保留——benchmark 的数据规模与构成是测量对象，不能随迁移改变。
- tool 态用 `v2ToolCompleted({input, structured, content})`：V1 `state.metadata.filediff/files` 在 V2 并入 `structured`（adapter 整体透传为视图模型 metadata，见 v2-fixture.ts 头注）。
- 每个 fixture 文件开场调 `resetV2FixtureCounters()`，收尾对全量消息跑 `validateV2Timeline`（防重复 ID / 孤儿 assistant）。

### D2：SSE 注入换 `v2Event` + `session.next.*` 最小事件集

`buildInitialStreamEvent`/`buildStreamDeltaEvents` 重写：向既有 assistant 消息追加流式文本部分，帧序为 `step.started → text.started → text.delta×N → text.ended → step.ended`（assistantMessageID/textID 复用 fixture 常量）。不直接套 `v2StreamTurn`——它会额外发 `prompted` 新开一轮，与「向在制回合追加流」的 benchmark 语义不符；只复用其词汇与 `v2Event` 校验防线。`step.ended` 会触发 app 拉 `/api/session/{id}/diff`，`v2Diff` 缺省 `[]` 已兜住。

### D3：messageDelay 语义内联到 beforeV2MessagesResponse

V1 的 `messageDelay: 50`（parent-hydration 模拟慢列表）与 `messageDelay: 25`（mock-server.test.ts）改为：

```ts
beforeV2MessagesResponse: async (input) => { ...; await new Promise((resolve) => setTimeout(resolve, 50)) }
```

不为此给 mock-server 加回内建延迟键——单点使用，内联即可（AGENTS.md：不预提取单次 helper）。

### D4：parent-hydration 的单条 GET 用 v2Messages 容纳 + page.route 观察层计数

- `message(sessionID, messageID) => user` 死键删除；父 user 消息并入目标会话 `v2Messages` 列表**最旧位置**。candidate 模式下深分页被 `beforeV2MessagesResponse` 闸门挡住（仅放行首页），父消息不会经列表页加载，app 仍走单条 GET 水合——`parent` 请求计数语义保留。
- `onMessage` 死键无 V2 对应（mock 不单设单条 GET 回调）：在 spec 内注册 `page.route("**/api/session/*/message/*")` 观察层，计数后 `route.fallback()` 交回 mock 处理器。不扩 mock-server config（保持基建不膨胀）。
- 裸 `page.route("**/session/{targetID}")` fulfill 的 session 对象补 `{data: ...}` 信封（V2 app 消费 `response.data`）。

### D5：turnDiffs 场景改由 v2Diff 供给，语义重述为会话级 diff 数据成本

V2 下 turn 级 `summary.diffs` 在 adapter 层已不合成（session.tsx:596 的 `turnDiffs` 恒空）；会话级 diff 的真实数据通路是 `GET /api/session/{id}/diff` → `session_diff` store → 检视面。因此：

- `setupTimelineBenchmark` 的 `turnDiffs` 选项删除，调用侧 `reviewDiffs: true` 改传 `v2Diff: diffs`。
- spec 注释同步重述：该场景测量的是「会话级 diff 数据挂载下的时间线流式渲染成本」。场景完成性断言与指标采集口径不变（performance/AGENTS.md：只断言场景完成与指标采集，不设机器相关阈值）。
- `vcsDiff`（git 模式 `/vcs/diff`）路径不受影响，原样保留。

### D6：unit/mock-server.test.ts 重写为 V2 门闩语义

- 假路由 URL 换 `http://127.0.0.1:4096/api/session/session/message`。
- 配置换 `v2Messages`（推 `"page"` 事件并返空数组）+ `onV2Messages`（推 phase）+ `beforeV2MessagesResponse`（推 `"before"`、等门闩、再睡 25ms 保留延迟断言）。
- 事件序列断言从 `["start","before","page","end","fulfill"]` 保持同形（V2 mock 调用序：onV2Messages(start) → beforeV2MessagesResponse → v2Messages → onV2Messages(end) → fulfill，mock-server.ts:172-185）。

### D7：stress fixture 的手写分页整体删除

`session-timeline-stress.fixture.ts` 的 `pageMessages` 函数与导出删除；`fixture.messages` 改存单体 `SessionMessage[]` 升序全量，`timeline-test-helpers.ts` 的 `mockStressTimeline` 改传 `v2Messages: (sessionID) => fixture.messages[sessionID] ?? []`、`onV2Messages: input?.onMessages`（入参类型同步改 `cursor`）。三个消费 spec（first-navigation / home-tab-navigation / session-tab-flash）的 `.info.id` 访问改 `.id`。

## 不做

- 不动 probe/metrics/harness（纯 DOM 探针，零 API 依赖，侦察已核实）。
- 不改 benchmark 采样指标、阈值与环境变量开关（`TIMELINE_*`/`REVIEW_PANE_*`）。
- 不恢复 messageDelay 内建键、不为单条 GET 加 mock 回调键。
- 不把套件接入 CI；不重建 timeline-stability 套件。

## 验证策略

1. `cd packages/app && bun typecheck`——excess property 红点清零。
2. `cd packages/app && bun test ./e2e/performance/unit`——mock-server.test.ts 转绿。
3. `cd packages/app && bunx playwright test --config e2e/performance/playwright.config.ts`——6 个 spec 全部跑通（场景完成 + 指标采集；耗时长，逐一跑）。
4. 全量 e2e 守门：`bun run test:e2e`（确认 mock 迁移未误伤 regression/smoke 活 spec——本提案不改 mock-server.ts，预期零波及，但仍跑一遍）。
5. 仓库根 `bunx oxlint` 0 errors。
