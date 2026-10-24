# Design: timeline-stability-v2

## Context

动机与影响面见 proposal.md。本设计解决一个核心问题：被删套件（git `cdf9c4f0d2^`）的 fixture 深绑 V1 wire，而 V2 的事件词汇、状态来源、消息形状完全不同。下文的事实清单均经 file:line 核实（2026-10-24，main@cdacaef97f），是全部映射决策的依据。

### V1 → V2 语义映射事实清单

驱动层（fixture 产出）→ 投影层（app 消费）的逐条对应：

| V1 场景语义 | V1 驱动 | V2 诚实通路 | 依据 |
|---|---|---|---|
| user 消息上屏 | `message.updated`(user info) + `part.updated` | `session.next.prompted`（翻译器产同形伪事件） | v2-translator.ts:82-106 |
| assistant 骨架/定稿 | `message.updated`(assistant info) | `session.next.step.started`（骨架）/ `step.ended`（completed+cost+tokens+finish） | v2-translator.ts:107-127, 311-324 |
| assistant 出错 | `message.updated`(error info) | `session.next.step.failed`（投影为 UnknownError info） | v2-translator.ts:325-336 |
| text 流式 | `part.updated` + `part.delta` | `text.started` / `text.delta` / `text.ended` | v2-translator.ts:128-163 |
| reasoning 流式 | 同上（reasoning part） | `reasoning.started/delta/ended`（started 可携带 providerMetadata） | v2-translator.ts:164-206 |
| 工具四态 | `part.updated`(tool part 各 state) | `tool.called`(→running) / `tool.progress`(running+metadata) / `tool.success`(completed+output) / `tool.failed`(error) | v2-translator.ts:207-310 |
| shell 输出增长 | `part.updated`(bash metadata.output 增量) | `tool.progress` 的 `structured` → part.metadata（shell-matrix 的 50 行增量场景通路） | v2-translator.ts:233-258 |
| edit/apply_patch metadata | tool part metadata.filediff/files | `tool.progress`/`tool.success` 的 `structured`（同上通路，file-matrix/file-mutation） | 同上 |
| busy/idle 翻转 | `session.status`(busy/idle) | mock `v2Active` 函数翻转 + 任一 `session.next.*` 事件经 server-sync 400ms debounce 触发 `refreshActive()` 对账 | server-session.ts:1386-1408；server-sync.tsx:381-400 |
| retry 演进 | `session.status`(retry, attempt n, message, next) | `session.next.retried`（attempt/error.message；next 以事件时间戳占位）→ `step.started` 清 retry 回 busy | server-session.ts:866-882, 906-911 |
| 中间 part 插入 | `part.updated`(新 part id) | 可变 `v2Messages` 函数 + `session.next.revert.committed` 强制重拉 → `replaceParts` reconcile 插入 | server-session.ts:901-905, 575-627 |
| 中间 part 删除 | `part.removed` | 同上（reconcile 丢弃消失 part；`preserveUnfetched` 只对未拉取的更旧页保留） | server-session.ts:563-627, 745-746 |
| message 删除 | `message.removed` | 同上（`replaceMessages` 丢弃 fetched 页之外的消息；页 complete 时全量对账） | server-session.ts:563-573 |
| question 状态机 | question part 隐藏态 | `question.v2.asked/replied/rejected`（翻译器产伪事件）+ mock `v2Questions` | v2-translator.ts:378-394 |
| todowrite 隐藏态 | todo tool part | 渲染隐藏是投影静态行为，mock `v2Todos` + 初始装载即可断言，无需事件 | server-session.ts:1348-1358 |
| compaction | （原套件未覆盖） | `compaction.ended`（合成 user + compaction part）——本提案不新增场景 | v2-translator.ts:337-366 |

### 不可诚实表达 → 删减

- **DiffSummary「show all」（interaction.spec 1 个 test）**：wire `SessionMessageUser` 无 `summary` 字段（sdk/js/src/v2/gen/types.gen.ts:3016-3028），`adaptUser` 不产出 summary（v2-adapter.ts:284-326），rows.ts:141 的 `userMessage.summary?.diffs` 恒为空。该 UI 行在 V2 已无数据供给，伪造数据喂它违反「测真实实现」。删除此 test 并在 README 记依据；DiffSummary 行清理另立产品侧提案。
- **`session.status` 事件本身**：reducer 仍受理（server-session.ts:995-999）但 V2 server 不发，套件禁用以保持「只发生产词汇」。

### 环境/基建（wire 无关，原样恢复）

