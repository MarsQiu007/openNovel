export * as SessionWorkRun from "./work-run"

import { randomUUID } from "crypto"
import { and, asc, eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import {
  Event,
  Item,
  Run,
  type ItemStatus,
  type Run as RunSchema,
} from "@opennovel-ai/schema/session-work-run"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionContextEpoch } from "./context-epoch"
import { SessionSchema } from "./schema"
import { WorkRunItemTable, WorkRunTable } from "./sql"

export class NoActiveRun extends Schema.TaggedErrorClass<NoActiveRun>()("SessionWorkRun.NoActiveRun", {}) {}
export class InvalidTransition extends Schema.TaggedErrorClass<InvalidTransition>()("SessionWorkRun.InvalidTransition", {
  reason: Schema.String,
}) {}

export type GuardDecision =
  | { readonly action: "continue"; readonly run: RunSchema }
  | {
      readonly action: "stop"
      readonly reason: "no_run" | "no_executable" | "limit_reached" | "no_progress"
    }

export interface Interface {
  readonly create: (input: {
    readonly sessionID: SessionSchema.ID
    readonly goal: string
    readonly items: ReadonlyArray<string>
  }) => Effect.Effect<RunSchema, InvalidTransition>
  readonly current: (sessionID: SessionSchema.ID) => Effect.Effect<RunSchema | undefined>
  readonly history: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<RunSchema>>
  readonly claimNext: (runID: string) => Effect.Effect<RunSchema, NoActiveRun | InvalidTransition>
  readonly completeItem: (runID: string, itemSeq: number) => Effect.Effect<RunSchema, NoActiveRun | InvalidTransition>
  readonly skipItem: (runID: string, itemSeq: number) => Effect.Effect<RunSchema, NoActiveRun | InvalidTransition>
  readonly blockItem: (
    runID: string,
    itemSeq: number,
    reason: string,
  ) => Effect.Effect<RunSchema, NoActiveRun | InvalidTransition>
  readonly resetItem: (runID: string, itemSeq: number) => Effect.Effect<RunSchema, NoActiveRun | InvalidTransition>
  readonly recordProgress: (runID: string, note: string) => Effect.Effect<void, NoActiveRun>
  readonly complete: (runID: string) => Effect.Effect<RunSchema, NoActiveRun | InvalidTransition>
  readonly pause: (sessionID: SessionSchema.ID) => Effect.Effect<RunSchema, NoActiveRun>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<RunSchema, NoActiveRun>
  readonly guardDecide: (
    sessionID: SessionSchema.ID,
    limits: { readonly continuationLimit: number; readonly noProgressLimit: number },
  ) => Effect.Effect<GuardDecision>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SessionWorkRun") {}

type RunRow = typeof WorkRunTable.$inferSelect
type ItemRow = typeof WorkRunItemTable.$inferSelect
type DB = Database.Interface["db"]

const toItem = (row: ItemRow) =>
  Item.make({
    seq: row.seq,
    title: row.title,
    status: row.status,
    ...(row.note === null ? {} : { note: row.note }),
  })

const fromRows = (run: RunRow, items: ItemRow[]): RunSchema =>
  Run.make({
    id: run.id,
    sessionID: SessionSchema.ID.make(run.session_id),
    goal: run.goal,
    status: run.status,
    progressNote: run.progress_note,
    continuationCount: run.continuation_count,
    noProgressCount: run.no_progress_count,
    timeCreated: DateTime.makeUnsafe(run.time_created),
    timeUpdated: DateTime.makeUnsafe(run.time_updated),
    items: items.map(toItem),
  })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const selectRun = (runID: string) => db.select().from(WorkRunTable).where(eq(WorkRunTable.id, runID)).get().pipe(Effect.orDie)

    // 迁移/翻转后的重读：行刚被写入，仍 narrow undefined（die 为内部不变量破坏）
    const selectRunOrDie = (runID: string) =>
      Effect.gen(function* () {
        const row = yield* selectRun(runID)
        if (row === undefined) return yield* Effect.die(new NoActiveRun())
        return row
      })

