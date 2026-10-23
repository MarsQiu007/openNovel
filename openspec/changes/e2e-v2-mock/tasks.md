# Tasks: e2e-v2-mock

> 三波串行（Wave 2/3 依赖 Wave 1 基建）。每波完成立即勾选并过守门。被删资产模板：`git show cdf9c4f0d2^:<path>` 或 `.agent_tmp/deleted-e2e/`。

## Wave 1 — mock 基建 V2 化

- [x] 1.1 新建 `e2e/utils/v2-fixture.ts`：V2 消息工厂（user/assistant/compaction/text/reasoning/tool 四态/history）+ 事件工厂（信封 + 最小 6 帧序列）+ fixture 自检（重复 ID、parentID 链、tool 归属）
- [x] 1.2 接入运行时校验：消息经 `@opennovel-ai/schema/session-message`、事件 properties 经 `@opennovel-ai/schema/session-event` 解码（`errors: "all"` + 严格 excess property）
- [x] 1.3 新建 `e2e/utils/v2-fixture.spec.ts` 自检单测（`@playwright/test` 纯 node 断言：合法构造通过/畸形抛错/自检拒绝）——**不得用 `.test.ts` 扩展名**（Playwright 默认 testMatch 会收集并炸 bun:test 导入）（7/7 绿）
- [x] 1.4 重写 mock-server.ts 路由面：新增 `/api/session/{id}/message[/{mid}]`（desc/cursor 信封，cursor 对象必带）、`/api/session/{id}`（GET + PATCH，PATCH 触发 onV2SessionUpdate）、`/api/session/{id}/diff`、`/api/session/{id}/todo`、`/api/permission/request`、`/api/question/request`、`POST /api/session/{id}/question|permission/{requestID}/reply`（捕获请求体）
- [x] 1.5 删除 mock-server.ts 确证死的路由（`/session` V1 系列含 `/session/status`、`/permission`、`/question`、`/agent`）与死 config 字段（pageMessages/message/onMessages/onMessage/messageDelay/beforeMessagesResponse/onArchive/todos/sessionStatus），新增 v2Messages/onV2Messages/beforeV2MessagesResponse/v2Todos/v2Permissions/v2Questions/v2Diff/onV2SessionUpdate；**保留** `/provider`、`/path`、`/project/current`、`/config`、`/vcs*`、`/file*`、`/find/file` 等活消费路由
- [x] 1.6 catch-all 从 `{}` 改显式 404
- [x] 1.7 移除活 spec 的死参数（pageMessages ×18、onArchive→onV2SessionUpdate；sessionStatus 已无引用）；全请求面审计通过（25 个 V2 调用面：messages/message/get/diff/todo/list/update/reply 有 mock，其余 404 容忍；`x.data!` 消费面路由全保留）
- [x] 1.8 **守门**：`packages/app` 下 `bun typecheck` + 根 oxlint 0 errors + 全量 e2e 复跑——9 个活 spec 不回归（验证 404 化论证）。首跑 16 败归因 13 真回归（404 console 噪音/bootstrap 固定读面/懒创建 POST，见 design §8.1）修复后全量 69 过 18 败：15 败恰为 Wave 2 排期的 5 个死 spec，3 败与 HEAD 基线一致（annotation-execute、novel.spec chat panel、remote-session-settings）

## Wave 2 — 复活 6 个 CI 死 spec

