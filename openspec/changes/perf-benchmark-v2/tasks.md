# Tasks: perf-benchmark-v2

## Wave 1：fixture/helper 数据面迁移

- [x] 迁移 `session-timeline-stress.fixture.ts`：消息模型换单体 `SessionMessage`（v2-fixture 工厂 + 确定性 ID），删除手写 `pageMessages` 分页函数，`fixture.messages` 改升序全量数组
- [x] 迁移 `timeline-test-helpers.ts`：`mockStressTimeline` 的 `pageMessages/onMessages` 换 `v2Messages`（无调用方使用 onMessages 回调，死参数删除）
- [x] 迁移 `session-timeline-benchmark.fixture.ts`：`pageMessages` 换 `v2Messages`；`performanceTurn` 走工厂（内容形态与确定性 ID 不变）；`buildInitialStreamEvent`/`buildStreamDeltaEvents` 换 `v2Event` + `session.next.*` 帧序（D2）；`turnDiffs` 选项删除（D5）
- [x] 迁移三个 stress 消费 spec（first-navigation / home-tab-navigation / session-tab-flash）的 `.info.id` 访问为 `.id`
- [x] 迁移 `session-timeline-benchmark.spec.ts`：`reviewDiffs` 场景改传 `v2Diff`，注释按 D5 重述
- [x] 迁移 `session-parent-hydration-benchmark.spec.ts`：按 D4 重述为页首孤儿 turn 冷切入基准（V2 无父消息水合，断言 parent GET 计数为 0）；裸 session fulfill 删除，改用 `sessionList` 覆盖键
- [x] 在 packages/app 跑 `bun typecheck`，excess property 红点清零

## Wave 2：unit 测试迁移与整卷守门

- [x] 重写 `unit/mock-server.test.ts` 为 V2 门闩语义（D6：`/api` 前缀 URL、V2 键、事件序列断言同形）
- [x] 在 packages/app 跑 `bun test ./e2e/performance/unit`，转绿
- [x] 全量首跑失败归因与修复（D8/D4 实施事实）：流式 `TIMELINE_DELTA_COUNT` 默认 160→20 + `TIMELINE_COMPLETION_TIMEOUT_MS` 默认 420s→900s（吞吐双峰实测）；staging 断言重述为 review 不先于内容；`waitForStableGeometry` 显式 60s；parent-hydration 探针身份改 turn 锚 userID
- [ ] 逐一跑通 6 个 benchmark spec（`bunx playwright test --config e2e/performance/playwright.config.ts`），确认场景完成 + 指标采集断言通过
- [ ] 在 packages/app 跑全量 `bun run test:e2e`，确认 regression/smoke 活 spec 零波及
- [ ] 仓库根 `bunx oxlint` 0 errors
- [ ] 勾选本文件任务，收集 `OpenSpec-Change: perf-benchmark-v2` 提交写入 Implementation Commits

## 完成标准

- `bun run test:bench`（packages/app）两步全绿
- packages/app `bun typecheck` 通过
- 全量 e2e 无回归；oxlint 0 errors

## Implementation Commits

（实施完成后回填）
