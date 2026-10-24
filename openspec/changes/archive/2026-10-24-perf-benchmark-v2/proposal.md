# Proposal: perf-benchmark-v2

> e2e-v2-mock 跟进项（其提案「非目标」原文：「不做 performance/benchmark（含 timeline 助手）的 V2 化——后续独立提案」）。mock-server 已切 V2 wire，但 performance/benchmark 套件未跟进，现全部 broken-by-cutover 烂在树上。本提案把 benchmark 套件迁移到 V2 mock 形态，恢复 `test:bench` 可用性。

## Why

`mock-server.ts` 在 e2e-v2-mock Wave 1（90c7f2ea10）重写为 V2 wire 后，未触碰 `packages/app/e2e/performance/` 下任何文件。侦察（逐文件 file:line 核实）确认现状：

- **`test:bench` 第一步即红**：`unit/mock-server.test.ts` 仍传已删除的 `messageDelay/onMessages/pageMessages` 配置键、打 V1 路径（无 `/api` 前缀），请求落入显式 404 catch-all，事件断言必败。
- **6 个 benchmark spec 全军覆没**：fixture/helper 层集中依赖已删除的 V1 config 键——`session-timeline-benchmark.fixture.ts` 的 `pageMessages`（V1 裸 items + before 游标）与 V1 SSE 词汇（`message.part.updated`）；`session-timeline-stress.fixture.ts` 的手写 before-游标分页；`timeline-test-helpers.ts` 透传死键被静默忽略；`session-parent-hydration-benchmark.spec.ts` 传 6 个死键且裸 fulfill 无 `{data}` 信封的 V1 session 对象。`v2Messages` 未配置时消息接口恒返空页，时间线永远为空，`waitForStableTimeline` 全部超时。
- **`bun typecheck` 连带报错**：对象字面量传未知键触发 excess property 检查，performance 目录成为 app typecheck 的红点。
- **幸存面无需动**：probe/metrics 文件（`*-probe.ts`、`*-metrics.ts`、`benchmark.ts`、`chrome-trace.ts`）是纯页内 DOM/rAF 探针，grep 全目录无任何 server API 依赖，零改动。

这不是「要不要做」而是「现资产已坏」：套件不进 CI 不等于可以烂在树上——它是时间线渲染性能回归的唯一守门。

## What Changes

- **fixture 数据模型 V2 化**：`session-timeline-benchmark.fixture.ts` 与 `session-timeline-stress.fixture.ts` 的消息从 `{info, parts}` 对改为单体 `SessionMessage`，构造改用现有 `utils/v2-fixture.ts` 工厂（`v2History`/`v2AssistantMessage`/`v2Text` 等）。
- **mock 配置键迁移**：`pageMessages` → `v2Messages`（V2 mock 服务端自持不透明 cursor 分页，fixture 只供升序全量列表，stress fixture 的手写分页函数整体删除）；`onMessages` → `onV2Messages`（`before` 参数改 `cursor`）；`messageDelay` → `beforeV2MessagesResponse` 异步睡眠。
- **SSE 词汇对齐生产**：注入事件从 `message.part.updated/delta` 换成 `session.next.*` 词汇，流式回合用 `v2StreamTurn` 工厂。
- **parent-hydration 修复**：6 个死键按上述映射替换；裸 `page.route` fulfill 的 session 对象补 `{data}` 信封。
- **unit/mock-server.test.ts 迁移**：V1 URL 换 `/api/session/{id}/message`，死键换 V2 键，断言语义不变（start/end 阶段回调顺序 + 延迟生效）。
- **不动**：全部 probe/metrics/harness 文件；benchmark 断言口径（采样指标与阈值）保持不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runtime-v2`：performance/benchmark 套件恢复到 V2 mock wire（skip_specs 阶段不产出 delta）

> `skip_specs: true`。

## Impact

- **受影响包**：仅 `app`（e2e/performance 测试面；生产代码不改）。
- **CI**：无影响——performance 套件本就不进 CI（根 playwright.config `testIgnore: "performance/**"`）；但 `bun typecheck` 在 packages/app 的现存红点由本提案清除。
- **依赖关系**：前置 e2e-v2-mock（已归档，V2 mock 的 gated response/cursor 分页等能力齐备，regression 下 7 个活 spec 已有用法示范）；被删 V1 形态的对照在 git 历史（`git show cdf9c4f0d2^:<path>`）与 `.agent_tmp/deleted-e2e/` 转储。
- **风险**：benchmark 数值基线建立在 V1 数据形态上，迁移后绝对数值会有漂移——本提案只保证套件恢复可运行且断言口径不变，不承诺数值与 V1 时代可比；阈值类断言若因 V2 消息结构差异系统性偏移，按现状校准并在实施记录中说明。

## 非目标

- 不重建 timeline-stability 视觉稳定性套件（13 spec + fixture.ts + 视觉预言机）——后续独立提案（不进 CI，基建与断言体系独立）。
- 不改 probe/metrics 探针与 `benchmark.ts`/`chrome-trace.ts` harness。
- 不调整 benchmark 的采样指标、阈值与断言口径（除 V2 消息结构必需的适配）。
- 不把 performance 套件接入 CI。
- 不改 app 生产代码（若迁移中发现 adapter/渲染真 bug，另立提案修复）。
