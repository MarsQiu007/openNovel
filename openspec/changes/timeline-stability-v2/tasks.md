# Tasks: timeline-stability-v2

> 实施梯度：先 fixture 与自检，再按「纯交互 → 单事件流 → 多事件矩阵 → 插删/状态翻转」改写 spec（风险最高的 D5 通路最先实测）。每组任务自带验证。

## 1. Fixture V2 化

- [ ] 1.1 以 `git show cdf9c4f0d2^:packages/app/e2e/performance/timeline-stability/fixture.ts` 为参照重写 `packages/app/e2e/performance/timeline-stability/fixture.ts`：数据面改用 `e2e/utils/v2-fixture.ts` 工厂；`setupTimeline` 的 mock 键换 `v2Messages`/`v2Active`/`v2Diff`/`v2Questions`；保留 `waitForVisualSettle` 与 viewport/DPR/reducedMotion/cpuRate 环境控制、`installSseTransport` + probe marker 接线。验证：`cd packages/app && bun run typecheck:e2e` 零报错（该脚本即 `tsgo -p e2e/tsconfig.json`；1.5 接线完成前 include 未含新目录，可先临时加条目验证，6.1 复核）。
- [ ] 1.2 实现 D3 帧序列生成器（`textTurn`/`reasoningTurn`/`toolSequence`/`stepShell`+`stepEnded`/`stepFailed`/`retrySequence`）与 D4 的 `setBusy`（v2Active 闭包翻转 + 对账触发）。验证：1.3 的自检断言全绿。
- [ ] 1.3 fixture 自检并入 `e2e/utils/v2-fixture.spec.ts`：新增序列生成器断言（帧序合法、事件 ID 确定性递增、tool 四态互斥编译期 `@ts-expect-error`、合法构造过 `validateV2Timeline`、畸形构造被拒）。验证：`cd packages/app && bunx playwright test e2e/utils/v2-fixture.spec.ts` 全绿。

## 2. 插删通路先行实测（D5 风险前置）

- [ ] 2.1 改写 `transition-matrix.spec.ts`（6 tests）：中间 part 插删与 message 删除走「可变 v2Messages + `session.next.revert.committed` 强制重拉」；retry 演进走 `retrySequence` + `step.started` 清 retry；Thinking→Error 走 `reasoning.*` + `step.failed`。验证：`bunx playwright test --config e2e/performance/timeline-stability/playwright.config.ts transition-matrix` 全绿；若 reconcile 实测不符，按 D5 降级预案改写并在本文件记录。

## 3. 纯交互与环境矩阵（零/少事件场景）

- [ ] 3.1 改写 `interaction.spec.ts`（4→3 tests：删 DiffSummary show-all，README 记依据）与 `scroll-interaction.spec.ts`（7 tests）：两者以 DOM 交互/滚动驱动为主，事件量少。验证：两 spec 在套件 config 下全绿。
- [ ] 3.2 改写 `environment-matrix.spec.ts`（3 tests：DPR 1/1.25、reducedMotion）与 `oracle-browser.spec.ts`（2 tests：分析器自校验，直调 `analyzeVisualObservations`）。验证：两 spec 全绿。

## 4. 工具与 shell 矩阵（tool 帧序列主力场景）

- [ ] 4.1 改写 `shell-matrix.spec.ts`（5 tests：空→完成、50 行增量、ANSI+CRLF、折叠收 50 行、running→error、晚到 text）。shell 输出增长走 `toolSequence` 的 progress structured。验证：spec 全绿。
- [ ] 4.2 改写 `tools.spec.ts`（2 tests：轻量工具四态 + question/todowrite 隐藏态 + 混合上下文组错峰）与 `tool-mutation.spec.ts`（2 tests：task 挂 child session 链接、参数原位变更）。busy/idle 翻转走 `setBusy`。验证：两 spec 全绿。
- [ ] 4.3 改写 `file-matrix.spec.ts`（2 tests：edit/apply_patch 三态）与 `file-mutation.spec.ts`（1 test：文件列表增量）：metadata.filediff/files 走 tool progress/success 的 structured。验证：两 spec 全绿。
- [ ] 4.4 改写 `context-matrix.spec.ts`（3 tests：上下文组追加/拆分合并/删首成员保 row key）。「删首成员」走 D5 重拉通路（已在 2.1 验证）。验证：spec 全绿。

## 5. 生命周期与对抗场景（多事件交错 + 状态翻转）

- [ ] 5.1 改写 `lifecycle.spec.ts`（2 tests：3 shell 错峰完成 + 迟到 sibling；Thinking→reasoning→text 交接 continuous-any）。`sendAll` 多事件交错 + `setBusy` 两轮翻转。验证：spec 全绿。
- [ ] 5.2 改写 `adverse.spec.ts`（4 tests：滚离不被增长 shell 拉动、折叠态跨虚拟化保留、窄视口 resize 行序）。验证：spec 全绿。

## 6. 接线恢复与文档

- [ ] 6.1 恢复四处接线（D7）：`e2e/tsconfig.json` include 补 timeline-stability 两条；`performance/playwright.config.ts` testIgnore 补 `timeline-stability/**`；`package.json` `test:stability` 恢复两段式；重建 `timeline-stability/playwright.config.ts`（被删版原文）。验证：`bun run test:stability` 两段全绿（unit 23 + 套件 42 tests）；`bun run test:bench` 的 playwright 收集不波及 timeline-stability（`--list` 确认）。
- [ ] 6.2 恢复 README.md（D8：契约清单与六层原样 + V2 映射摘要 + DiffSummary 删减依据）。验证：README 与 design.md 的映射表一致，无矛盾。

## 7. 守门与收官

- [ ] 7.1 全量守门：`cd packages/app && bun typecheck` 绿；repo root `bun x oxlint` 0 errors（warnings 不超基线 5715）；`bun run test:stability` 全绿；`bun run test:bench` 两步全绿且无新增收集；e2e 守门套件（`bunx playwright test` 默认 config）失败数不超 main 基线 3 个既有红（annotation-execute/remote-session-settings/novel journey chat panel）。验证：各命令输出记录进实施注记。
- [ ] 7.2 收官：勾选本文件全部任务；`git log --grep "OpenSpec-Change: timeline-stability-v2" --format="%h %s"` 收集实现提交写入 `## Implementation Commits`；`openspec validate timeline-stability-v2` 通过。

## Implementation Commits

（收官时回填）

## Workflow follow-up

- `openspec validate timeline-stability-v2`（skip_specs，零 delta 提示属预期）
- `npx openspec archive timeline-stability-v2 --yes` 归档，确认是纯 rename 无残留
- 合并前工作树干净，`git merge --ff-only timeline-stability-v2` 合入 main，删除本地分支（不推送）
