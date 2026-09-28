/**
 * 章节派生数据重建 — 手动编辑同步 worker 的 observer 消费实现。
 *
 * 一次调用完成章节摘要、结构化主轴、实体引用、段摘要与 FTS 的整体刷新；
 * LLM 输出先解析校验，数据库写入使用事务，失败不留下半更新状态。
 */
import { and, eq, sql } from "drizzle-orm"
import {
  ChapterSummaryTable,
  ChapterTable,
  NovelTable,
  StorySpineEntryTable,
  StyleGuideTable,
  ensureSegmentSummaries,
  scanEntityReferences,
  type Db,
} from "@opennovel-ai/novel-store"
import { syncChapterSummaryFts } from "./state-commit.js"

export type ChapterRebuildLlm = (prompt: string) => Promise<string>

export interface RebuiltChapterDerivedData {
  summary: string
  key_events: string[]
  char_changes: string[]
  spine: Array<{ content: string; kind: string }>
}

export function parseRebuiltChapterDerivedData(output: string): RebuiltChapterDerivedData {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error("章节重建输出不是合法 JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("章节重建输出必须是 JSON 对象")
  }

  const record = toRecord(parsed)
  return {
    summary: requireString(record.summary, "summary"),
    key_events: requireStringArray(record.key_events, "key_events"),
    char_changes: requireStringArray(record.char_changes, "char_changes"),
    spine: requireSpine(record.spine),
  }
}

export async function rebuildChapterDerivedData(
  db: Db,
  novelId: string,
  chapterId: string,
  fingerprint: string,
  llm: ChapterRebuildLlm,
): Promise<void> {
  const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()
  if (!chapter || chapter.novel_id !== novelId) throw new Error(`Chapter not found: ${chapterId}`)
  const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()
  if (!novel) throw new Error(`Novel not found: ${novelId}`)
  const styleGuide = db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).get() ?? null

  const rebuilt = parseRebuiltChapterDerivedData(await llm(buildObserverPrompt(novel.genre, styleGuide, chapter)))

  db.run(sql`BEGIN`)
  try {
    const summaries = db
      .select({ id: ChapterSummaryTable.id })
      .from(ChapterSummaryTable)
      .where(eq(ChapterSummaryTable.chapter_id, chapterId))
      .all()
    const summary = {
      summary: rebuilt.summary,
      key_events: rebuilt.key_events,
      char_changes: rebuilt.char_changes,
      source_fingerprint: fingerprint,
    }
    if (summaries.length === 1) {
      db.update(ChapterSummaryTable).set(summary).where(eq(ChapterSummaryTable.id, summaries[0].id)).run()
    } else {
      db.delete(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapterId)).run()
      db
        .insert(ChapterSummaryTable)
        .values({ id: crypto.randomUUID(), chapter_id: chapterId, ...summary })
        .run()
    }

    db
      .delete(StorySpineEntryTable)
      .where(and(eq(StorySpineEntryTable.novel_id, novelId), eq(StorySpineEntryTable.chapter_id, chapterId)))
      .run()
    const now = Date.now()
    for (const entry of rebuilt.spine) {
      db
        .insert(StorySpineEntryTable)
        .values({
          id: crypto.randomUUID(),
          novel_id: novelId,
          chapter_id: chapterId,
          chapter_order: chapter.order,
          content: entry.content,
          kind: entry.kind,
          source_fingerprint: fingerprint,
          status: "synced",
          created_at: now,
          updated_at: now,
        })
        .run()
    }

    await scanEntityReferences(db, novelId, "chapter", chapterId, "content", chapter.content)
    await ensureSegmentSummaries(db, novelId, chapter.order)
    await syncChapterSummaryFts(db, novelId, chapterId)
    db.run(sql`COMMIT`)
  } catch (error) {
    await Promise.resolve(db.run(sql`ROLLBACK`)).catch(() => {})
    throw error
  }
}

function buildObserverPrompt(
  genre: string,
  styleGuide: typeof StyleGuideTable.$inferSelect | null,
  chapter: typeof ChapterTable.$inferSelect,
): string {
  const styleLines = [
    styleGuide?.tone ? `基调：${styleGuide.tone}` : "",
    styleGuide?.pov ? `视角：${styleGuide.pov}` : "",
    styleGuide?.tense ? `时态：${styleGuide.tense}` : "",
    styleGuide && typeof styleGuide.rules === "object" && styleGuide.rules !== null && Object.keys(styleGuide.rules).length > 0
      ? `规则：${JSON.stringify(styleGuide.rules)}`
      : "",
  ].filter(Boolean)
  return [
    "你是小说 observer，负责把单章正文压缩为后续创作可复用的结构化记忆。",
    `书籍类型：${genre}`,
    styleLines.length > 0 ? `风格指南：${styleLines.join("；")}` : "风格指南：未设置",
    `章节：第${chapter.order}章《${chapter.title}》`,
    "正文：",
    chapter.content,
    "",
    "请只输出一个 JSON 对象，不要 Markdown 代码块，不要解释文字。",
    "JSON 形状：",
    JSON.stringify(
      {
        summary: "200 字以内的本章摘要",
        key_events: ["关键事件 1", "关键事件 2"],
        char_changes: ["角色变化 1"],
        spine: [{ content: "本章主轴条目", kind: "chapter" }],
      },
      null,
      2,
    ),
  ].join("\n")
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`章节重建输出缺少或形状不符：${field}`)
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`章节重建输出缺少或形状不符：${field}`)
  return value.map((item, index) => {
    if (typeof item !== "string") throw new Error(`章节重建输出形状不符：${field}[${index}] 必须是字符串`)
    return item
  })
}

function requireSpine(value: unknown): Array<{ content: string; kind: string }> {
  if (!Array.isArray(value)) throw new Error("章节重建输出缺少或形状不符：spine")
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`章节重建输出形状不符：spine[${index}] 必须是对象`)
    }
    const record = toRecord(item)
    return {
      content: requireString(record.content, `spine[${index}].content`),
      kind: requireString(record.kind, `spine[${index}].kind`),
    }
  })
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) record[key] = item
  return record
}
