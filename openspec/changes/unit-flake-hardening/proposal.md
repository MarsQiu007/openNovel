# Proposal

## Why

`unit (linux)` 与 `unit (windows)` 的 `Run unit tests` 步存在四个对调度时序敏感的用例（issue #8 / #9 / #10 / #13），在机器负载下偶发红、reroll 才转绿：

- #8 `tool.shell abort > streams metadata updates progressively`（linux）：`echo first && sleep 0.1 && echo second` 依赖两次读取不被合并；负载高时消费 fiber 未及时回到读取点，两行会被内核缓冲合并为一次 chunk 交付，`updates.length > 1` 断言失败（run 38494975350 / job 115628567744）。
- #9 `registerNovelSyncHandler > 手动与升级来源的重建注入一致`（linux 首次观测）：进程级 5s 全局轮询定时器可能在断言前消费其它目录的遗留任务，复用本用例注册的 handler 闭包与 model，调用计数不稳定（run 38523923861 / job 115719717757）。
- #10 `loop waits while shell runs and starts after shell exits`（windows 复发签名）与同族 `shell completion resumes queued loop callers`：真实子进程 + 固定超时窗口，CI 负载慢时 10s / 30s 上限先到，失败信息不指向阶段（run 38523923861 / job 115719717665）。
- #13 `observe-element-offset` 重挂载观察用例（windows）：断言收到空数组（run 38585727035 / job 115927668123）。实施期间定位到真实根因：测试环境 happy-dom ≤20.11.1 的 MutationObserver 上报回调仅被 `WeakRef` 弱持有，GC 回收后 observer 静默失效——失败不是「回调晚到」而是「永远不会到」（本地实证约 10% 失败率；强制 GC 下 100% 失败），固定帧数窗口只是放大了可见性。

四个用例都表现为「时序敏感、reroll 即绿」的误红，但根因分两类：#8 / #9 / #10 是等待机制与调度耦合（固定时间窗兜底）；#13 是测试 DOM 环境依赖的 GC 失效缺陷（等待再久也无法修复），固定帧数窗口只是放大了可见性。两者都持续消耗重跑配额、污染门禁信号，也把排查引向错误方向。

## What Changes

- **#8 shell 流式 metadata 用例**：把时间窗驱动的两行输出改为 ack 文件握手——shell 侧 `echo first` 后阻塞等待 ack 文件再 `echo second`，测试侧在首次收到非空流式 metadata 时创建 ack 文件（文件位于独立临时目录，以 `workdir` 作为 shell cwd）。两次交付由外部信号确定化，不再依赖 100ms 窗口；失败时打印实际 `updates` 序列。
- **#9 sync worker 重建注入用例**：测试内停用全局轮询定时器（`stopSyncWorker()`），只靠手动 `processSyncQueue` 驱动消费；断言改为对 `model.doGenerateCalls` 的直接长度断言，失败信息附调用明细，去掉标题锚点过滤。
- **#10 shell/loop 超时用例（两个）**：改为 ack 文件门控 shell 生命周期（shell 阻塞等待 ack，测试确认「loop 未启动」后再放行），消除与 `sleep 0.2` 的竞速窗口；`Fiber.await` 各阶段改用带阶段名的有界等待（`awaitWithTimeout`），失败直接指出是哪个阶段超时；`waitForBusy` 轮询窗口放宽，per-test 超时只作兜底。
- **#13 observe-element-offset 用例（含测试环境修复）**：① 把 `setTimeout(0) + frames(3)` 的正断言（回调必须到达）改为条件轮询——等待 `calls` 达到期望值，超时失败时打印实际回调序列，负断言保留快速窗口；② 根因修复：`@happy-dom/global-registrator` 由 20.0.11 升级到 20.14.6（同大版本；其依赖的 happy-dom 同步由 20.11.1 升到 20.14.6）——上游把 MutationObserver 回调从「仅 WeakRef 弱持有」改为「私有字段强持有 + WeakRef 包装该字段」，消除 GC 失效。
- **验证**：每个改动用例本地 20+ 连跑通过；opennovel / app 包级全量测试通过；推送后 CI generate / typecheck / test 全绿 → 归档 → 关闭四条 issue。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。本变更只调整测试等待策略，不改变任何 spec 级产品行为；`.openspec.yaml` 设置 `skip_specs: true`，先例 `2026-10-10-test-suite-hygiene`、`2026-10-14-httpapi-exercise-flake`。）

## 非目标

- 不改产品代码：`src/tool/shell.ts`、`src/novel/manual-edit-sync-worker.ts`、`src/session/prompt.ts`、`observe-element-offset.ts` 均不动——#8/#9/#10 由测试侧握手 / 条件等待消除竞态，#13 由测试环境依赖升级（devDependency）修复；产品语义（含「一次 chunk 一次 metadata」「停用轮询后手动消费」等）保持不变。
- 不把这批用例重构为可控假子进程（issue #8 / #10 的建议 3），保留真实 spawn 的端到端覆盖；若后续仍不稳定再单独立案。
- 不做全仓时序用例统查统改：只治理已立案的四个用例，其余同族用例复发时另立 issue。
- 不修改 exercise 门禁与 `fixture/db.ts`（#7 已由归档提案 `2026-10-14-httpapi-exercise-flake` 收尾）。
- 不改公开 Protocol / Server HttpApi → 无需重新生成 SDK。

## Impact

- **packages/opennovel**（仅测试文件）：`test/tool/shell.test.ts`、`test/novel/sync-worker-composition.test.ts`、`test/session/prompt.test.ts`；复用既有 `tmpdirScoped`、`FSUtil`、`awaitWithTimeout`、`stopSyncWorker` 等测试基建，新增局部 ack 等待与阶段化超时逻辑。
- **packages/app**（测试环境与测试文件）：`src/pages/session/timeline/observe-element-offset.test.ts` 新增文件内条件等待 helper；`package.json` 升级 `@happy-dom/global-registrator` 20.0.11 → 20.14.6（devDependency，含 `bun.lock` 更新）。升级只影响 app 测试 DOM 环境，不改产品代码与运行时依赖。
- 无产品行为、数据模型、依赖与本地数据兼容性影响。
- CI：`unit (linux)` / `unit (windows)` 四个已知 flake 用例转为稳定绿，减少 reroll 依赖。