- `waitForVisualSettle`（rAF 轮询几何静止）、viewport/deviceScaleFactor（CDP）/reducedMotion（emulateMedia）/cpuRate（CDP setCPUThrottlingRate）控制、locale 选项（原无 spec 使用，不重建）。
- `installSseTransport`（e2e/utils/sse-transport.ts，幸存）：持久受控连接 + `options.marker` 写入页内 probe markers，泛型与 wire 无关，直接复用。
- 视觉预言机 9 模块（e2e/utils/visual-stability/）：`defineVisualRegions`/`startVisualProbe`/`stopVisualProbe`/`visualPlan`/`reportVisualStability` 五件套调用面不变。

## Goals / Non-Goals

Goals：13 个 spec 文件（42 个 test，原 43 减 DiffSummary）在 V2 wire 下重建并通过；fixture 单一数据面（无 V1 残留形状）；四条接线恢复（见 proposal）。

Non-Goals：见 proposal.md「非目标」。设计层补充：不为还原 V1 语义而在 mock/fixture 里发明 V2 server 不会发的事件组合（如绕过 `step.started` 直接 `text.delta`）——帧序列必须满足翻译器的有状态前提（calls 表/assistants 骨架/reasoningStarts 计时）。

## Decisions

### D1：恢复-改写而非重写

以 `git show cdf9c4f0d2^` 恢复 13 spec + README 原文为起点，逐文件改写 fixture 调用点。理由：spec 的 probe 区域定义、invariant 组合、交互序列（滚动/键盘/焦点/拖拽）是契约主体且 wire 无关，重写会丢失这些沉淀；被改写的只是数据构造与事件发送两段。fixture.ts 整体重写（583 行中仅 `waitForVisualSettle`/环境控制约 100 行可原样保留）。

### D2：fixture 定位为「v2-fixture 的场景层」，不复制工厂

fixture.ts 不再自带消息/part 构造函数族（`userMessage`/`assistantMessage`/`toolPart`/`shell` 等 V1 族整体废弃），改为：
- 直接 re-export/转调 `e2e/utils/v2-fixture.ts` 的 `v2UserMessage`/`v2AssistantMessage`/`v2Text`/`v2Reasoning`/`v2Tool*`；
- 只保留稳定性套件特有的语义封装：`setupTimeline(page, opts)`（总装）、`send/sendAll`（事件 + probe marker 自动标注）、`historyMessages`（改为薄包装 `v2History`）、`toolSequence`（`tool.called→progress→success` 帧序列生成器，把「四态推进」这一 13 spec 共享模式收为一处）。

备选（不采纳）：把场景层并入 `e2e/utils/v2-fixture.ts`——该文件是 regression/benchmark 共用的 wire 层，混入稳定性套件的 probe 接线会污染其单一职责。

### D3：事件序列生成器按「帧序列」而非「单事件」建模

V1 的 `partUpdated(part)` 是单事件 upsert；V2 等价物是满足翻译器状态前提的帧序列。fixture 提供：
- `textTurn(textId, chunks)` → `text.started + delta×N + ended`；
- `reasoningTurn(...)` 同理；
- `toolSequence(callId, {tool, input, progress?, outcome})` → `tool.called [+ tool.progress×N] + tool.success|tool.failed`；
- `stepShell(assistantMessageID, {agent, model})` → `step.started`，与 `stepEnded(...)`/`stepFailed(...)` 配对；
- `retrySequence(attempts)` → `session.next.retried ×N`（attempt 递增）。
`v2-fixture.ts` 已有的 `v2StreamTurn` 是「完整回合」最小集，覆用其帧形状但本套件需要更细的逐帧控制（probe marker 要打在每一帧上），故组装在套件 fixture 内，`v2StreamTurn` 不改动。

### D4：busy/idle 用「v2Active 函数 + 事件触发对账」，不发假事件

mock `v2Active` 接受函数（现存能力），fixture 的 `setBusy(bool)` 翻转闭包变量，随后发一个真实的下一帧（场景里本来就有后续事件）触发 server-sync 的 400ms debounce `refreshActive()`。若场景在翻转后无后续事件，fixture 发一个对该会话无副作用的 `session.next.updated`（title 原值）作为对账触发——这是 server 真实会发的事件，不算伪造。

备选（不采纳）：直接发 legacy `session.status`——reducer 受理但生产无此事件，违反诚实原则。

### D5：插删场景走 revert.committed 强制重拉