- [x] 2.1 改造 smoke/session-timeline（fixture 315 行 V1 字面量 → v2-fixture 工厂；分页断言改 cursor 协议）。消息 id 设计为字典序==时序（`_a`/`_b` 后缀）对齐 store 排序；用户 summary.diffs 无 V2 对应面整体丢弃；session-list-path-loading 同步摘除 pageMessages 引用；smoke 纳入 e2e tsconfig include（11/11 绿）
- [x] 2.2 改造 session-timeline-collapse-state（播种切 v2Messages；事件切 `session.next.*` 词汇：文本流入 = text.started/ended，completed 工具结构化更新 = tool.called→tool.success 重放对，part id==callID 原位更新）（3/3 绿）
- [x] 2.3 改造 session-timeline-context-resize（播种切 v2Messages；context 组 part 经 v2Tool/v2ToolRunning/v2ToolCompleted；running→completed 结算走 tool.called→tool.success 重放对）（2/2 绿）
- [x] 2.4 改造 subagent-child-navigation（task part 用 `structured.sessionId`；删自注册 V1 路由，改靠 `/api/session` 列表 parentID——mock-server 新增 sessionList 列表覆盖，单条 GET/PATCH 仍解析 sessions）（5/5 绿）
- [x] 2.5 改造 session-request-docks（test1/2 播种切 `/api/question|permission/request` 信封——permission 字面量转 V2 Request 形状 action/resources/save；回复断言改 mock onV2Reply 捕获，question 体 `{answers}` 不变、permission 体 `{response}`→`{reply}`；test3 SSE 切 `question.v2.asked/rejected` 词汇）（3/3 绿）
- [x] 2.6 改造 novel/session-switcher-actions（onArchive 死参数改 onV2SessionUpdate、pageMessages 死参数移除——Wave 1 已完成转换；复跑验证 archive 用例经 `PATCH /api/session/{id}` 链路转绿）（3/3 绿）
- [x] 2.7 **守门**：6 个复活 spec 全绿（19/19）+ `bun typecheck` 绿 + oxlint 0 errors

## Wave 3 — 独失覆盖重建（去重后）

- [x] 3.1 新建 `e2e/regression/session-transport-contract.spec.ts`（8 用例：连接复用/burst/split 多字节/heartbeat/close 重连/error 重连/Last-Event-ID/fetch 穿透；payload 用 V2 text.delta 链）（8/8 绿）
- [x] 3.2 新建 `e2e/regression/session-streaming-projection.spec.ts`（流式回合/reasoning 7 Profile 矩阵/工具四态与 9 族错误卡/question dismissed 区分/websearch provider 标签/重复投递幂等/context 组归并与折叠保持/turn 结构；busy 走 /api/session/active 对账，mock 新增 v2Active）（15/15 绿）
- [x] 3.3 新建 `e2e/regression/session-history-pagination.spec.ts`（两阶段请求序列 limit 20→200/cursor 形状/父消息补拉经 prepend 重锚恰一次（单条 GET 零调用）/挂起期间 SSE 锚点零位移；onV2Messages 捕获新增 limit）（2/2 绿）
- [x] 3.4 **守门**：3 个新 spec 绿（transport 8/8、streaming 15/15、pagination 2/2）+ 全量 e2e 109 过 3 败（3 败恰为 1.8 已立案的 HEAD 基线失败：annotation-execute、novel.spec chat panel、remote-session-settings，本波 diff 不触及其运行时）+ `bun typecheck` 绿 + oxlint 0 errors

## 收尾

- [x] 4.1 更新 tasks.md 勾选与 Implementation Commits（`git log --grep "OpenSpec-Change: e2e-v2-mock"`）
- [ ] 4.2 `openspec validate e2e-v2-mock --strict` 绿
- [ ] 4.3 归档（`npx openspec archive e2e-v2-mock --yes`，确认无残留）并 ff 合入 main（不推送，推送时机由用户定）

## Implementation Commits

- `90c7f2ea10` test(app): 重建 e2e mock 基建为 V2 wire（Wave 1）
- `081927c2ea` test(app): smoke 时间线 spec 切 V2 fixture 与 cursor 分页（Wave 2.1）
- `007dba265d` test(app): collapse-state spec 切 V2 播种与事件（Wave 2.2）
- `5360ea345a` test(app): context-resize spec 切 V2 播种与工具结算事件（Wave 2.3）
- `52d45d1005` test(app): subagent-child-navigation spec 切 V2 播种与 sessionList（Wave 2.4）
- `dc70a3d989` test(app): request-docks spec 切 V2 请求信封与回复捕获（Wave 2.5）
- `399449e841` test(app): 新建 session-transport-contract spec（Wave 3.1）
- `94ef4324a2` test(app): 新建 session-streaming-projection spec（Wave 3.2）
- `a215a3f667` test(app): 新建 session-history-pagination spec（Wave 3.3）

（Wave 2.6 转换已含在 Wave 1 基建提交内，无独立实现提交；两次勾选记录提交不计入。）
