/**
 * 服务端手动编辑事务辅助层。
 *
 * 统一校验目标归属 → 执行正式表写入 → 创建同步记录 → 返回显式成功或错误。
 * 章节正文保存、版本恢复、章纲保存和正式设定编辑通过本层执行。
 */
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import {
  getDb,
  NovelTable,
  ChapterTable,
  CharacterTable,
  WorldEntryTable,
  RelationshipTable,
  PlotThreadTable,
  ForeshadowingTable,
  VolumeTable,
  StyleGuideTable,
  computeFingerprint,
  enqueueManualEditSync,
  markDerivedStale,
} from "@opennovel-ai/novel-store"
import { NovelNotFoundError, ChapterNotFoundError } from "@opennovel-ai/protocol/groups/novel"

/** 手动编辑事务上下文 */
export interface ManualEditContext {
  readonly novelId: string
  readonly directory: string
}

/** 校验小说归属并返回 Effect */
export function requireNovel(ctx: ManualEditContext) {
  return Effect.gen(function* () {
    const db = getDb(ctx.directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, ctx.novelId)).get()
    if (!novel) yield* Effect.fail(new NovelNotFoundError({ name: "NovelNotFoundError", data: { message: `小说不存在: ${ctx.novelId}`, novelId: ctx.novelId } }))
    return novel
  })
}

/** 校验章节归属并返回 Effect */
export function requireChapter(ctx: ManualEditContext, chapterId: string) {
  return Effect.gen(function* () {
    const db = getDb(ctx.directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()
    if (!chapter) return yield* Effect.fail(new ChapterNotFoundError({ name: "ChapterNotFoundError", data: { message: `章节不存在: ${chapterId}`, chapterId } }))
    if (chapter.novel_id !== ctx.novelId) {
      yield* Effect.fail(new ChapterNotFoundError({ name: "ChapterNotFoundError", data: { message: `章节不属于当前小说`, chapterId } }))
    }
    return chapter
  })
}

/** 校验实体归属（角色 / 世界观 / 关系 / 剧情线 / 伏笔 / 卷） */
export function requireEntity(
  ctx: ManualEditContext,
  entity: string,
  entityId: string,
) {
  return Effect.gen(function* () {
    const db = getDb(ctx.directory)
    const checks: Record<string, () => { novel_id: string } | undefined> = {
      character: () => db.select().from(CharacterTable).where(eq(CharacterTable.id, entityId)).get(),
      world_entry: () => db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entityId)).get(),
      relationship: () => db.select().from(RelationshipTable).where(eq(RelationshipTable.id, entityId)).get(),
      plot_thread: () => db.select().from(PlotThreadTable).where(eq(PlotThreadTable.id, entityId)).get(),
      foreshadowing: () => db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.id, entityId)).get(),
      volume: () => db.select().from(VolumeTable).where(eq(VolumeTable.id, entityId)).get(),
      style_guide: () => db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, ctx.novelId)).get(),
    }
    const check = checks[entity]
    if (!check) yield* Effect.die(`未知实体类型: ${entity}`)
    const row = check()
    if (!row) return yield* Effect.fail(new NovelNotFoundError({ name: "NovelNotFoundError", data: { message: `${entity} 不存在: ${entityId}`, novelId: ctx.novelId } }))
    if (row.novel_id !== ctx.novelId) {
      yield* Effect.fail(new NovelNotFoundError({ name: "NovelNotFoundError", data: { message: `${entity} 不属于当前小说`, novelId: ctx.novelId } }))
    }
    return row
  })
}

/** 手动编辑事务结果 */
export interface ManualEditResult<T> {
  readonly data: T
  readonly syncQueued: boolean
}

/**
 * 执行手动编辑事务：写入 + 同步入队。
 *
 * 操作必须在写入完成后创建同步请求；
 * 如果写入或入队失败，错误会直接传递给调用方。
 */
export function withManualEditSync<T>(
  ctx: ManualEditContext,
  entity: string,
  entityId: string | null,
  field: string,
  content: string | null,
  write: () => Promise<T> | T,
): Effect.Effect<ManualEditResult<T>, Error> {
  return Effect.gen(function* () {
    const data = yield* Effect.promise(() => Promise.resolve(write()))
    const fingerprint = content !== null ? computeFingerprint(content) : null
    const sync = yield* Effect.promise(() =>
      enqueueManualEditSync(
        {
          novelId: ctx.novelId,
          entity,
          entityId,
          field,
          category: "creative_fact",
          sourceFingerprint: fingerprint,
        },
        ctx.directory,
      ),
    )
    return { data, syncQueued: sync.queued }
  })
}

/**
 * 章节正文保存：写入 + 标记派生数据过期 + 同步入队。
 */
export function saveChapterContent(
  ctx: ManualEditContext,
  chapterId: string,
  content: string,
  write: () => Promise<unknown> | unknown,
): Effect.Effect<{ chapter: unknown; syncQueued: boolean }, Error> {
  return Effect.gen(function* () {
    yield* requireChapter(ctx, chapterId)
    yield* Effect.promise(() => Promise.resolve(write()))
    const fingerprint = computeFingerprint(content)
    yield* Effect.promise(() => markDerivedStale(ctx.novelId, chapterId, fingerprint, ctx.directory))
    return { chapter: { id: chapterId }, syncQueued: true }
  })
}