transition-matrix 的「中间 part 插删」「message.removed 逐条」、context-matrix 的「删首成员」统一改为：mock `v2Messages` 用闭包可变数组，测试中途改写内容后发 `session.next.revert.committed`（server-session.ts:901 → `sync(force)` → `loadMessages` replace → `replaceMessages`/`replaceParts` reconcile）。这是 V2 下投影内容增删的真实通路（revert 流程）。注意点：reconcile 的 `preserveUnfetched` 只保留「fetched 页之前」的未拉取消息，场景须保证目标行在首页内（本套件消息量 ≤40，首页 20 条 + 自动续拉兜底，需实测确认落点）。

降级预案：若实测发现 reconcile 在特定时序下不删（如 delta 累加保护 `preserveDelta`），该子场景改写为「新会话冷装载差异页」形态（两次 goto 之间改 mock），仍断言同一不变量；仍不可行才删减并记依据。禁止回退到发 V1 事件。

### D6：fixture 自检并入 v2-fixture.spec.ts，不复活 bun:test 文件

被删 `fixture.test.ts`（bun:test，68 行）的四组运行时断言 + 编译期 `@ts-expect-error` 区块，改写后并入现存 `e2e/utils/v2-fixture.spec.ts`（Playwright 风格，已测 v2-fixture 工厂与 `validateV2Timeline`）。新增断言针对 D3 的序列生成器（帧序合法、ID 确定性、四态互斥编译期）。理由：消除双跑测器形态（performance/AGENTS.md「简单性优先」），且自检对象已从「V1 形状」变为「V2 工厂 + 序列生成器」。

### D7：套件配置与接线按原样恢复

- `timeline-stability/playwright.config.ts`：恢复被删版原文（继承 `../playwright.config`、testMatch `**/*.spec.ts`、testIgnore `[]` 防误排、独立 outputDir/report 目录、retries 0、workers 1、trace/screenshot/video retain-on-failure）。
- `performance/playwright.config.ts`：testIgnore 加回 `timeline-stability/**`（含原注释）。
- `package.json`：`test:stability` 恢复为 `bun test ./e2e/performance/unit/visual-stability.test.ts && playwright test --config e2e/performance/timeline-stability/playwright.config.ts`。
- `e2e/tsconfig.json`：include 加回 `./performance/timeline-stability/**/*.spec.ts` 与 `./performance/timeline-stability/fixture.ts`（fixture.test.ts 不复活，不加）。

### D8：README 恢复并补 V2 映射注记

README.md 以被删版为底，契约清单与六层分层原样保留，增补：V1→V2 驱动映射摘要（指向本文件）、DiffSummary 删减依据、`OPENNOVEL_STABILITY_CAPTURE=1` 可选截图说明（原有）。

## Risks / Trade-offs

- [42 个视觉探针测试在 CPU 节流下串行执行，总时长可能达数十分钟] → 套件本就地手动/按需运行（不进 CI）；单测超时按场景事件量调节（performance/AGENTS.md 稳定性优先），不设机器阈值。
- [revert.committed 驱动插删是首次使用的通路，reconcile 保护逻辑（preserveDelta/carriedDeltaParts）可能拦截预期删除] → D5 降级预案；实施任务的第一个测试场景就是它，尽早暴露。
- [`setBusy` 依赖 server-sync 400ms debounce，探针采样窗口可能抓到对账前中间态] → 断言用 `expect.poll` 等终态而非瞬时态；visual invariant 的 perMarker 窗口从对账后一帧起算（marker 打在触发事件之后）。
- [恢复-改写可能带回已失效假设（如 V1 的初始 busy 推导「末条 assistant 无 completed ⇒ busy」）] → V2 初始 busy 由 `v2Active` 显式供给，改写时逐 spec 核对初始状态来源（侦察已确认 12 处 status 使用集中在 lifecycle/tools/transition-matrix）。

## Migration Plan

单分支 `timeline-stability-v2` 承载，实施顺序见 tasks.md：先 fixture + 自检（D2/D3/D6）→ 按「纯交互 → 单事件流 → 多事件矩阵 → 插删/状态翻转」梯度改写 13 spec（风险最高的 D5 通路最先实测）→ 接线四处（D7）→ 全量守门（typecheck/oxlint/unit/套件跑通/e2e 守门零波及）→ 归档合并。回滚：套件为纯新增目录 + 四处接线增量，`git revert` 即可，无生产代码改动。

## Open Questions

- D5 的 reconcile 实测落点（首页 20 条窗口内目标行是否一定被重拉覆盖）——实施第一个插删场景时验证，不改变任务分解（预案已列）。
