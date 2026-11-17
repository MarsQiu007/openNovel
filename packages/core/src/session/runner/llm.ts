import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@opennovel-ai/llm"
import { SessionWatermarkEvent } from "@opennovel-ai/schema/session-watermark-event"
import { Cause, DateTime, Effect, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { PluginBoot } from "../../plugin/boot"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SessionPurpose } from "../../plugin/session-purpose"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionTitle } from "../title"
import { SessionWatermark } from "../watermark"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opennovel-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const pluginBoot = yield* PluginBoot.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const title = yield* SessionTitle.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const watermarks = yield* SessionWatermark.Service
    const db = (yield* Database.Service).db
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })
    // 每个 provider turn 结束后刷新统一水位快照（非 durable，纯通知；快照随时可经 session.get 重取）
    const publishWatermark = Effect.fn("SessionRunner.publishWatermark")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return
      const watermark = yield* watermarks.get(session).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!watermark) return
      yield* events.publish(SessionWatermarkEvent.Refreshed, {
        sessionID,
        timestamp: yield* DateTime.now,
        watermark,
      })
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    // purpose 会话（工具改进归因等后台会话）屏蔽 Location 级 context source：归因请求的
    // system 段只含专用 agent 提示词与脱敏证据，不携带原书设定、灵魂段、注入快照或引用清单
    const loadSystemContext = (sessionID: SessionSchema.ID, agent: AgentV2.Selection) =>
      Effect.all(
        [
          SessionPurpose.lookup(sessionID) === undefined
            ? systemContext.load()
            : Effect.succeed(SystemContext.empty),
          skillGuidance.load(agent),
          referenceGuidance.load(),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.map(SystemContext.combine))

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      allowOverflowRecovery: boolean,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      // catalog 批（config-agent/config-skill 等 transform）在层构建期 fork 提交，
      // agent 名册与 skill 来源在 PluginBoot 放行后才可见；先于 select/系统上下文组装等待
      yield* pluginBoot.ready
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(sessionID, agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) {
          currentStep = 1
          // 首条用户输入已可见，但正文工作尚未开始；先命名，避免长任务或中断让标题一直停留在占位值
          yield* title.ensure(sessionID)
        }
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(sessionID, agent), session.id))
      // 安全边界：epoch 就绪后、组装 request 前执行排队操作（手动准入或此前阈值入队），
      // 后续 entries 即截断后的投影；continuation 的每个 provider turn 前都会走到这里
      yield* drainQueuedCompactions(session.id)
      const model = yield* models.resolve(session)
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(agent.info?.permissions)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        providerOptions: { openai: { promptCacheKey } },
        system: [agent.info?.system, system.baseline]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      // 阈值命中且压缩计划可行才走统一排队路径（与手动压缩同一份历史）：
      // plan 不可行（空会话/无可压 head/摘要 prompt 超窗）时入队只会产出注定失败的操作，直接跳过
      if (compaction.shouldAutoCompact({ sessionID: session.id, messageID: SessionMessage.ID.create(), entries, model, request })) {
        if ((yield* SessionHistory.activeCompaction(db, session.id)) === undefined)
          yield* events.publish(SessionEvent.Compaction.Queued, {
            sessionID: session.id,
            messageID: SessionMessage.ID.create(),
            timestamp: yield* DateTime.now,
            reason: "auto",
          })
        const outcome = yield* drainQueuedCompactions(session.id)
        // 压缩成功：丢弃旧 request，die 后从压缩投影重建并继续原始 input
        if (outcome === "completed") return yield* Effect.die(continueAfterCompaction(currentStep))
        // 失败或无 queued 可执行：本轮不再发送已判定超界的原始请求；原始 durable input 保持可追溯，
        // 留待新的活动或显式唤醒按当时水位重试——每次唤醒只有一次有界操作，失败后无自动死循环
        return { needsContinuation: false, step: currentStep }
      }
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        snapshot: startSnapshot,
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      const providerStream = llm.stream(request).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            yield* Effect.uninterruptibleMask((restore) =>
              restore(
                toolMaterialization.settle({
                  sessionID: session.id,
                  agent: agent.id,
                  assistantMessageID,
                  call: event,
                }),
              ).pipe(
                Effect.flatMap((settlement) =>
                  publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: settlement.result,
                      output: settlement.output,
                    }),
                    settlement.outputPaths ?? [],
                  ),
                ),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          // 溢出恢复统一进排队路径（与阈值触发共用 durable 操作与 drain）：
          // 摘要完成后再继续原始 turn；runAfterOverflowCompaction 保证原始 turn 只有一次恢复。
          // restore：恢复块必须可中断，否则运行中停止会卡在摘要流上无法结算 interrupted
          if (
            allowOverflowRecovery &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            compaction.overflowRecoveryEnabled
          ) {
            const recovered = yield* restore(
              Effect.gen(function* () {
                if ((yield* SessionHistory.activeCompaction(db, session.id)) === undefined)
                  yield* events.publish(SessionEvent.Compaction.Queued, {
                    sessionID: session.id,
                    messageID: SessionMessage.ID.create(),
                    timestamp: yield* DateTime.now,
                    reason: "auto",
                  })
                return yield* drainQueuedCompactions(session.id)
              }),
            )
            if (recovered === "completed") return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          }
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !publisher.hasProviderError()) {
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
              }),
            )
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          return { needsContinuation: !publisher.hasProviderError() && needsContinuation, step: currentStep }
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
    ) => Effect.Effect<{ readonly needsContinuation: boolean; readonly step: number }, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      // 原始 turn 只有一次溢出恢复：恢复后的 provider 尝试再溢出时按原始失败结算，不再排队压缩
      return yield* runTurnAttempt(sessionID, promotion, step, false).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step, true).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
            return yield* runTurn(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    // 逐个执行投影中 queued 的压缩操作：Queued 事件 durable 落库是事实来源，循环重读直至
    // 无 queued，保证 admission 与 drain 退出窗口之间新入队的操作不被遗漏。
    // 返回最后一次闭环结果（completed/failed），调用方据此决定是否重建请求继续原始 input
    const drainQueuedCompactions = Effect.fn("SessionRunner.drainQueuedCompactions")(function* (
      sessionID: SessionSchema.ID,
    ) {
      let outcome: "completed" | "failed" | undefined
      while (true) {
        const queued = yield* SessionHistory.oldestQueuedCompaction(db, sessionID)
        if (queued === undefined) return outcome
        outcome = yield* runQueuedCompaction(sessionID, queued)
      }
    })

    // 排队压缩操作的执行体：与 runTurnAttempt 共用 epoch/模型/历史装载路径；request 仅用于
    // 输出 token 预算估计，无在飞的 provider 请求，给最小形状。任何失败都以脱敏 Failed 结算，
    // 绝不把操作留在 queued/running 悬挂态
    const runQueuedCompaction = Effect.fn("SessionRunner.runQueuedCompaction")(function* (
      sessionID: SessionSchema.ID,
      op: SessionMessage.Compaction,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      // 与 runTurnAttempt 同款：插件填充状态（agent 名册/skill 来源）在引导门放行后才可见
      yield* pluginBoot.ready
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(sessionID, agent), session.id)
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(sessionID, agent), session.id))
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const model = yield* models.resolve(session)
      const request = LLM.request({ model, messages: [], tools: [] })
      const outcome = yield* compaction.compactAfterOverflow(
        { sessionID: session.id, messageID: op.id, entries, model, request },
        op.reason,
      ).pipe(
        // 运行中停止沿用 interrupt 所有权链：仅在操作已进入 running 且未闭环时由 finalizer 结算
        // interrupted；queued 阶段被中断的操作仍保持 queued，交由后续 drain 或进程恢复结算
        Effect.onInterrupt(() =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              const current = yield* SessionHistory.message(db, sessionID, op.id)
              if (current?.type === "compaction" && current.status === "running")
                yield* events.publish(SessionEvent.Compaction.Interrupted, {
                  sessionID: session.id,
                  messageID: op.id,
                  timestamp: yield* DateTime.now,
                  cause: "user",
                })
            }),
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("queued compaction execution failed", { cause })
            yield* events.publish(SessionEvent.Compaction.Failed, {
              sessionID: session.id,
              messageID: op.id,
              timestamp: yield* DateTime.now,
              reason: op.reason,
              error: { type: "compaction.failed", message: "压缩执行失败，请稍后重试" },
            })
            return { status: "failed" as const, messageID: op.id }
          }),
        ),
      )
      // 执行期退化（窗口配置变更等）同样要闭环操作：转为 failed 终态，不假装成功
      if (outcome.status === "skipped")
        yield* events.publish(SessionEvent.Compaction.Failed, {
          sessionID: session.id,
          messageID: op.id,
          timestamp: yield* DateTime.now,
          reason: op.reason,
          error: { type: "compaction.failed", message: "没有可压缩的对话内容" },
        })
      yield* publishWatermark(session.id)
      return outcome.status === "skipped" ? ("failed" as const) : outcome.status
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      // 排队压缩是 durable 事实：无 prompt 工作时，wake 仅凭 queued 操作也应启动 drain
      if (!input.force && !hasSteer && !hasQueue) {
        const queued = yield* SessionHistory.oldestQueuedCompaction(db, input.sessionID)
        if (queued === undefined) return
      }
      yield* failInterruptedTools(input.sessionID)
      yield* drainQueuedCompactions(input.sessionID)
      let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        while (needsContinuation) {
          const result = yield* runTurn(input.sessionID, promotion, step)
          yield* publishWatermark(input.sessionID)
          needsContinuation = result.needsContinuation
          step = result.step + 1
          promotion = "steer"
          if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        }
        shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
        promotion = shouldRun ? "queue" : undefined
      }
    })

    return Service.of({
      run,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    SessionTitle.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    Database.node,
    PluginBoot.node,
    SessionWatermark.node,
  ],
})