    const selectItems = (runID: string) =>
      db
        .select()
        .from(WorkRunItemTable)
        .where(eq(WorkRunItemTable.run_id, runID))
        .orderBy(asc(WorkRunItemTable.seq))
        .all()
        .pipe(Effect.orDie)

    const publishUpdate = (runID: string) =>
      Effect.gen(function* () {
        const run = yield* selectRunOrDie(runID)
        if (run === undefined) return
        yield* events.publish(Event.Updated, {
          sessionID: SessionSchema.ID.make(run.session_id),
          run: fromRows(run, yield* selectItems(runID)),
        })
      })

    const current = Effect.fn("SessionWorkRun.current")(function* (sessionID: SessionSchema.ID) {
      const row =
        (yield* db
          .select()
          .from(WorkRunTable)
          .where(and(eq(WorkRunTable.session_id, sessionID), eq(WorkRunTable.status, "active")))
          .get()
          .pipe(Effect.orDie)) ??
        (yield* db
          .select()
          .from(WorkRunTable)
          .where(and(eq(WorkRunTable.session_id, sessionID), eq(WorkRunTable.status, "paused")))
          .get()
          .pipe(Effect.orDie))
      return row === undefined ? undefined : fromRows(row, yield* selectItems(row.id))
    })

    const withActiveRun = Effect.fn("SessionWorkRun.withActiveRun")(function* (runID: string) {
      const run = yield* selectRunOrDie(runID)
      if (run === undefined || run.status !== "active") return yield* new NoActiveRun()
      return run
    })

    // 单元状态迁移都会清零无进展计数：任何推进都证明队列在工作，熔断只针对连续空转
    const transitionItem = Effect.fn("SessionWorkRun.transitionItem")(function* (
      runID: string,
      itemSeq: number,
      from: ItemStatus,
      to: ItemStatus,
    ) {
      const activeRun = yield* withActiveRun(runID)
      const item = yield* db
        .select()
        .from(WorkRunItemTable)
        .where(and(eq(WorkRunItemTable.seq, itemSeq), eq(WorkRunItemTable.run_id, runID)))
        .get()
        .pipe(Effect.orDie)
      if (item === undefined) return yield* new InvalidTransition({ reason: "单元不存在" })
      if (item.status !== from)
        return yield* new InvalidTransition({ reason: `单元状态为 ${item.status}，不能转为 ${to}` })
      yield* db
        .update(WorkRunItemTable)
        .set({ status: to, ...(to === "blocked" ? {} : { note: null }) })
        .where(eq(WorkRunItemTable.seq, itemSeq))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(WorkRunTable)
        .set({ no_progress_count: 0 })
        .where(eq(WorkRunTable.id, runID))
        .run()
        .pipe(Effect.orDie)
      const updated = yield* selectRunOrDie(runID)
      yield* publishUpdate(updated.id)
      return fromRows(updated, yield* selectItems(runID))
    })

