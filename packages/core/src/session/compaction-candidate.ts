export * as SessionCompactionCandidate from "./compaction-candidate"

import { Context, DateTime, Deferred, Duration, Effect, Fiber, Layer, Option, Ref } from "effect"
import type * as Scope from "effect/Scope"
import { LLMClient } from "@opennovel-ai/llm"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { SessionCompaction } from "./compaction"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionWatermark } from "./watermark"

/** 候选缓存有效期：超过后即使快照匹配也不再应用，回退前台同步摘要 */
export const CANDIDATE_TTL = Duration.minutes(5)
/** 阈值到达时等待在飞候选收尾的最长时限，超时即丢弃回退前台 */
export const CANDIDATE_WAIT = "30 seconds"
/** 同一周期后台连续失败熔断阈值：达到后停止新的后台尝试，阈值时仍保留一次有界前台机会 */
export const MAX_FAILURES = 2

type EngineInput = Parameters<typeof SessionCompaction.engine>[0]

export interface Candidate {
  readonly text: string
  readonly usage: typeof SessionEvent.Compaction.Usage.Type | undefined
  /** 以下为启动时的快照校验项（design 决策 6）：任一失配即丢弃回退前台 */
  readonly firstMessageID: SessionMessage.ID | undefined
  readonly keepStartID: SessionMessage.ID | undefined
  readonly fingerprint: string
  readonly tailTokens: number
  readonly tailLimit: number
  readonly createdAt: DateTime.DateTime
}

export type StartInput = Omit<Parameters<ReturnType<typeof SessionCompaction.engine>["plan"]>[0], "messageID"> & {
  readonly agent: string
  readonly modelRef: Parameters<typeof SessionWatermark.findAnchor>[1]
}

export interface TakeInput {
  readonly sessionID: SessionSchema.ID
  readonly firstMessageID: SessionMessage.ID | undefined
  readonly keepStartID: SessionMessage.ID | undefined
  readonly fingerprint: string
  readonly tailTokens: number
  readonly tailLimit: number
}

type Slot =
  | {
      readonly tag: "running"
      readonly fiber: Fiber.Fiber<void>
      readonly ready: Deferred.Deferred<Candidate | undefined>
    }
  | { readonly tag: "ready"; readonly candidate: Candidate }

interface Record {
  /** 启动占位：fork 前同步置位，防止同 Session 并发 start 建出第二个候选 */
  readonly pending: boolean
  readonly slot: Slot | undefined
  readonly failures: number
  /** 未使用候选（丢弃/过期/失配）累计的摘要 token：丢弃即计入成本，但不伪造 completed */
  readonly discarded: number
}

const EMPTY: Record = { pending: false, slot: undefined, failures: 0, discarded: 0 }

const usageTokens = (usage: typeof SessionEvent.Compaction.Usage.Type | undefined) =>
  usage === undefined ? 0 : usage.input + usage.output + usage.reasoning + usage.cache.read + usage.cache.write

