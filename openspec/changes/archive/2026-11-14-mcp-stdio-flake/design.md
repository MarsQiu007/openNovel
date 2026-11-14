# Design

## Context

动机与证据见 `proposal.md · Why`。本设计聚焦"如何门控"：

现状时序（`packages/core/src/mcp/index.ts` `connectServer`）：

```
fiber A (connectServer)                fiber B (测试)
-----------------------                ----------------
:368 entry.status = connected
:373 yield* McpCatalog.defs(...)  ← stdio 往返，可让出
                                       waitStatus 轮询看到 connected ✓
:380 entry.defs = listed
                                       mcp.tools() → 跳过无 defs 条目 → {} ✗
```

窗口常态极短（本地 fixture 毫秒级），但 CI 并行 shard 高负载下可超过测试轮询间隔（100ms），attempt 3 实测命中（`Received: []`）。

测试侧现状（`test/mcp.test.ts`）：

- `waitStatus`（`:59-66`）已有有界轮询范式：`Effect.filterOrElse` + `Schedule.spaced("100 millis").pipe(Schedule.both(Schedule.recurs(200)))`（上限约 20s，远超 60s 用例超时的安全余量）；
- 命中窗口的断言点共三处：`connects`（`:76-83` tools + instructions）、`disconnect`（`:130` tools）、`reconnects`（`:151` tools）。

约束：不碰生产代码（非目标）；不引入 `globalThis` 桩；风格遵循 AGENTS.md（const 优先、无 any、少 try/catch、复用现有 Effect 范式）。

## Goals / Non-Goals

Goals：

- 三个用例对「connected 之后工具立即可见」不再有时序假设：轮询到目标键出现才断言，常态零额外延迟（首查即中）；
- 重试耗尽时错误信息自带实际键集合，下次 flake（若仍有残余家族）无需翻日志即可归因；
- 与 `waitStatus` 同款有界上限：真回归（如 fixture server 坏掉）仍在 20s 内快速失败，不被 60s 超时掩盖。

Non-Goals（设计层）：

- 不收敛生产侧瞬态（status 词表变更属产品决策，另案）；
- 不改 fixture server（`test/fixture/mcp-stdio.ts`）与其余用例；
- 不给 `instructions()` 单独门控——`:379-383` 为同步连写（defs 可见时 instructions 必已写入），门控 tools 即覆盖。

## Decisions

### D1. 新增 `waitTools` 助手，与 `waitStatus` 同款范式

```ts
// 初始连接是 fork 出去的异步过程：轮询 tools 直到目标工具出现
const waitTools = (mcp: Mcp.Interface, key: string) =>
  mcp.tools().pipe(
    Effect.filterOrElse(
      (listed) => key in listed,
      (listed) => Effect.fail(new Error(`tools: ${JSON.stringify(Object.keys(listed))}`)),
    ),
    Effect.retry(Schedule.spaced("100 millis").pipe(Schedule.both(Schedule.recurs(200)))),
  )
```

失败信息携带 `Object.keys` 快照——attempt 3 的 `Received: []` 届时可直接从断言错误读出。

备选：在 `connects` 用例内联一次性轮询 —— 被否：三处调用点，助手有独立名字（`waitTools` 对 `waitStatus`）且复用 Schedule 定义。

### D2. 三个用例改走门控，断言位置最小位移

- `connects`：`waitStatus connected` → `const listed = yield* waitTools(mcp, "fixture_echo")` → 原断言原样使用 `listed`；`instructions()` 紧随其后直读（已被门控覆盖）；
- `disconnect` / `reconnects`：`expect(Object.keys(yield* mcp.tools())).toContain("fixture_echo")` 一行替换为 `yield* waitTools(mcp, "fixture_echo")`；
- `disconnect` 中断言 `mcp.status()` 精确等于 `{ fixture: { status: "disabled" } }` 的行（`:133`）保持原位——disconnect 后 defs 立即清除，无时序窗口。

备选：全部改用「sleep 固定毫秒」 —— 被否：定时器式等待不可靠且不可证，正是本 flake 的对立面；有界轮询以可验证结果为准（与 `archive/2026-10-15-unit-flake-hardening` #8 ack 握手同手法）。

### D3. 上限沿用 recurs(200)，不单独调参

20s 上限与 `waitStatus` 一致：对「stdio 往返 + 目录负载」的最坏情况裕量充足，且远小于用例 60s 超时；真回归时错误在 20s 处抛出，保留足够诊断时间。不引入新的可调常量。

## Risks / Trade-offs

- [门控掩盖真实回归（如 tools/list 永不返回）] → 不会：上限 20s 后带键集合快照失败，信号比现状（空表断言）更明确；fixture server 坏掉时 `connects` 会先死在 `waitStatus`。
- [生产瞬态语义保留，运行时仍可能打 `missing cached tools` 警告] → 接受：该路径是生产代码既有防御（`:486-488`），UI 消费 `tools()` 为空时是渐进加载表现，非本提案治理范围。
- [并发 describe 下轮询放大 stdio 负载] → 可忽略：每 100ms 一次 `tools/list` 内存读，fixture 为本地进程。

## Migration Plan

- 无数据迁移；纯测试代码变更。回滚 = revert 对应提交。
- 部署顺序：单 commit 改 `test/mcp.test.ts`，按仓库流程归档、ff 合并 main、推送、观察 CI `test` workflow 连续绿。

## Open Questions

（无。若观察期内仍出现该家族签名，下一步方向是收敛生产瞬态语义——status 推迟到 defs 缓存后翻转——属新提案范围。）