    const interfaceImpl: Interface = {
      create: (input) =>
        Effect.gen(function* () {
          const existing = yield* current(input.sessionID)
          if (existing !== undefined)
            return yield* new InvalidTransition({
              reason:
                existing.status === "active"
                  ? "会话已有活动工作队列，须先完结后再创建"
                  : "会话有挂起的工作队列，请先恢复或等其完结",
            })
          if (input.items.length === 0) return yield* new InvalidTransition({ reason: "工作队列至少需要一个单元" })
          const runID = randomUUID()
          yield* db
            .insert(WorkRunTable)
            .values({ id: runID, session_id: input.sessionID, goal: input.goal, status: "active" })
            .run()
            .pipe(Effect.orDie)
          yield* db
            .insert(WorkRunItemTable)
            .values(
              input.items.map((title, seq) => ({ id: randomUUID(), run_id: runID, seq, title, status: "pending" as const })),
            )
            .run()
            .pipe(Effect.orDie)
          const created = yield* selectRunOrDie(runID)
          yield* publishUpdate(created.id)
          return fromRows(created, yield* selectItems(runID))
        }),

      current: (sessionID) => current(sessionID),

      history: (sessionID) =>
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(WorkRunTable)
            .where(eq(WorkRunTable.session_id, sessionID))
            .orderBy(asc(WorkRunTable.time_created))
            .all()
            .pipe(Effect.orDie)
          return yield* Effect.forEach(rows, (row) =>
            Effect.map(selectItems(row.id), (items) => fromRows(row, items)),
          )
        }),

      claimNext: (runID) =>
        Effect.gen(function* () {
          const run = yield* withActiveRun(runID)
          const items = yield* selectItems(runID)
          const inProgress = items.find((item) => item.status === "in_progress")
          if (inProgress !== undefined)
            return yield* new InvalidTransition({
              reason: `单元「${inProgress.title}」仍在进行中，先完成再领取下一单元`,
            })
          const next = items.find((item) => item.status === "pending")
          if (next === undefined) return yield* new InvalidTransition({ reason: "队列没有待处理单元" })
          return yield* transitionItem(runID, next.seq, "pending", "in_progress")
        }),

      completeItem: (runID, itemSeq) => transitionItem(runID, itemSeq, "in_progress", "done"),

      skipItem: (runID, itemSeq) => transitionItem(runID, itemSeq, "in_progress", "skipped"),

      blockItem: (runID, itemSeq, reason) =>
        Effect.gen(function* () {
          yield* withActiveRun(runID)
          const item = yield* db
            .select()
            .from(WorkRunItemTable)
            .where(and(eq(WorkRunItemTable.seq, itemSeq), eq(WorkRunItemTable.run_id, runID)))
            .get()
            .pipe(Effect.orDie)
          if (item === undefined) return yield* new InvalidTransition({ reason: "单元不存在" })
          if (item.status !== "in_progress" && item.status !== "pending")
            return yield* new InvalidTransition({ reason: `单元状态为 ${item.status}，不能转为 blocked` })
          yield* db
            .update(WorkRunItemTable)
            .set({ status: "blocked", note: reason })
            .where(eq(WorkRunItemTable.seq, itemSeq))
            .run()
            .pipe(Effect.orDie)
          yield* db
            .update(WorkRunTable)
            .set({ no_progress_count: 0 })
            .where(eq(WorkRunTable.id, runID))
            .run()
            .pipe(Effect.orDie)
          const run = yield* selectRunOrDie(runID)
          yield* publishUpdate(run.id)
          return fromRows(run, yield* selectItems(runID))
        }),

      resetItem: (runID, itemSeq) => transitionItem(runID, itemSeq, "blocked", "pending"),

      recordProgress: (runID, note) =>
        Effect.gen(function* () {
          yield* withActiveRun(runID)
          yield* db
            .update(WorkRunTable)
            .set({ progress_note: note })
            .where(eq(WorkRunTable.id, runID))
            .run()
            .pipe(Effect.orDie)
          yield* publishUpdate(runID)
        }),

      complete: (runID) =>
        Effect.gen(function* () {
          yield* withActiveRun(runID)
          const items = yield* selectItems(runID)
          const unfinished = items.filter((item) => item.status === "pending" || item.status === "in_progress")
          if (unfinished.length > 0)
            return yield* new InvalidTransition({ reason: `还有 ${unfinished.length} 个未终结单元，不能终结队列` })
          yield* db
            .update(WorkRunTable)
            .set({ status: "complete" })
            .where(eq(WorkRunTable.id, runID))
            .run()
            .pipe(Effect.orDie)
          const run = yield* selectRunOrDie(runID)
          yield* publishUpdate(run.id)
          // 状态迁移纳入 epoch 失效语义（design D4）：终结后重置上下文 epoch，
          // 下回合 initialize 重新生成 baseline，active 注入约束随迁移当回合消失
          yield* SessionContextEpoch.reset(db, run.session_id)
          return fromRows(run, items)
        }),

      // 用户打断与面板挂起共用：不打断进行中回合，当前单元结算后守卫读 paused 放行
      pause: (sessionID) =>
        Effect.gen(function* () {
          const run = yield* current(sessionID)
          if (run === undefined || run.status !== "active") return yield* new NoActiveRun()
          yield* db
            .update(WorkRunTable)
            .set({ status: "paused" })
            .where(eq(WorkRunTable.id, run.id))
            .run()
            .pipe(Effect.orDie)
          const row = yield* selectRunOrDie(run.id)
          yield* publishUpdate(row.id)
          // 挂起重置上下文 epoch：下回合 baseline 不再包含续跑约束
          yield* SessionContextEpoch.reset(db, row.session_id)
          return fromRows(row, yield* selectItems(run.id))
        }),

      resume: (sessionID) =>
        Effect.gen(function* () {
          const run = yield* db
            .select()
            .from(WorkRunTable)
            .where(and(eq(WorkRunTable.session_id, sessionID), eq(WorkRunTable.status, "paused")))
            .get()
            .pipe(Effect.orDie)
          if (run === undefined) return yield* new NoActiveRun()
          yield* db
            .update(WorkRunTable)
            .set({ status: "active", continuation_count: 0, no_progress_count: 0 })
            .where(eq(WorkRunTable.id, run.id))
            .run()
            .pipe(Effect.orDie)
          const row = yield* selectRunOrDie(run.id)
          yield* publishUpdate(row.id)
          // 恢复重置上下文 epoch：下回合 initialize 以 active 队列重新生成 baseline 注入约束
          yield* SessionContextEpoch.reset(db, row.session_id)
          return fromRows(row, yield* selectItems(run.id))
        }),

      // 守卫判定 + 阀门（design D5）：续跑同时递增计数（无进展熔断依赖单元迁移清零），
      // 阀门触发时直接转 paused 并放行。limits 由 runner 从 agent 配置解析
      guardDecide: (sessionID, limits) =>
        Effect.gen(function* () {
          const run = yield* current(sessionID)
          if (run === undefined || run.status !== "active") return { action: "stop", reason: "no_run" }
          const executable = run.items.some((item) => item.status === "pending" || item.status === "in_progress")
          if (!executable) return { action: "stop", reason: "no_executable" }
          if (run.continuationCount >= limits.continuationLimit) {
            yield* db
              .update(WorkRunTable)
              .set({ status: "paused" })
              .where(eq(WorkRunTable.id, run.id))
              .run()
              .pipe(Effect.orDie)
            // 熔断挂起重置上下文 epoch：下回合 baseline 不再包含续跑约束
            yield* SessionContextEpoch.reset(db, run.sessionID)
            return { action: "stop", reason: "limit_reached" }
          }
          if (run.noProgressCount >= limits.noProgressLimit) {
            yield* db
              .update(WorkRunTable)
              .set({ status: "paused" })
              .where(eq(WorkRunTable.id, run.id))
              .run()
              .pipe(Effect.orDie)
            yield* SessionContextEpoch.reset(db, run.sessionID)
            return { action: "stop", reason: "no_progress" }
          }
          yield* db
            .update(WorkRunTable)
            .set({ continuation_count: run.continuationCount + 1, no_progress_count: run.noProgressCount + 1 })
            .where(eq(WorkRunTable.id, run.id))
            .run()
            .pipe(Effect.orDie)
          const row = yield* selectRunOrDie(run.id)
          yield* publishUpdate(row.id)
          return {
            action: "continue",
            run: fromRows(row, yield* selectItems(run.id)),
          }
        }),
    }

    return Service.of(interfaceImpl)
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [EventV2.node, Database.node] })
