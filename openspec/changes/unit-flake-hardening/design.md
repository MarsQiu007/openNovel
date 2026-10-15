# Design

## Context

动机与失败证据见 `proposal.md · Why`。本设计聚焦「等待策略怎么改」：

- 四个用例的等待都属于「条件可观测、但用固定时长兜底」：100ms 两行间隔、5s 全局轮询、`sleep 0.2` + 10s/30s 超时、3 帧 rAF 窗口。负载拉长任一环节即误红。
- 既有测试基建可复用：`pollWithTimeout` / `awaitWithTimeout`（`packages/opennovel/test/lib/effect.ts`）、`tmpdirScoped` fixture、`FSUtil`、`stopSyncWorker` 测试入口（`src/novel/manual-edit-sync-worker.ts`）、`.shell-ready` 文件握手先例（`test/session/prompt.test.ts` 的 cancel 用例，POSIX-only）。
- shell 工具关键事实（决定握手写法）：命令 cwd 为实例目录、shell 经 `Shell.acceptable()` 选择（CI linux=bash、windows=pwsh）、每个输出 chunk 触发一次 `ctx.metadata`，且执行前后各有一次非 chunk 的 metadata 调用（初始 `output: ""` 与收尾），握手必须忽略空输出调用。

## Goals / Non-Goals

Goals：

- 四个用例的通过条件与调度速度解耦：正常路径由外部信号 / 条件轮询驱动，时长只界定「真挂起」。
- 失败信息指向可行动事实：实际交付次数、实际调用明细、超时阶段名、实际回调序列。
- 不改变被验证的产品行为与既有测试意图（语义等价替换等待机制）。

Non-Goals（设计层）：

- 不引入可控假子进程 / 注入时钟（保留真实 spawn 与真实全局定时器行为）。
- 不为测试基建新增跨文件共享 helper（改动落在各自文件内，避免扩大遍历面）。
- 不调整 bun 并发模型或测试文件切分。

## Decisions

### D1. #8：ack 文件握手替代 100ms 时间窗（`test/tool/shell.test.ts`）

- shell 侧命令改为 `echo first; <wait-ack>; echo second`，wait 按 shell 分支：
  - pwsh / powershell：`while (-not (Test-Path '.shell-stream-ack')) { Start-Sleep -Milliseconds 20 }`；
  - 其余（bash 等 POSIX）：`while [ ! -f '.shell-stream-ack' ]; do sleep 0.02; done`。
- 测试侧：metadata 回调仅在 `output` 非空时 push 并写 ack 文件（空输出是工具初始/收尾调用，忽略；写出即放行第二次 echo）。由此保证「第二行写入必然发生在第一行交付之后」，两次交付结构性成立，与调度无关。
- 备选「把 sleep 从 0.1 拉长」被否：只是压低合并概率，不消除——合并由消费侧调度决定，不是生产侧节奏问题。
- 结构：改用 `tmpdirScoped()` + `runIn(tmp, …)`（同文件既有模式），ack 用相对文件名，规避跨 shell 的绝对路径转义；命令补 `timeout: 30_000`，握手死锁时快速失败而不是吃默认超时。
- 断言：`result.output` 含 first/second 不变；`expect(updates.length, message).toBeGreaterThan(1)` 输出实际序列。

### D2. #9：停用全局轮询 + 直接断言（`test/novel/sync-worker-composition.test.ts`）

- 机理：bun test 单进程顺序执行文件，模块级 `directories` / `timer` 跨文件存活；此前任何文件登记过目录（如 workspace-routing 中间件触发 `registerSyncDirectory`）且未停止时，5s 定时器会在本文件测试窗口内触发 `processRegisteredSyncDirectories()`，用**当前注册的 handler 闭包与 model** 消费其它目录遗留任务，计数串扰。
- 处置：`beforeEach` 中 `clearSyncHandlers()` 之后追加 `stopSyncWorker()`——清空残留目录集并停止定时器。`registerNovelSyncHandler` 不启动定时器，本文件所有用例都靠 `processSyncQueue(projectDir)` 手动驱动，语义不变；在途轮询尾巴窗口（≤1 个目录）由明细断言暴露，不加 sleep 掩盖。
- 断言：删除标题锚点过滤，改为 `details`（把每次调用的 prompt 串成文本）直接 `toHaveLength(2)` + 分别包含《第一章》/《第二章》+ 系统提示为「共享人格」，失败信息附完整明细。

