# Proposal: e2e-v2-mock

> v1-removal 跟进项（其 design §11 偏差 11）：app e2e 的消息面 mock 仍停留在 V1 wire，主时间线覆盖在 CI 上已死。本提案把 mock 基建切到 V2 wire，复活在 CI 的死 spec，并按去重后的清单重建独失覆盖。

## Why

v1-removal 归档后（本地 main，未推送），`packages/app/e2e/utils/mock-server.ts` 只认 V1 路由（`/session/:id/message` 裸数组 + `x-next-cursor` 头），而 app 自 runtime-v2-cutover 起全部走 V2 `GET /api/session/{id}/message`。两份侦察（被删资产盘点 + V2 wire/幸存套件状态）确认后果：

- **5 个在 CI 的 spec 必死（推送即红）**：`smoke/session-timeline`、`session-timeline-collapse-state`、`session-timeline-context-resize`、`subagent-child-navigation`、`session-request-docks`（test1/2）。消息请求落 catch-all 返回 `{}`，`response.data?.cursor.next` 抛 TypeError 被调用方吞掉，时间线静默为空。
- **catch-all `{}` 静默吞错**：未命中路由返回空对象而非 404，把接口缺失伪装成「空数据」，排障无信号。
- **独失覆盖**（被删 14 个 regression spec + timeline-stability 16 文件盘点）：SSE 传输契约、历史分页协议断言、reasoning 投影矩阵、工具错误/标签矩阵、turn 结构投影、context 组归并规则等 CI 级回归价值最高的部分全部缺席。
- 9 个幸存「活」spec 靠 TypeError 被吞后的优雅降级存活，其 `pageMessages` 等配置已是死参数，持续误导后来者。

## What Changes

- **mock 基建 V2 化**：mock-server.ts 新增 V2 路由面（`/api/session/{id}/message[/{mid}]` desc/cursor 分页信封、`/api/session/{id}`、`/api/session/{id}/diff`、`/api/session/{id}/todo`、`/api/permission/request`、`/api/question/request`），删除 V1 死路由与死 config 字段；catch-all 从 `{}` 改显式 404。
- **V2 fixture 构造器 + 校验防线**：新建 e2e V2 fixture 工厂（user/assistant/compaction/tool 四态），运行时校验接班被删 fixture 的 Effect Schema 防线——数据源换 `@opennovel-ai/schema/session-message` 与 `@opennovel-ai/schema/session-event`。
- **复活 5 个 CI 死 spec**：fixture 与 SSE 事件全部切 V2 词汇（最小事件集：`prompted → step.started → text.* → step.ended`）。
- **重建独失核心覆盖（去重幸存等价物后）**：SSE 传输契约 7 用例、流式投影核心（reasoning 矩阵 / 工具错误卡与 provider 标签 / context 组归并 / turn 结构 / 重复投递幂等）、历史分页协议断言。
- **顺手清理**：9 个活 spec 的 `pageMessages`、`sessionStatus` 等死参数移除。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runtime-v2`：e2e mock 与覆盖恢复到 V2 wire（skip_specs 阶段不产出 delta）

> `skip_specs: true`。

## Impact

- **受影响包**：仅 `app`（e2e 测试面；生产代码不改）。
- **CI**：本提案落地前 main 不可推送——推送即 e2e 红。落地后 e2e job（linux + windows matrix）恢复绿。
- **依赖关系**：前置 v1-removal（已归档）；被删资产模板在 git 历史（`git show cdf9c4f0d2^:<path>`）与 `.agent_tmp/deleted-e2e/` 转储。
- **风险**：9 个活 spec 对 catch-all 404 化的行为回归——Wave 1 完成后全量 e2e 复跑守门；V2 tool `structured` 透传面已核实（adapter 把 `structured` 整体透传为视图模型 `metadata`，session-ui 的 `metadata.sessionId`/`metadata.provider` 消费面不变）。

## 非目标

- 不重建 timeline-stability 视觉稳定性套件（11 spec + fixture.ts + 像素级绘制预言机）——后续独立提案（不进 CI，基建与断言体系独立）。
- 不做 performance/benchmark（含 timeline 助手）的 V2 化——后续独立提案。
- 不重建 locale-projection 与 accessibility 小面——后续并入其他提案。
- 不改 app 生产代码（若重建过程中发现 adapter/渲染真 bug，另立提案修复）。
- 不注入仅存在于翻译器内部的 V1 伪事件词汇（`message.part.updated` 等）——SSE 注入对齐生产 server 真实发送的 wire 词汇（`session.next.*`/`permission.v2.*`/`question.v2.*` 等）。
