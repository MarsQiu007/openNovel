import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Effect, Exit, Queue, Scope, Stream } from "effect"
import { getMetricsDir, readMetrics, type MetricsEntry } from "../../src/novel-writer/evaluate/metrics"
import { watchSessionEvents } from "../../src/novel-writer/evaluate/events"
import type { PluginContext } from "../../src/v2/effect/context"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "evaluate-events-"))
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) }
}

type Evt = { id: string; type: string; properties: Record<string, unknown> }

/**
 * 可控事件源：subscribe 为每种事件类型建一个无界队列，测试按生产时序逐个推送。
 * 比 Stream.make 静态序列更接近真实订阅，也让跨类型时序由推送顺序决定。
 */
function fakeCtx() {
  const queues = new Map<string, Queue.Queue<Evt>>()
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 只实现事件域的部分上下文替身，字段集故意不完整
  const ctx = {
    event: {
      subscribe: (type: string) => {
        const q = Effect.runSync(Queue.unbounded<Evt>())
        queues.set(type, q)
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 测试替身无法实现泛型 Type→EventMap[Type] 映射，同 host.ts 宿主适配的既有断言
        return Stream.fromQueue(q) as never
      },
    },
  } as PluginContext
  return {
    ctx,
    push: (type: string, properties: Record<string, unknown>, envelope?: Record<string, unknown>) => {
      const q = queues.get(type)
      if (!q) throw new Error(`fakeCtx: subscribe("${type}") 未被 watcher 调用`)
      // envelope 模拟宿主信封的顶层附加字段（如 purpose），不进入 properties
      Queue.offerUnsafe(q, { id: `evt_${type}`, type, properties, ...envelope })
    },
  }
}

/** watcher 以 forkScoped 挂外部 scope：测试显式持有，断言完再关（dispose 订阅 fiber） */
async function startWatcher(ctx: PluginContext, dir: string) {
  const scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Effect.provideService(watchSessionEvents(ctx, dir), Scope.Scope, scope))
  return scope
}

/** fork 出去的订阅 fiber 与断言存在时序竞争：轮询等条目落桶（2s 上限） */
async function waitEntries(dir: string, predicate: (entries: MetricsEntry[]) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { entries } = readMetrics(dir)
    if (predicate(entries)) return entries
    await Bun.sleep(20)
  }
  return readMetrics(dir).entries
}

