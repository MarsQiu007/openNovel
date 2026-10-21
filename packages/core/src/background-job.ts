export * as BackgroundJob from "./background-job"

import { Array, Cause, Clock, Context, Deferred, Effect, Exit, Layer, Schema, Scope, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"
import { makeGlobalNode } from "./effect/app-node"
import { KV } from "./kv"
import { SessionMessage } from "./session/message"
import { SessionSchema } from "./session/schema"

export type Status = "running" | "completed" | "error" | "cancelled"

// KV 持久化记录：显式可恢复的后台作业（本期仅 subagent，shell 随 bash durable status 另立）
const Background = Schema.Struct({
  id: Schema.String,
  notificationID: SessionMessage.ID,
  recovery: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("shell"),
      sessionID: SessionSchema.ID,
      shellID: Schema.String,
      command: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("subagent"),
      parentSessionID: SessionSchema.ID,
      childSessionID: SessionSchema.ID,
      agent: Schema.String,
      description: Schema.String,
    }),
  ]),
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  output: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  // 恢复预算：每次 boot sweep 对 running 子代理 +1，超过上限终态化（design §5）
  attempts: Schema.optionalKey(Schema.Int),
})

export type Background = typeof Background.Type
export type Recovery = Background["recovery"]

const decodeBackground = Schema.decodeUnknownResult(Background)
const backgroundPrefix = "job.background/"
const COMPLETED_LIMIT = 25

/** KV 键：后台作业记录。崩溃恢复（session/execution/restart.ts）以同键改写预算与终态。 */
export const backgroundKey = (notificationID: SessionMessage.ID) => `${backgroundPrefix}${notificationID}`

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
  notificationID?: SessionMessage.ID
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  backgrounded: Deferred.Deferred<Info>
  scope: Scope.Closeable
  token: object
  pending: number
  next: number
  output?: { sequence: number; text: string }
  tail: Deferred.Deferred<void>
  promoted: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
  blockingSessions: Map<SessionSchema.ID, number>
  isBackgrounded: boolean
  consumed: boolean
  recovery?: Recovery
  attempts?: number
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
  promoted?: Deferred.Deferred<Info>
  generation?: Scope.Closeable
}

type BackgroundResult = {
  info?: Info
  backgrounded?: Deferred.Deferred<Info>
}

type PromoteResult = {
  info?: Info
  promoted?: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
}

type StartResult = { info: Info } | { info: Info; scope: Scope.Closeable; token: object }

type ExtendResult =
  | { extended: false }
  | {
      extended: true
      previous: Deferred.Deferred<void>
      scope: Scope.Closeable
      tail: Deferred.Deferred<void>
      token: object
      sequence: number
    }

type BlockWait = {
  done: Deferred.Deferred<Info>
  backgrounded: Deferred.Deferred<Info>
  generation: Scope.Closeable
}

type BlockStart =
  | { type: "missing" }
  | { type: "finished"; info: Info; generation: Scope.Closeable }
  | { type: "backgrounded"; info: Info }
  | { type: "wait"; wait: BlockWait }

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  recovery?: Recovery
  notificationID?: SessionMessage.ID
  attempts?: number
  onPromote?: Effect.Effect<void>
  run: Effect.Effect<string, unknown>
}

