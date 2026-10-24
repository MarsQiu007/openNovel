# Tasks: timeline-stability-v2

> 实施梯度：先 fixture 与自检，再按「纯交互 → 单事件流 → 多事件矩阵 → 插删/状态翻转」改写 spec（风险最高的 D5 通路最先实测）。每组任务自带验证。

## 1. Fixture V2 化

- [x] 1.1 以 `git show cdf9c4f0d2^:packages/app/e2e/performance/timeline-stability/fixture.ts` 为参照重写 `packages/app/e2e/performance/timeline-stability/fixture.ts`：数据面改用 `e2e/utils/v2-fixture.ts` 工厂；`setupTimeline` 的 mock 键换 `v2Messages`/`v2Active`/`v2Diff`/`v2Questions`；保留 `waitForVisualSettle` 与 viewport/DPR/reducedMotion/cpuRate 环境控制、`installSseTransport` + probe marker 接线。验证：`cd packages/app && bun run typecheck:e2e` 零报错（该脚本即 `tsgo -p e2e/tsconfig.json`；1.5 接线完成前 include 未含新目录，可先临时加条目验证，6.1 复核）。
- [x] 1.2 实现 D3 帧序列生成器（`textTurn`/`reasoningTurn`/`toolSequence`/`stepShell`+`stepEnded`/`stepFailed`/`retrySequence`）与 D4 的 `setBusy`（v2Active 闭包翻转 + 对账触发）。验证：1.3 的自检断言全绿。
- [x] 1.3 fixture 自检落地为套件内 `fixture.spec.ts`（Playwright 纯 node 断言，同 `e2e/utils/v2-fixture.spec.ts` 形态；不并入 utils 以避免 utils→performance 反向依赖）：帧序合法（started→delta×N→ended）、delta 重组还原原文、toolSequence 四态与 failed 变体、种子工厂 ID 确定性与 `validateV2Timeline` 通过、畸形事件构造被拒。验证：随套件 config 跑 `fixture.spec.ts` 全绿（6.1 接线后）；接线前可用 `--config e2e/performance/playwright.config.ts` 临时直接跑该文件（它不依赖 page，webServer 启动开销除外）。

## 2. 插删通路先行实测（D5 风险前置）

- [x] 2.1 改写 `transition-matrix.spec.ts`（6 tests）：中间 part 插删与 message 删除走「可变 v2Messages + `session.next.revert.committed` 强制重拉」；retry 演进走 `retrySequence` + `step.started` 清 retry；Thinking→Error 走 `reasoning.*` + `step.failed`。验证：`bunx playwright test --config e2e/performance/timeline-stability/playwright.config.ts transition-matrix` 全绿；若 reconcile 实测不符，按 D5 降级预案改写并在本文件记录。

## 3. 纯交互与环境矩阵（零/少事件场景）

- [x] 3.1 改写 `interaction.spec.ts`（4→3 tests：删 DiffSummary show-all，README 记依据）与 `scroll-interaction.spec.ts`（7 tests）：两者以 DOM 交互/滚动驱动为主，事件量少。验证：两 spec 在套件 config 下全绿。
- [x] 3.2 改写 `environment-matrix.spec.ts`（3 tests：DPR 1/1.25、reducedMotion）与 `oracle-browser.spec.ts`（2 tests：分析器自校验，直调 `analyzeVisualObservations`）。验证：两 spec 全绿。

## 4. 工具与 shell 矩阵（tool 帧序列主力场景）

- [x] 4.1 改写 `shell-matrix.spec.ts`（5 tests：空→完成、50 行增量、ANSI+CRLF、折叠收 50 行、running→error、晚到 text）。shell 输出增长走 `toolSequence` 的 progress structured。验证：spec 全绿。
- [x] 4.2 改写 `tools.spec.ts`（2 tests：轻量工具四态 + question/todowrite 隐藏态 + 混合上下文组错峰）与 `tool-mutation.spec.ts`（2 tests：task 挂 child session 链接、参数原位变更）。busy/idle 翻转走 `setBusy`。验证：两 spec 全绿。
- [x] 4.3 改写 `file-matrix.spec.ts`（2 tests：edit/apply_patch 三态）与 `file-mutation.spec.ts`（1 test：文件列表增量）：metadata.filediff/files 走 tool progress/success 的 structured。验证：两 spec 全绿。
- [x] 4.4 改写 `context-matrix.spec.ts`（3 tests：上下文组追加/拆分合并/删首成员保 row key）。「删首成员」走 D5 重拉通路（已在 2.1 验证）。验证：spec 全绿。（注：删首成员用例首跑出现过一次未捕获明细的红，隔离重跑与全 spec 重跑均绿，记为一次性时序抖动，守门时复核）