export interface Interface {
  /** 接近阈值时为该 Session 启动单候选后台 fiber；开关关闭/未达启动线/无实测锚点/已有活跃候选/已熔断时为 no-op */
  readonly start: (input: StartInput) => Effect.Effect<void>
  /** 阈值到达时校验快照并取走在飞/就绪候选；失配、过期或等待超时则丢弃（计入 usage）并返回 undefined，调用方回退前台 */
  readonly take: (input: TakeInput) => Effect.Effect<Candidate | undefined>
  /** 压缩闭环（前台或候选应用）后调用：清掉相对新历史已 stale 的候选并重置后台失败计数，开启新周期 */
  readonly cycle: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** 未使用候选累计的摘要 token（input+output+reasoning+cache 全计） */
  readonly discarded: (sessionID: SessionSchema.ID) => Effect.Effect<number>
  /** 是否有在途或就绪的后台候选（水位「正在准备摘要」信号；就绪未应用也算，应用/丢弃/过期即消失） */
  readonly active: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SessionCompactionCandidate") {}

export const make = (dependencies: {
  readonly llm: EngineInput["llm"]
  readonly config: EngineInput["config"]
  readonly scope: Scope.Scope
}) => {
  const engine = SessionCompaction.engine(dependencies)
  const settings = SessionCompaction.settings(dependencies.config)
  const registry = Ref.makeUnsafe(new Map<SessionSchema.ID, Record>())

  /** 清空候选槽位；在飞 fiber 随后中断（先清槽再中断，fiber 收尾识别到槽位已易主即不再写状态） */
  const clear = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      const slot = (yield* Ref.get(registry)).get(sessionID)?.slot
      yield* Ref.update(registry, (all) => {
        const current = all.get(sessionID)
        if (current === undefined || (current.slot === undefined && !current.pending)) return all
        return new Map(all).set(sessionID, { ...current, pending: false, slot: undefined })
      })
      if (slot?.tag === "running") yield* Fiber.interrupt(slot.fiber)
    })

  const start = Effect.fn("SessionCompactionCandidate.start")(function* (input: StartInput) {
    if (!settings.auto || !settings.background) return
    const plan = engine.plan({ ...input, messageID: SessionMessage.ID.create() })
    // 注定失败（空会话/无可压 head/摘要 prompt 超窗）、已达阈值（前台立即接管）或距阈值尚远时不预热
    if (plan === undefined) return
    if (plan.total >= plan.trigger) return
    if (plan.total < SessionCompaction.backgroundStartLine(plan.trigger)) return
    // 无同模型实测锚点说明水位仍靠保守估算，此时预热容易白做；
    // fork 没有 prompt cache TTL 元数据，以「存在近期同模型实测锚点」近似上游的 cache 余量条件
    if (SessionWatermark.findAnchor(input.entries, input.modelRef, input.agent) === undefined) return
    const launchEffect = Effect.gen(function* () {
      const ready = yield* Deferred.make<Candidate | undefined>()
      // fiber 可能先于槽位注册完成（eager 调度）：pending 占位且无槽位也视为己有，
      // 保证失败计数/就绪状态必然落地；槽位已易主（take/clear/cycle）则不再写
      const settle = (candidate: Candidate | undefined) =>
        Ref.update(registry, (all) => {
          const current = all.get(input.sessionID) ?? EMPTY
          const mine =
            (current.pending && current.slot === undefined) ||
            (current.slot?.tag === "running" && current.slot.ready === ready)
          if (!mine) return all
          return new Map(all).set(input.sessionID, {
            ...current,
            pending: false,
            slot: candidate === undefined ? undefined : { tag: "ready" as const, candidate },
            failures: candidate === undefined ? current.failures + 1 : current.failures,
          })
        })
      const fiber = yield* Effect.forkIn(dependencies.scope, { startImmediately: true })(
        Effect.gen(function* () {
          const result = yield* engine.summarize({ ...input, messageID: SessionMessage.ID.create() })
          const candidate: Candidate | undefined =
            result === undefined || result.tag === "failed"
              ? undefined
              : {
                  text: result.text,
                  usage: result.usage,
                  firstMessageID: plan.firstMessageID,
                  keepStartID: plan.keepStartID,
                  fingerprint: plan.fingerprint,
                  tailTokens: plan.tailTokens,
                  tailLimit: plan.tailLimit,
                  createdAt: yield* DateTime.now,
                }
          yield* settle(candidate)
          yield* Deferred.succeed(ready, candidate)
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logWarning("background compaction candidate failed", {
                sessionID: input.sessionID,
                cause,
              })
              yield* settle(undefined)
              yield* Deferred.succeed(ready, undefined)
            }),
          ),
        ),
      )
      // fiber 已完成并自行 settle 时占位已解除，不再注册槽位；否则登记 running 供 take 等待/中断
      yield* Ref.update(registry, (all) => {
        const current = all.get(input.sessionID) ?? EMPTY
        if (!current.pending || current.slot !== undefined) return all
        return new Map(all).set(input.sessionID, {
          ...current,
          pending: false,
          slot: { tag: "running" as const, fiber, ready },
        })
      })
    })
    const launch = yield* Ref.modify(registry, (all) => {
      const current = all.get(input.sessionID) ?? EMPTY
      // 每 Session 单候选：已有活跃候选、启动中或本周期已熔断时不再启动
      if (current.pending || current.slot !== undefined || current.failures >= MAX_FAILURES)
        return [Effect.void, all]
      return [launchEffect, new Map(all).set(input.sessionID, { ...current, pending: true })]
    })
    yield* launch
  })

  const take = Effect.fn("SessionCompactionCandidate.take")(function* (input: TakeInput) {
    const slot = (yield* Ref.get(registry)).get(input.sessionID)?.slot
    if (slot === undefined) return undefined
    let candidate: Candidate | undefined
    if (slot.tag === "ready") {
      candidate = slot.candidate
    } else {
      const waited = yield* Deferred.await(slot.ready).pipe(Effect.timeoutOption(CANDIDATE_WAIT))
      if (Option.isNone(waited) || waited.value === undefined) {
        // 等待超时或 fiber 侧已判定失败（失败计数已落）：丢弃回退前台；
        // 超时仍在飞的调用没有实测 usage 可计
        yield* clear(input.sessionID)
        return undefined
      }
      candidate = waited.value
    }
    // fiber 侧已判定失败（失败计数已落）：槽位已清，直接回退前台
    if (candidate === undefined) return undefined
    const now = yield* DateTime.now
    const fresh = !Duration.isGreaterThan(DateTime.distance(candidate.createdAt, now), CANDIDATE_TTL)
    // 快照校验：自快照以来会话必须零变更（首条/保留起点同 ID、指纹同、尾部未超预算）才可无损应用
    const matched =
      fresh &&
      candidate.firstMessageID === input.firstMessageID &&
      candidate.keepStartID === input.keepStartID &&
      candidate.fingerprint === input.fingerprint &&
      input.tailTokens <= candidate.tailLimit
    yield* clear(input.sessionID)
    if (matched) return candidate
    // 失效/过期候选：usage 计入丢弃成本，但不伪造 completed（design 决策 6）
    yield* Ref.update(registry, (all) => {
      const current = all.get(input.sessionID) ?? EMPTY
      return new Map(all).set(input.sessionID, {
        ...current,
        discarded: current.discarded + usageTokens(candidate.usage),
      })
    })
    return undefined
  })

  const cycle = Effect.fn("SessionCompactionCandidate.cycle")(function* (sessionID: SessionSchema.ID) {
    yield* clear(sessionID)
    yield* Ref.update(registry, (all) => {
      const current = all.get(sessionID) ?? EMPTY
      return new Map(all).set(sessionID, { ...current, pending: false, failures: 0 })
    })
  })

  const discarded = (sessionID: SessionSchema.ID) =>
    Effect.map(Ref.get(registry), (all) => all.get(sessionID)?.discarded ?? 0)

  const active = (sessionID: SessionSchema.ID) =>
    Effect.map(Ref.get(registry), (all) => {
      const record = all.get(sessionID)
      return record !== undefined && (record.pending || record.slot !== undefined)
    })

  return { start, take, cycle, discarded, active }
}

export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      // 候选与 fiber 由本 location cell 所有：cell 重建（进程内 location 切换/练习器重开）时随 scope 消失
      const scope = yield* Effect.scope
      const llm = yield* LLMClient.Service
      const config = yield* Config.Service
      const entries = yield* config.entries()
      return Service.of(make({ llm, config: entries, scope }))
    }),
  ),
  deps: [Config.node, llmClient],
})