describe("evaluate events watcher", () => {
  test("step/tool/compaction/created 事件入桶且带 agent+model 映射", async () => {
    using f = fixture()
    const { ctx, push } = fakeCtx()
    const scope = await startWatcher(ctx, f.dir)

    // 先推映射事件，再用 step.failed 作哨兵：等它带 agent/model 落桶，
    // 证明两个映射表已就绪，之后推送的事件的 meta 归因才是确定的
    push("session.next.agent.switched", { sessionID: "s1", agent: "writer" })
    push("session.next.model.switched", { sessionID: "s1", model: { id: "test/model", providerID: "test" } })
    push("session.next.step.failed", { sessionID: "s1" })
    await waitEntries(f.dir, (entries) => entries.some((e) => e.key === "step.failed" && e.agent === "writer"))

    push("session.next.step.ended", {
      sessionID: "s1",
      tokens: { input: 100, output: 50, reasoning: 20, cache: { read: 10, write: 5 } },
    })
    push("session.next.tool.called", { sessionID: "s1", callID: "call-1", tool: "novel_write" })
    // tool.success/tool.failed 的 SDK payload 不带工具名，归因走 callID 映射
    push("session.next.tool.success", { sessionID: "s1", callID: "call-1" })
    push("session.next.tool.failed", { sessionID: "s1", callID: "call-1" })
    push("session.next.compaction.ended", { sessionID: "s1", reason: "auto" })
    push("session.next.created", {})

    const entries = await waitEntries(f.dir, (list) => list.length >= 10)
    const byKey = new Map(entries.map((e) => [e.key, e]))
    expect(byKey.get("step.tokens.input")?.delta).toBe(100)
    expect(byKey.get("step.tokens.output")?.delta).toBe(50)
    expect(byKey.get("step.tokens.reasoning")?.delta).toBe(20)
    expect(byKey.get("step.tokens.cache.read")?.delta).toBe(10)
    expect(byKey.get("step.tokens.cache.write")?.delta).toBe(5)
    expect(byKey.get("step.failed")?.delta).toBe(1)
    expect(byKey.get("tool.success.novel_write")?.delta).toBe(1)
    expect(byKey.get("tool.failed.novel_write")?.delta).toBe(1)
    expect(byKey.get("compaction.auto")?.delta).toBe(1)
    expect(byKey.get("session.created")?.delta).toBe(1)
    expect(byKey.get("step.tokens.input")).toMatchObject({ agent: "writer", model: "test/model", sessionId: "s1" })

    await Effect.runPromise(Scope.close(scope, Exit.void))
  })

  test("tool.failed 无对应 tool.called 时归为 unknown", async () => {
    using f = fixture()
    const { ctx, push } = fakeCtx()
    const scope = await startWatcher(ctx, f.dir)

    push("session.next.tool.failed", { sessionID: "s1", callID: "orphan" })
    const entries = await waitEntries(f.dir, (list) => list.some((e) => e.key.startsWith("tool.failed.")))
    expect(entries.some((e) => e.key === "tool.failed.unknown" && e.delta === 1)).toBe(true)

    await Effect.runPromise(Scope.close(scope, Exit.void))
  })

  test("内部会话事件带 purpose 信封不污染任何桶（任务 2.2）", async () => {
    using f = fixture()
    const { ctx, push } = fakeCtx()
    const scope = await startWatcher(ctx, f.dir)

    // 内部会话的全部事件形状（含早发/晚消费的尾部事件，信封同样带 purpose）
    const internal = "ses_internal_tool_insight"
    push("session.next.agent.switched", { sessionID: internal, agent: "writer" }, { purpose: "tool-insight" })
    push(
      "session.next.model.switched",
      { sessionID: internal, model: { id: "test/model", providerID: "test" } },
      { purpose: "tool-insight" },
    )
    push(
      "session.next.step.ended",
      {
        sessionID: internal,
        tokens: { input: 999, output: 999, reasoning: 999, cache: { read: 999, write: 999 } },
      },
      { purpose: "tool-insight" },
    )
    push("session.next.step.failed", { sessionID: internal }, { purpose: "tool-insight" })
    push(
      "session.next.tool.called",
      { sessionID: internal, callID: "call-i", tool: "novel_write" },
      { purpose: "tool-insight" },
    )
    push("session.next.tool.success", { sessionID: internal, callID: "call-i" }, { purpose: "tool-insight" })
    push("session.next.tool.failed", { sessionID: internal, callID: "call-i" }, { purpose: "tool-insight" })
    push("session.next.compaction.ended", { sessionID: internal, reason: "auto" }, { purpose: "tool-insight" })
    push("session.next.created", {}, { purpose: "tool-insight" })

    // 普通会话哨兵：等它落桶，证明内部事件已被处理过且未产生任何条目
    push("session.next.step.failed", { sessionID: "s1" })
    const entries = await waitEntries(f.dir, (list) => list.some((e) => e.key === "step.failed" && e.sessionId === "s1"))
    expect(entries.some((e) => e.sessionId === internal)).toBe(false)
    expect(entries.some((e) => e.key === "session.created")).toBe(false)
    expect(entries.some((e) => e.key.startsWith("tool.") || e.key.startsWith("compaction."))).toBe(false)
    // agent/model 映射也不被内部会话污染：普通会话查询不到内部会话的映射值
    expect(entries.every((e) => e.agent !== "writer" || e.sessionId === "s1")).toBe(true)

    await Effect.runPromise(Scope.close(scope, Exit.void))
  })

  test("会话里程碑信号：+10 个 Created 事件后台生成自动报告（不弹窗）", async () => {
    using f = fixture()
    const { ctx, push } = fakeCtx()
    const scope = await startWatcher(ctx, f.dir)

    for (let i = 0; i < 10; i++) push("session.next.created", {})
    for (let attempt = 0; attempt < 100; attempt++) {
      // 事件处理是异步的：首拍 .novel/evaluate 可能尚未创建（ENOENT 视为尚无报告）
      let files: string[] = []
      try {
        files = readdirSync(getMetricsDir(f.dir)).filter((x) => x.endsWith(".md"))
      } catch {
        files = []
      }
      if (files.length > 0) {
        expect(files[0].endsWith("-since-last.md")).toBe(true)
        await Effect.runPromise(Scope.close(scope, Exit.void))
        return
      }
      await Bun.sleep(20)
    }
    throw new Error("等待自动报告超时")
  })
})