## 5. 生命周期与对抗场景（多事件交错 + 状态翻转）

- [x] 5.1 改写 `lifecycle.spec.ts`（2 tests：3 shell 错峰完成 + 迟到 sibling；Thinking→reasoning→text 交接 continuous-any）。`sendAll` 多事件交错 + `setBusy` 两轮翻转。验证：spec 全绿。（注：探针报告后的折叠点击曾空转 175s——归因链：novel-live 对 step.ended 的 5s 防抖 invalidate 整页重挂工作区；且 autoScroll（working 恒 true）的 ResizeObserver 在 userScrolled=false 时把一切程序滚动拉回底部，userScrolled 只能由 wheel/touch 手势置位。处置：等旧节点离线确认重挂完成 → 派发 wheel 上滚手势解除底部跟随 → 居中滚动再点击）
- [x] 5.2 改写 `adverse.spec.ts`（4 tests：滚离不被增长 shell 拉动、折叠态跨虚拟化保留、窄视口 resize 行序）。验证：spec 全绿。（注：宿主迁移后窗口过窄会触发工作台右栏自动收边（display:none，产品预期），V1 的 430px 窄视口场景不可复现——「窄态行序」改钉小右栏宽 420（fixture 新增 `railWidth` 选项），resize 用例收窄终点抬到 1000 以停在收边阈值之上）

## 6. 接线恢复与文档

- [x] 6.1 恢复四处接线（D7）：`e2e/tsconfig.json` include 补 timeline-stability 两条；`performance/playwright.config.ts` testIgnore 补 `timeline-stability/**`；`package.json` `test:stability` 恢复两段式；重建 `timeline-stability/playwright.config.ts`（被删版原文）。验证：`bun run test:stability` 两段全绿（unit 23 pass + 套件 51 passed 含 fixture 自检 8，场景测试 43）；`bun run test:bench` 的 playwright 收集不波及 timeline-stability（`--list` 确认 14 tests 全为 timeline/ 基准）。
- [x] 6.2 恢复 README.md（D8：契约清单与六层原样 + V2 映射摘要 + DiffSummary 删减依据）。验证：README 与 design.md 的映射表一致，无矛盾。

## 7. 守门与收官

- [x] 7.1 全量守门：`cd packages/app && bun typecheck` 绿；repo root `bun x oxlint` 0 errors（warnings 不超基线 5715）；`bun run test:stability` 全绿；`bun run test:bench` 两步全绿且无新增收集；e2e 守门套件（`bunx playwright test` 默认 config）失败数不超 main 基线 3 个既有红（annotation-execute/remote-session-settings/novel journey chat panel）。验证：各命令输出记录进实施注记。（实施注记：typecheck / typecheck:e2e 绿；oxlint 曾超基线 32（本套件新增文件的 type-assertion 告警），清零后回到 0 errors / 5715；test:stability = unit 23 pass + 套件 51 passed；test:bench = unit 40 pass + bench 14 passed（14.4m）；e2e 守门 114 passed / 3 failed，3 红与基线逐一同名命中；context-matrix 删首成员用例随全套件两轮全绿，一次性抖动未复现）
- [x] 7.2 收官：勾选本文件全部任务；`git log --grep "OpenSpec-Change: timeline-stability-v2" --format="%h %s"` 收集实现提交写入 `## Implementation Commits`；`openspec validate timeline-stability-v2` 通过。

## Implementation Commits

- 250b1c6dc9 test(app): timeline-stability 套件 fixture 与 10 个 spec 完成 V2 化
- 369b7d4c2e test(app): adverse 矩阵 V2 化与窄容器场景改走 railWidth
- 687bed0ecd test(app): 恢复 timeline-stability 套件四处接线
- 6c231bbc0d docs(app): timeline-stability README 恢复并补 V2 迁移注记
- 0f4bd35eac test(app): timeline-stability 套件清零 lint 告警

## Workflow follow-up

- `openspec validate timeline-stability-v2`（skip_specs，零 delta 提示属预期）
- `npx openspec archive timeline-stability-v2 --yes` 归档，确认是纯 rename 无残留
- 合并前工作树干净，`git merge --ff-only timeline-stability-v2` 合入 main，删除本地分支（不推送）