export type ExtendInput = {
  id: string
  run: Effect.Effect<string, unknown>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export type BlockInput = {
  id: string
  sessionID: SessionSchema.ID
}

export type BlockResult = { type: "finished"; info: Info } | { type: "backgrounded"; info: Info }

export type BackgroundAllInput = {
  sessionID: SessionSchema.ID
  type?: string
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly waitForPromotion: (id: string) => Effect.Effect<Info>
  readonly promote: (id: string) => Effect.Effect<Info | undefined>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
  readonly block: (input: BlockInput) => Effect.Effect<BlockResult | undefined>
  readonly background: (id: string) => Effect.Effect<Info | undefined>
  readonly backgroundAll: (input: BackgroundAllInput) => Effect.Effect<Info[]>
  readonly pendingBackground: Effect.Effect<readonly Background[]>
  readonly runningBackground: Effect.Effect<readonly Recovery[]>
  readonly completeBackground: (notificationID: SessionMessage.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/BackgroundJob") {}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

// 链式渲染 Cause.prettyErrors，保留「Caused by」细节链而不是只取根因 message
function errorText(cause: Cause.Cause<unknown>) {
  const render = (error: Error): string => {
    const message = error.message || error.name || "Unknown error"
    if (!(error.cause instanceof Error)) return message
    const detail = render(error.cause)
    return detail === message || detail.startsWith(`${message}\n`) ? detail : `${message}\nCaused by: ${detail}`
  }
  return Cause.prettyErrors(cause).map(render).join("\n") || "Unknown error"
}

function incrementSession(input: Map<SessionSchema.ID, number>, sessionID: SessionSchema.ID) {
  return new Map(input).set(sessionID, (input.get(sessionID) ?? 0) + 1)
}

function decrementSession(input: Map<SessionSchema.ID, number>, sessionID: SessionSchema.ID) {
  const count = input.get(sessionID)
  if (count === undefined) return input
  const next = new Map(input)
  if (count <= 1) next.delete(sessionID)
  else next.set(sessionID, count - 1)
  return next
}

/**
 * 创建一个 Scoped、进程本地的作业注册表。显式可恢复的后台作业同时持有一条持久
 * 通知标记（KV），直到其通知被 admit。未消费的结果跨越 start-to-wait 交接存活；
 * 前台 block/cancel 与不可恢复的 wait 结果进入最近 25 条的消费历史。可恢复的
 * wait 结果保持可用，以供后续 background 注册与确认。非可恢复作业的状态仍不持久。
 */
export const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    scope: yield* Scope.Scope,
  }

  // 消费历史上限按首次消费顺序裁剪，而不是 start 时间或读取次数；带 notificationID
  // 的作业不受裁剪（由 completeBackground 清账）
  const consume = (id: string, generation: Scope.Closeable) =>
    SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(id)
      if (!job || job.scope !== generation || job.info.status === "running" || job.consumed) return jobs
      const next = new Map(jobs)
      next.delete(id)
      next.set(id, { ...job, consumed: true })
      const completed = [...next].filter(([, job]) => job.consumed && !job.info.notificationID)
      for (const [id] of completed.slice(0, -COMPLETED_LIMIT)) next.delete(id)
      return next
    })

  const persistBackground = Effect.fnUntraced(function* (job: Active) {
    if (!job.recovery || !job.info.notificationID) return
    yield* kv.set(`${backgroundPrefix}${job.info.notificationID}`, {
      id: job.info.id,
      notificationID: job.info.notificationID,
      recovery: job.recovery,
      status: job.info.status,
      ...(job.info.output !== undefined ? { output: job.info.output } : {}),
      ...(job.info.error !== undefined ? { error: job.info.error } : {}),
      ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
    })
  })

  const settle = Effect.fn("BackgroundJob.settle")(function* (
    id: string,
    token: object,
    sequence: number,
    exit: Exit.Exit<string, unknown>,
  ) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [FinishResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (job.token !== token) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
        const pending = job.pending - 1
        const output =
          Exit.isSuccess(exit) && (!job.output || sequence > job.output.sequence)
            ? { sequence, text: exit.value }
            : job.output
        if (Exit.isSuccess(exit) && pending > 0) {
          return [{}, new Map(jobs).set(id, { ...job, pending, output })]
        }
        const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
          ? "completed"
          : Cause.hasInterruptsOnly(exit.cause)
            ? "cancelled"
            : "error"
        const next = {
          ...job,
          onPromote: undefined,
          pending: 0,
          output,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...job.info,
            status,
            completed_at,
            ...(output ? { output: output.text } : {}),
            ...(Exit.isFailure(exit) ? { error: errorText(exit.cause) } : {}),
          },
        }
        if (status !== "cancelled") yield* persistBackground(next)
        return [
          { info: snapshot(next), done: job.done, scope: job.scope, promoted: job.promoted },
          new Map(jobs).set(id, next),
        ]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.info && result.promoted) yield* Deferred.succeed(result.promoted, result.info).pipe(Effect.ignore)
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    return result.info
  })

  const fork = Effect.fn("BackgroundJob.fork")(function* (
    scope: Scope.Scope,
    id: string,
    token: object,
    sequence: number,
    run: Effect.Effect<string, unknown>,
  ) {
    return yield* run.pipe(
      Effect.matchCauseEffect({
        onSuccess: (output) => settle(id, token, sequence, Exit.succeed(output)),
        onFailure: (cause) => settle(id, token, sequence, Exit.failCause(cause)),
      }),
      Effect.asVoid,
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })

  const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
    return Array.fromIterable((yield* SynchronizedRef.get(state.jobs)).values())
      .map(snapshot)
      .toSorted((a, b) => a.started_at - b.started_at)
  })

  const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return
    return snapshot(job)
  })

  const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = input.id ?? Identifier.ascending("job")
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info>()
        const promoted = yield* Deferred.make<Info>()
        const backgrounded = yield* Deferred.make<Info>()
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [StartResult, Map<string, Active>]> {
            const existing = jobs.get(id)
            if (existing?.info.status === "running") {
              return [{ info: snapshot(existing) }, jobs] as readonly [StartResult, Map<string, Active>]
            }
            const scope = yield* Scope.fork(state.scope, "parallel")
            const token = {}
            const job = {
              info: {
                id,
                type: input.type,
                title: input.title,
                status: "running" as const,
                started_at,
                metadata: input.metadata,
                ...(input.notificationID ? { notificationID: input.notificationID } : {}),
              },
              done,
              backgrounded,
              scope,
              token,
              pending: 1,
              next: 1,
              tail,
              promoted,
              onPromote: input.onPromote,
              blockingSessions: new Map<SessionSchema.ID, number>(),
              isBackgrounded: false,
              consumed: false,
              recovery: input.recovery,
              ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
            }
            return [{ info: snapshot(job), scope, token }, new Map(jobs).set(id, job)] as readonly [
              StartResult,
              Map<string, Active>,
            ]
          }),
        )
        if ("scope" in result)
          yield* fork(
            result.scope,
            id,
            result.token,
            0,
            restore(input.run).pipe(Effect.ensuring(Deferred.succeed(tail, undefined))),
          )
        return result.info
      }),
    )
  })

  const extend: Interface["extend"] = Effect.fn("BackgroundJob.extend")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modify(
          state.jobs,
          (jobs): readonly [ExtendResult, Map<string, Active>] => {
            const job = jobs.get(input.id)
            if (!job || job.info.status !== "running") return [{ extended: false }, jobs]
            return [
              { extended: true, previous: job.tail, scope: job.scope, tail, token: job.token, sequence: job.next },
              new Map(jobs).set(input.id, {
                ...job,
                pending: job.pending + 1,
                next: job.next + 1,
                tail,
              }),
            ]
          },
        )
        if (!result.extended) return false
        yield* fork(
          result.scope,
          input.id,
          result.token,
          result.sequence,
          Deferred.await(result.previous).pipe(
            Effect.andThen(restore(input.run)),
            Effect.ensuring(Deferred.succeed(result.tail, undefined)),
          ),
        )
        return true
      }),
    )
  })

  const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    // 可恢复作业的 wait -> background 交接成立，即使以失败收场也保留消费资格
    return yield* Effect.gen(function* () {
      if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
      if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
      if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
      const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      return { info: snapshot(job), timedOut: true }
    }).pipe(
      Effect.tap((result) =>
        result.info.status === "running" || job.recovery ? Effect.void : consume(input.id, job.scope),
      ),
    )
  })

  const waitForPromotion: Interface["waitForPromotion"] = Effect.fn("BackgroundJob.waitForPromotion")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return yield* Effect.never
    // 已结束（完成/错误/取消）的任务永远不可能再被 promote：直接返回当前快照，避免调用方永挂
    if (job.info.status !== "running") return snapshot(job)
    if (job.info.metadata?.background === true) return snapshot(job)
    return yield* Deferred.await(job.promoted)
  })

  const promote: Interface["promote"] = Effect.fn("BackgroundJob.promote")(function* (id) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [PromoteResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job || job.info.status !== "running") return [{}, jobs] as readonly [PromoteResult, Map<string, Active>]
        if (job.info.metadata?.background === true)
          return [{ info: snapshot(job) }, jobs] as readonly [PromoteResult, Map<string, Active>]
        const next = {
          ...job,
          onPromote: undefined,
          info: {
            ...job.info,
            metadata: { ...job.info.metadata, background: true },
          },
        }
        return [
          { info: snapshot(next), onPromote: job.onPromote, promoted: job.promoted },
          new Map(jobs).set(id, next),
        ] as readonly [PromoteResult, Map<string, Active>]
      }),
    )
    if (result.info && result.promoted) yield* Deferred.succeed(result.promoted, result.info).pipe(Effect.ignore)
    if (result.onPromote) yield* result.onPromote.pipe(Effect.ignore)
    return result.info
  })

  const removeBlock = Effect.fnUntraced(function* (input: BlockInput) {
    yield* SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(input.id)
      if (!job || job.info.status !== "running" || job.isBackgrounded) return jobs
      return new Map(jobs).set(input.id, {
        ...job,
        blockingSessions: decrementSession(job.blockingSessions, input.sessionID),
      })
    })
  })

  const block: Interface["block"] = Effect.fn("BackgroundJob.block")(function* (input) {
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [BlockStart, Map<string, Active>] => {
      const job = jobs.get(input.id)
      if (!job) return [{ type: "missing" }, jobs]
      if (job.info.status !== "running") return [{ type: "finished", info: snapshot(job), generation: job.scope }, jobs]
      if (job.isBackgrounded) return [{ type: "backgrounded", info: snapshot(job) }, jobs]
      return [
        { type: "wait", wait: { done: job.done, backgrounded: job.backgrounded, generation: job.scope } },
        new Map(jobs).set(input.id, {
          ...job,
          blockingSessions: incrementSession(job.blockingSessions, input.sessionID),
        }),
      ]
    })
    if (result.type === "missing") return undefined
    if (result.type === "finished") {
      yield* consume(input.id, result.generation)
      return { type: "finished", info: result.info }
    }
    if (result.type === "backgrounded") return { type: "backgrounded", info: result.info }
    return yield* Effect.raceFirst(
      Deferred.await(result.wait.done).pipe(Effect.map((info) => ({ type: "finished" as const, info }))),
      Deferred.await(result.wait.backgrounded).pipe(Effect.map((info) => ({ type: "backgrounded" as const, info }))),
    ).pipe(
      Effect.tap((outcome) => (outcome.type === "finished" ? consume(input.id, result.wait.generation) : Effect.void)),
      Effect.ensuring(removeBlock(input)),
    )
  })

  const markBackground = Effect.fnUntraced(function* (job: Active) {
    const next = {
      ...job,
      isBackgrounded: true,
      blockingSessions: new Map<SessionSchema.ID, number>(),
      info: {
        ...job.info,
        ...(job.recovery ? { notificationID: job.info.notificationID ?? SessionMessage.ID.create() } : {}),
      },
    }
    yield* persistBackground(next)
    return next
  })

  const background: Interface["background"] = Effect.fn("BackgroundJob.background")(function* (id) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [BackgroundResult, Map<string, Active>]> {
        const job = jobs.get(id)
        // 可恢复作业可能先于调用方转后台就已完成
        if (!job || (job.info.status !== "running" && !job.recovery)) return [{}, jobs]
        if (job.isBackgrounded) return [{ info: snapshot(job) }, jobs]
        const next = yield* markBackground(job)
        return [{ info: snapshot(next), backgrounded: job.backgrounded }, new Map(jobs).set(id, next)]
      }),
    )
    if (result.info && result.backgrounded) yield* Deferred.succeed(result.backgrounded, result.info).pipe(Effect.ignore)
    return result.info
  })

  const backgroundAll: Interface["backgroundAll"] = Effect.fn("BackgroundJob.backgroundAll")(function* (input) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [Required<BackgroundResult>[], Map<string, Active>]> {
        const results: Required<BackgroundResult>[] = []
        const next = new Map(jobs)
        for (const [id, job] of jobs) {
          if (job.info.status !== "running") continue
          if (job.isBackgrounded) continue
          if (input.type !== undefined && job.info.type !== input.type) continue
          if (!job.blockingSessions.has(input.sessionID)) continue
          const updated = yield* markBackground(job)
          results.push({ info: snapshot(updated), backgrounded: job.backgrounded })
          next.set(id, updated)
        }
        return [results, next]
      }),
    )
    yield* Effect.forEach(result, (item) => Deferred.succeed(item.backgrounded, item.info).pipe(Effect.ignore), {
      discard: true,
    })
    return result.map((item) => item.info)
  })

  const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [FinishResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job), generation: job.scope }, jobs]
        const next = {
          ...job,
          onPromote: undefined,
          pending: 0,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...job.info,
            status: "cancelled" as const,
            completed_at,
          },
        }
        yield* persistBackground(next)
        return [
          {
            info: snapshot(next),
            done: job.done,
            scope: job.scope,
            promoted: job.promoted,
            generation: job.scope,
          },
          new Map(jobs).set(id, next),
        ]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.info && result.promoted) yield* Deferred.succeed(result.promoted, result.info).pipe(Effect.ignore)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    if (result.generation) yield* consume(id, result.generation)
    return result.info
  })

  const pendingBackground: Interface["pendingBackground"] = Effect.gen(function* () {
    const recovered: Background[] = []
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix: backgroundPrefix, after })
      recovered.push(...Array.filterMap(page.entries, (entry) => decodeBackground(entry.value)))
      after = page.next
    } while (after)
    return recovered
  }).pipe(Effect.withSpan("BackgroundJob.pendingBackground"))

  const runningBackground: Interface["runningBackground"] = SynchronizedRef.get(state.jobs).pipe(
    Effect.map((jobs) =>
      [...jobs.values()].flatMap((job) =>
        job.isBackgrounded && job.info.status === "running" && job.recovery ? [job.recovery] : [],
      ),
    ),
    Effect.withSpan("BackgroundJob.runningBackground"),
  )

  const completeBackground: Interface["completeBackground"] = Effect.fn("BackgroundJob.completeBackground")(
    (notificationID) =>
      SynchronizedRef.updateEffect(state.jobs, (jobs) =>
        Effect.gen(function* () {
          yield* kv.remove(`${backgroundPrefix}${notificationID}`)
          const entry = [...jobs].find(([, job]) => job.info.notificationID === notificationID)
          if (!entry || entry[1].info.status === "running") return jobs
          const next = new Map(jobs)
          next.delete(entry[0])
          return next
        }),
      ),
  )

  return Service.of({
    list,
    get,
    start,
    extend,
    wait,
    waitForPromotion,
    promote,
    cancel,
    block,
    background,
    backgroundAll,
    pendingBackground,
    runningBackground,
    completeBackground,
  })
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
