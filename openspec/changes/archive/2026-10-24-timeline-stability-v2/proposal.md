# Proposal: timeline-stability-v2

> e2e-v2-mock 跟进项（与 perf-benchmark-v2 同源：V1 退休提交 cdf9c4f0d2 把 timeline-stability 套件整体删除）。perf-benchmark-v2 收官时明确留痕「timeline-stability 视觉稳定性套件重建」为后续独立提案。本提案把该套件以 V2 wire 形态重建，恢复时间线视觉稳定性的唯一守门。

## Why

V1 退休提交 cdf9c4f0d2 删除了 `packages/app/e2e/performance/timeline-stability/` 全套（13 spec / 44 test + fixture.ts 583 行 + 专用 playwright.config + README），理由是 fixture 深绑 V1 wire（`SessionV1.WithParts`/`{info, parts}` 对、六类 `message.*`/`session.status` 事件）。但两块资产幸存且至今健康：

- **视觉预言机基建零损失**：`e2e/utils/visual-stability/` 9 模块（probe/analyzer/invariant/regions/reporter 等约 750 行）+ `sse-transport.ts`（持久受控 SSE 连接 + probe marker 注入）+ `unit/visual-stability.test.ts`（23/23 绿，2026-10-24 实测）。它们与 wire 无关，删除的只是驱动它们的数据面。
- **契约语义仍有效**：README 的六层契约（Projection / Local state / Interaction / Layout continuity / Reducer hardening / Oracle contract）描述的是时间线渲染的持久不变量（语义锚保持、底锚保持、相邻行有序不重叠、折叠态保持、无采样空白、行身份保持、滚动归属一致），不随 V1/V2 wire 改变。

现状是预言机空转：`test:stability` 只剩 unit 半边，生产代码（server-session 事件翻译、虚拟滚动、折叠态、底锚逻辑）的视觉回归无任何守门。侦察（逐 spec 盘点 + 投影层 file:line 核实）确认 V2 wire 足以诚实驱动除一个子场景外的全部 44 个测试（权威计数含数据驱动循环展开；「43」为提案期漏数，执行段对账修正；详见 design.md 的映射表与删减清单）。

## What Changes

- **重建 `e2e/performance/timeline-stability/`**：以 git 历史 `cdf9c4f0d2^` 为基线恢复 13 个 spec 与 README，fixture.ts 重写为 V2 形态（见下），契约断言（visualPlan/invariant 调用面）保持不变。
- **fixture.ts V2 化**：
  - 消息数据：`{info, parts}` 对 → 单体 `SessionMessage`，构造复用 `e2e/utils/v2-fixture.ts` 工厂（`v2UserMessage`/`v2AssistantMessage`/`v2Text`/`v2Reasoning`/`v2Tool*`），初始历史经 mock 的 `v2Messages` 键供给。
  - 事件驱动：V1 六类事件 → `session.next.*` 帧（`v2Event` 信封）：part 创建/更新 → `text|reasoning.started/delta/ended` 与 `tool.called/progress/success/failed`；assistant 定稿/出错 → `step.ended/failed`；retry 演进 → `session.next.retried`（native 落地 `session_status`）；busy/idle 翻转 → mock `v2Active` 函数形态 + `session.next.*` 事件触发的 `refreshActive()` 对账（400ms debounce，server-sync.tsx）。
  - 中间 part/消息插删：V2 无 part/message 级删除事件，改用「可变 `v2Messages` 函数 + `session.next.revert.committed` 强制重拉」驱动 HTTP reconcile 路径（`replaceMessages`/`replaceParts` 的真实增删通路）。
  - 保留 wire 无关部分：`waitForVisualSettle`、`installSseTransport` 持久连接 + probe marker 注入、viewport/DPR/reducedMotion/cpuRate 环境控制。
- **接线恢复四处**：`e2e/tsconfig.json` include 补回 timeline-stability 条目；`performance/playwright.config.ts` 的 testIgnore 补回 `timeline-stability/**`（防止被 test:bench 误收集）；`package.json` 的 `test:stability` 恢复为 unit + playwright 两段式；重建套件专用 playwright.config（继承 performance 配置、清空 testIgnore、workers 1、retries 0）。
- **fixture 自检合并**：被删的 bun:test 风格 `fixture.test.ts` 不复活，其校验语义（合法构造通过、畸形拒绝、ID 确定性、四态互斥编译期断言）并入现存 Playwright 风格 `e2e/utils/v2-fixture.spec.ts` 扩展，消除双跑测器形态。
- **删减一个子场景**：interaction.spec 的 DiffSummary「show all」测试不重建——wire 层 `SessionMessageUser` 无 `summary` 字段、`adaptUser` 不产出 summary，`[data-timeline-row="DiffSummary"]` 在 V2 已是无数据供给的死路（依据：sdk/js v2/gen types.gen.ts:3016-3028、v2-adapter.ts:284-326）。删减在 design.md 记依据。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runtime-v2`：timeline-stability 视觉稳定性套件以 V2 wire 重建（skip_specs 阶段不产出 delta）

> `skip_specs: true`。

## Impact

- **受影响包**：仅 `app`（e2e 测试面；生产代码不改）。
- **CI**：无影响——performance 套件不进 CI（根 playwright.config `testIgnore: "performance/**"`），重建后亦然。
- **依赖关系**：前置 e2e-v2-mock（V2 mock 键齐备：`v2Messages`/`v2Active`/`v2Diff`/`v2Questions`/`v2Todos`）与 perf-benchmark-v2（已验证的 V2 流式帧驱动模式：`session.next.*` + `v2Event` + `installSseTransport`）；被删 V1 形态对照在 git 历史（`git show cdf9c4f0d2^:packages/app/e2e/performance/timeline-stability/<path>`）。
- **风险**：
  - 「revert.committed 强制重拉驱动中间插删」依赖 `applyMessagePage`/`replaceParts` 的 reconcile 语义（已核实 file:line，但首次实测若语义不符，按 design.md 的降级预案改写该子场景，不回退到伪造 V1 事件）。
  - 43 个测试在 CPU 节流（原套件 cpuRate 4）下串行跑的时长未知，实施时若个别场景超时按 performance/AGENTS.md「稳定性优先」调事件量而非放松断言。

## 非目标

- 不改 app 生产代码（含不删除 V1 词汇 reducer 死路如 `message.removed`/`session.status` 分支、不删除无数据供给的 DiffSummary 行——若确认清理价值，另立产品侧提案）。
- 不把 timeline-stability 接入 CI。
- 不动幸存基建：`e2e/utils/visual-stability/` 9 模块、`sse-transport.ts`、`unit/visual-stability.test.ts`、`e2e/utils/visual-stability.ts` 旧 shim、`scenario.ts`（13 spec 从未使用，但属共享基建，去留另议）。
- 不设机器相关的性能阈值（本套件断言视觉不变量，不是 benchmark）。
- 不恢复被删 fixture 的 `locale`/`newLayoutDesigns:false` 选项分支（原 13 spec 无一使用，按「无冗余」原则不重建）。