### D3. #10：ack 门控 shell 生命周期 + 阶段化有界等待（`test/session/prompt.test.ts`，两个用例）

- 消除的竞速：`sleep 0.2` 的真实 shell 可能在「fork loop → sleep(50) → 断言 calls==0」之前就退出（负载拖慢调度时），使负断言要么失效要么偶发 `expected 0, received 1`；固定超时则在负载下先到。
- 处置（两个用例统一）：
  1. shell 命令改为等待 ack 文件的循环（同 D1 的 shell 分支语法），测试在断言 `llm.calls === 0` 之后写 ack 放行——shell 生命周期由测试完全掌控，断言 window 不再和任何时长竞速；
  2. `waitForBusy` 轮询窗口 2s → 10s（纯轮询，负载解耦）；
  3. `Fiber.await(sh)`、`Fiber.await(loop)`（及 `Effect.all([…])`）用 `awaitWithTimeout(…, "阶段名", "20 seconds")` 包裹，失败信息直接指出阶段；
  4. per-test 超时 60_000 作兜底（阶段窗口各 20s，兜底大于阶段和，保证阶段错误先于测试级超时出现）。
- 保留 `Effect.sleep(50)`：它只服务负断言（给 loop 一个「本应已经启动」的观察窗），负载只会让它更保守，不产生误红；无可观测的「已排队」条件可轮询，故不强行替换。
- 备选「只把超时从 10s 提到 30s」被否：不消除竞速也不给阶段信息，只是把同一问题推后。

### D4. #13：条件轮询替代固定帧数（`packages/app/src/pages/session/timeline/observe-element-offset.test.ts`）

- 新增文件内 `waitForCalls(calls, expected, timeoutMs = 3_000)`：按 rAF 轮询直至 `JSON.stringify` 相等；超时用 `expect(calls, message).toEqual(expected)` 抛出并打印期望与实际序列。3s 预算显著低于 bun 默认 per-test 5s 超时，且约为既有 3 帧窗口的百倍余量。
- 转换三个「回调必须到达」的正断言（重挂载首个发散回调、horizontal LTR/RTL 回调、cleanup 前的已排队回调）；负断言（无关 mutation 无回调、cleanup 后无回调）保持固定窗口快速通过；`scrollOffset` 前置断言与 stale reset-delay 用例保持原逻辑（其等待由产品 rAF 链先于测试帧顺序保证）。
- 不再依赖 `setTimeout(0) + frames(3)` 的帧序假设：负载下 MutationObserver 回调与 rAF 链被推迟也不误红。

### D5. 验证策略

- 每个改动用例 `--rerun-each 20` 连跑（bun 1.3.14 支持）；opennovel 跑单文件 + 包级全量、app 跑 `test:unit`；`bun typecheck` 按包执行、根目录 `bun run lint`。
- 推送后以 CI `generate / typecheck / test`（linux + windows 两档 unit）全绿为完成标准；四个用例 20+ 连跑只作本地证据，不替代 CI。

## Risks / Trade-offs

- [shell 分支语法] ack 等待命令需区分 pwsh 与 POSIX 两族；CI 覆盖 bash（linux）与 pwsh（windows），其余环境走 POSIX 分支，与既有 `.shell-ready` 握手先例同一思路，不做更细的 shell 特化。
- [stopSyncWorker 停的是进程级状态] 本文件不依赖定时器；后续文件各自重新登记 / 启动，互不影响（`manual-edit-sync-worker.test.ts`、`httpapi-workspace-routing.test.ts` 已是先例）。
- [条件轮询把「晚到」与「不到」的区分交给超时值] 3s（app）/ 20s（prompt 阶段）/ 30s（shell 命令兜底）均数十倍于正常值；超时失败信息带实际数据，便于区分慢与坏。
- [在途轮询尾巴 / 帧外重复回调等极端残余] 不追求数学封闭，残余场景由明细化失败信息和 issue 复盘路径兜底；如复发按 `docs/agents/ci-triage.md` 重开。

## Migration Plan

- 纯测试改动；回滚 = revert 本变更提交。按包拆分提交（opennovel、app），随后按仓库流程归档、ff 合并 main、推送、确认 CI 全绿、关闭 issue #8 / #9 / #10 / #13。

## Open Questions

（无。全仓时序用例治理、假子进程化改造已列为非目标，留待后续需要时另立提案。）