/**
 * 会话事件惰性计数（任务 1.2）：订阅 V2 事件流入指标桶。
 *
 * 挂在插件作用域（forkScoped），随插件 dispose 终止。recordMetrics 自身
 * best-effort，回调里不再包 try——桶写失败不会反向影响订阅流。
 */

import { Effect, Stream } from "effect"
import type { PluginContext } from "../../v2/effect/context.js"
import { recordMetrics } from "./metrics.js"
import { maybeAutoReport } from "./trigger.js"

// 反复修改信号的兴趣工具：这些工具的成功事件提示滚动窗可能累积（窗阈值在 trigger 内按桶计数）
const REVISION_TOOLS = new Set(["revise_chapter", "restore_chapter_version", "diff_chapter_version", "update_chapter"])

export function watchSessionEvents(ctx: PluginContext, directory: string) {
  // agent/model 不在 step 事件 payload 里：从切换事件维护会话级映射
  const agentBySession = new Map<string, string>()
  const modelBySession = new Map<string, string>()
  // tool.success/tool.failed 都不带工具名：从 tool.called 维护 callID 级映射归因
  const toolByCallID = new Map<string, string>()
  const meta = (sessionID: string) => ({
    sessionId: sessionID,
    agent: agentBySession.get(sessionID),
    model: modelBySession.get(sessionID),
  })

  return Effect.gen(function* () {
    yield* ctx.event.subscribe("session.next.agent.switched").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          agentBySession.set(event.properties.sessionID, event.properties.agent)
        }),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.model.switched").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          modelBySession.set(event.properties.sessionID, event.properties.model.id)
        }),
      ),
      Effect.forkScoped,
    )

    yield* ctx.event.subscribe("session.next.step.ended").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          const { tokens, sessionID } = event.properties
          const m = meta(sessionID)
          recordMetrics(directory, { domain: "c1-runtime", key: "step.tokens.input", delta: tokens.input, ...m })
          recordMetrics(directory, { domain: "c1-runtime", key: "step.tokens.output", delta: tokens.output, ...m })
          recordMetrics(directory, { domain: "c1-runtime", key: "step.tokens.reasoning", delta: tokens.reasoning, ...m })
          recordMetrics(directory, {
            domain: "c1-runtime",
            key: "step.tokens.cache.read",
            delta: tokens.cache.read,
            ...m,
          })
          recordMetrics(directory, {
            domain: "c1-runtime",
            key: "step.tokens.cache.write",
            delta: tokens.cache.write,
            ...m,
          })
        }),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.step.failed").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          recordMetrics(directory, {
            domain: "c1-runtime",
            key: "step.failed",
            delta: 1,
            ...meta(event.properties.sessionID),
          })
        }),
      ),
      Effect.forkScoped,
    )

    yield* ctx.event.subscribe("session.next.tool.called").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          toolByCallID.set(event.properties.callID, event.properties.tool)
        }),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.tool.success").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          recordMetrics(directory, {
            domain: "c1-runtime",
            key: `tool.success.${toolByCallID.get(event.properties.callID) ?? "unknown"}`,
            delta: 1,
            ...meta(event.properties.sessionID),
          })
          const tool = toolByCallID.get(event.properties.callID)
          if (tool && REVISION_TOOLS.has(tool)) maybeAutoReport(directory, "revision-window")
        }),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.tool.failed").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          recordMetrics(directory, {
            domain: "c1-runtime",
            key: `tool.failed.${toolByCallID.get(event.properties.callID) ?? "unknown"}`,
            delta: 1,
            ...meta(event.properties.sessionID),
          })
        }),
      ),
      Effect.forkScoped,
    )

    yield* ctx.event.subscribe("session.next.compaction.ended").pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          recordMetrics(directory, {
            domain: "c5-flow",
            key: `compaction.${event.properties.reason}`,
            delta: 1,
            ...meta(event.properties.sessionID),
          })
          maybeAutoReport(directory, "compaction")
        }),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.created").pipe(
      Stream.runForEach(() =>
        Effect.sync(() => {
          recordMetrics(directory, { domain: "c5-flow", key: "session.created", delta: 1 })
          maybeAutoReport(directory, "session-milestone")
        }),
      ),
      Effect.forkScoped,
    )
  })
}
