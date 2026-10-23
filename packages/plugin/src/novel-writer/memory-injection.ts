/**
 * 记忆注入召回组装器（agent-memory-system §5.1 五件套 / §2.4 物化快照）。
 *
 * 五件套：出场角色卡 / 活跃伏笔卡 / 相邻章新事实 / planned 设定 / 本书技巧卡（含饱和度账本）。
 * 体量预算 <4K tokens，按权重三信号（引用频次 + 近因 + 确认级别）排序截断；
 * 同一数据库输入必得同一 payload（确定性：排序带 id 决胜、payload 不含时间戳）。
 *
 * 物化快照 memory_injection_snapshot 由章审批通过事件触发重建（Wave 6 挂钩），
 * 起草开始时一次读。读路径不兜底重算——快照缺失时返回 null，由调用方决定降级。
 *
 * 与 design 的两处实施偏差（记录在 tasks 实施记录）：
 * - design 写"当前卷 planned 设定"，但设定表无卷归属字段，取全书 planned 集合；
 * - 饱和度账本按"近 N 章"窗口汇总（design 示例的卷级口径待 Wave 8 账本写入方落地后细化）。
 */

import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm"
import { withTransaction } from "@opennovel-ai/novel-store"
import {
  getDb,
  CharacterTable,
  CharacterStateTable,
  ChapterTable,
  ForeshadowingTable,
  MemoryFactTable,
  MemoryInjectionSnapshotTable,
  TechniqueTable,
  WorldEntryTable,
} from "./session-store.js"

type Db = ReturnType<typeof getDb>

// ─── payload 类型 ───

export interface MemoryCharacterCard {
  id: string
  name: string
  role: string
  establishment: string
  location: string
  mood: string
  summary: string
}

export interface MemoryForeshadowCard {
  id: string
  content: string
  plantedChapterOrder: number | null
}

export interface MemoryFactCard {
  id: string
  factType: string
  text: string
  quote: string | null
  chapterOrder: number | null
  status: string
  proofCount: number
}

export interface MemoryPlannedSettingCard {
  id: string
  kind: "character" | "world_entry"
  title: string
  summary: string
}

export interface MemoryTechniqueCard {
  id: string
  name: string
  instruction: string
  confidence: number
  usageCount: number
  ledgerSummary: string
}

export interface MemoryInjectionPayload {
  characters: MemoryCharacterCard[]
  foreshadows: MemoryForeshadowCard[]
  recentFacts: MemoryFactCard[]
  plannedSettings: MemoryPlannedSettingCard[]
  techniques: MemoryTechniqueCard[]
}

// ─── 预算与权重 ───

/** 五件套分段预算（tokens），合计不超总量 */
export const MEMORY_INJECTION_BUDGET = {
  total: 4000,
  characters: 1200,
  foreshadows: 600,
  recentFacts: 800,
  plannedSettings: 600,
  techniques: 800,
} as const

/** 相邻章窗口：前 3 章 */
const RECENT_CHAPTER_WINDOW = 3
/** 技巧账本近因窗口：近 14 章 */
const TECHNIQUE_LEDGER_WINDOW = 14

/** 与 budget.ts 同口径：1 token ≈ 1.5 中文字符 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

/**
 * 权重三信号：引用频次（封顶 10）+ 近因（5 章内线性衰减）+ 确认级别
 * （approved/established=3，reviewed/verified=2，pending/planned=1）。
 */
function weightScore(frequency: number, chapterDistance: number | null, confirmation: number): number {
  const recency = chapterDistance === null ? 0 : Math.max(0, 5 - chapterDistance)
  return Math.min(frequency, 10) + recency + confirmation
}

interface Weighted<T> {
  value: T
  id: string
  score: number
  tokens: number
}

/** 预算内按权重截断：score 降序、id 升序决胜（确定性） */
function pickWithinBudget<T>(items: Weighted<T>[], budget: number): { picked: T[]; used: number } {
  const sorted = items
    .slice()
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const picked: T[] = []
  let used = 0
  for (const item of sorted) {
    if (used + item.tokens > budget) continue
    picked.push(item.value)
    used += item.tokens
  }
  return { picked, used }
}

// ─── 五件套组装 ───

async function buildCharacterCards(db: Db, novelId: string, chapterOrder: number) {
  const characters = await db
    .select()
    .from(CharacterTable)
    .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.status, "active")))
    .all()
  const items: Weighted<MemoryCharacterCard>[] = []
  for (const char of characters) {
    const [state] = await db
      .select({
        active: CharacterStateTable.active,
        location: CharacterStateTable.location,
        mood: CharacterStateTable.mood,
        summary: CharacterStateTable.summary,
        chapterOrder: ChapterTable.order,
      })
      .from(CharacterStateTable)
      .innerJoin(ChapterTable, eq(ChapterTable.id, CharacterStateTable.chapter_id))
      .where(eq(CharacterStateTable.character_id, char.id))
      .orderBy(desc(ChapterTable.order))
      .limit(1)
      .all()
    if (!state || state.active !== 1) continue
    const [appearances] = await db
      .select({ n: sql<number>`count(*)` })
      .from(CharacterStateTable)
      .where(eq(CharacterStateTable.character_id, char.id))
      .all()
    const card: MemoryCharacterCard = {
      id: char.id,
      name: char.name,
      role: char.role,
      establishment: char.establishment,
      location: state.location,
      mood: state.mood,
      summary: state.summary,
    }
    items.push({
      value: card,
      id: char.id,
      score: weightScore(
        appearances?.n ?? 0,
        chapterOrder - state.chapterOrder,
        char.establishment === "established" ? 3 : 1,
      ),
      tokens: estimateTokens(card.name + card.role + card.location + card.mood + card.summary),
    })
  }
  return items
}

async function buildForeshadowCards(db: Db, novelId: string, chapterOrder: number) {
  const rows = await db
    .select({
      id: ForeshadowingTable.id,
      content: ForeshadowingTable.content,
      plantedChapterOrder: ChapterTable.order,
    })
    .from(ForeshadowingTable)
    .leftJoin(ChapterTable, eq(ChapterTable.id, ForeshadowingTable.planted_chapter_id))
    .where(and(eq(ForeshadowingTable.novel_id, novelId), eq(ForeshadowingTable.state, "planted")))
    .all()
  return rows.map(
    (row): Weighted<MemoryForeshadowCard> => ({
      value: { id: row.id, content: row.content, plantedChapterOrder: row.plantedChapterOrder },
      id: row.id,
      score: weightScore(0, row.plantedChapterOrder === null ? null : chapterOrder - row.plantedChapterOrder, 3),
      tokens: estimateTokens(row.content),
    }),
  )
}

async function buildRecentFactCards(db: Db, novelId: string, chapterOrder: number) {
  const windowStart = chapterOrder - RECENT_CHAPTER_WINDOW
  const facts = await db
    .select({
      id: MemoryFactTable.id,
      factType: MemoryFactTable.fact_type,
      text: MemoryFactTable.text,
      quote: MemoryFactTable.quote,
      status: MemoryFactTable.status,
      proofCount: MemoryFactTable.proof_count,
      chapterOrder: ChapterTable.order,
    })
    .from(MemoryFactTable)
    .innerJoin(ChapterTable, eq(ChapterTable.id, MemoryFactTable.chapter_id))
    .where(
      and(
        eq(MemoryFactTable.novel_id, novelId),
        gte(ChapterTable.order, windowStart),
        lt(ChapterTable.order, chapterOrder),
      ),
    )
    .all()
  const CONFIRMATION: Record<string, number> = { approved: 3, reviewed: 2, pending: 1 }
  const items: Weighted<MemoryFactCard>[] = facts.map((fact) => ({
    value: {
      id: fact.id,
      factType: fact.factType,
      text: fact.text,
      quote: fact.quote,
      chapterOrder: fact.chapterOrder,
      status: fact.status,
      proofCount: fact.proofCount,
    },
    id: fact.id,
    score: weightScore(fact.proofCount, chapterOrder - fact.chapterOrder, CONFIRMATION[fact.status] ?? 1),
    tokens: estimateTokens(fact.text + (fact.quote ?? "")),
  }))

  // 新落文设定（establishment 流转到 established 且落文章在窗口内）以事实卡形态并入
  const newCharacters = await db
    .select({ id: CharacterTable.id, name: CharacterTable.name, chapterOrder: ChapterTable.order })
    .from(CharacterTable)
    .innerJoin(ChapterTable, eq(ChapterTable.id, CharacterTable.established_chapter_id))
    .where(
      and(
        eq(CharacterTable.novel_id, novelId),
        eq(CharacterTable.establishment, "established"),
        gte(ChapterTable.order, windowStart),
        lt(ChapterTable.order, chapterOrder),
      ),
    )
    .all()
  const newEntries = await db
    .select({ id: WorldEntryTable.id, title: WorldEntryTable.title, chapterOrder: ChapterTable.order })
    .from(WorldEntryTable)
    .innerJoin(ChapterTable, eq(ChapterTable.id, WorldEntryTable.established_chapter_id))
    .where(
      and(
        eq(WorldEntryTable.novel_id, novelId),
        eq(WorldEntryTable.establishment, "established"),
        gte(ChapterTable.order, windowStart),
        lt(ChapterTable.order, chapterOrder),
      ),
    )
    .all()
  for (const row of [
    ...newCharacters.map((c) => ({ id: `char:${c.id}`, title: c.name, chapterOrder: c.chapterOrder })),
    ...newEntries.map((e) => ({ id: `world:${e.id}`, title: e.title, chapterOrder: e.chapterOrder })),
  ]) {
    const text = `「${row.title}」已在正文落文`
    items.push({
      value: {
        id: row.id,
        factType: "establishment",
        text,
        quote: null,
        chapterOrder: row.chapterOrder,
        status: "approved",
        proofCount: 1,
      },
      id: row.id,
      score: weightScore(0, chapterOrder - row.chapterOrder, 3),
      tokens: estimateTokens(text),
    })
  }
  return items
}

async function buildPlannedSettingCards(db: Db, novelId: string) {
  const characters = await db
    .select({ id: CharacterTable.id, name: CharacterTable.name, description: CharacterTable.description })
    .from(CharacterTable)
    .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.establishment, "planned")))
    .all()
  const entries = await db
    .select({ id: WorldEntryTable.id, title: WorldEntryTable.title, content: WorldEntryTable.content })
    .from(WorldEntryTable)
    .where(and(eq(WorldEntryTable.novel_id, novelId), eq(WorldEntryTable.establishment, "planned")))
    .all()
  return [
    ...characters.map((c): Weighted<MemoryPlannedSettingCard> => {
      const summary = c.description.slice(0, 120)
      return {
        value: { id: c.id, kind: "character", title: c.name, summary },
        id: `char:${c.id}`,
        score: weightScore(0, null, 1),
        tokens: estimateTokens(c.name + summary),
      }
    }),
    ...entries.map((e): Weighted<MemoryPlannedSettingCard> => {
      const summary = e.content.slice(0, 120)
      return {
        value: { id: e.id, kind: "world_entry", title: e.title, summary },
        id: `world:${e.id}`,
        score: weightScore(0, null, 1),
        tokens: estimateTokens(e.title + summary),
      }
    }),
  ]
}

/** 账本条目（Wave 8 写入方落地）：{ chapter: 章节序号, count: 使用次数 } */
function parseUsageLedger(raw: string): Array<{ chapter: number; count: number }> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return []
      if (!("chapter" in entry) || !("count" in entry)) return []
      if (typeof entry.chapter !== "number" || typeof entry.count !== "number") return []
      return [{ chapter: entry.chapter, count: entry.count }]
    })
  } catch {
    return []
  }
}

async function buildTechniqueCards(db: Db, novelId: string, chapterOrder: number) {
  const rows = await db
    .select()
    .from(TechniqueTable)
    .where(
      and(
        eq(TechniqueTable.status, "verified"),
        or(isNull(TechniqueTable.novel_id), eq(TechniqueTable.novel_id, novelId)),
      ),
    )
    .all()
  return rows.map((row): Weighted<MemoryTechniqueCard> => {
    const ledger = parseUsageLedger(row.usage_ledger)
    const recentUses = ledger
      .filter((entry) => chapterOrder - entry.chapter >= 0 && chapterOrder - entry.chapter <= TECHNIQUE_LEDGER_WINDOW)
      .reduce((sum, entry) => sum + entry.count, 0)
    const ledgerSummary =
      recentUses > 0 ? `近${TECHNIQUE_LEDGER_WINDOW}章已用 ${recentUses} 次` : `历史累计 ${row.usage_count} 次`
    return {
      value: {
        id: row.id,
        name: row.name,
        instruction: row.instruction,
        confidence: row.confidence,
        usageCount: row.usage_count,
        ledgerSummary,
      },
      id: row.id,
      score: weightScore(row.usage_count, null, 2),
      tokens: estimateTokens(row.name + row.instruction + ledgerSummary),
    }
  })
}

// ─── 对外入口 ───

export interface BuiltMemoryInjection {
  payload: MemoryInjectionPayload
  budgetUsed: number
}

/**
 * 为目标章（即将起草的章）组装五件套注入包。章节行不存在时返回 null。
 * 纯读、确定性：同一数据库状态必得同一 payload。
 */
export async function buildMemoryInjection(
  db: Db,
  novelId: string,
  chapterId: string,
): Promise<BuiltMemoryInjection | null> {
  const [chapter] = await db
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.id, chapterId), eq(ChapterTable.novel_id, novelId)))
    .limit(1)
    .all()
  if (!chapter) return null
  const chapterOrder = chapter.order

  const characters = pickWithinBudget(await buildCharacterCards(db, novelId, chapterOrder), MEMORY_INJECTION_BUDGET.characters)
  const foreshadows = pickWithinBudget(await buildForeshadowCards(db, novelId, chapterOrder), MEMORY_INJECTION_BUDGET.foreshadows)
  const recentFacts = pickWithinBudget(await buildRecentFactCards(db, novelId, chapterOrder), MEMORY_INJECTION_BUDGET.recentFacts)
  const plannedSettings = pickWithinBudget(await buildPlannedSettingCards(db, novelId), MEMORY_INJECTION_BUDGET.plannedSettings)
  const techniques = pickWithinBudget(await buildTechniqueCards(db, novelId, chapterOrder), MEMORY_INJECTION_BUDGET.techniques)

  return {
    payload: {
      characters: characters.picked,
      foreshadows: foreshadows.picked,
      recentFacts: recentFacts.picked,
      plannedSettings: plannedSettings.picked,
      techniques: techniques.picked,
    },
    budgetUsed: characters.used + foreshadows.used + recentFacts.used + plannedSettings.used + techniques.used,
  }
}

/**
 * 重建目标章的物化注入快照（章审批通过事件触发，见 Wave 6 挂钩）。
 * 写路径 delete+insert 走单事务；payload 在事务外计算（事务回调必须同步）。
 */
export async function rebuildMemoryInjectionSnapshot(db: Db, novelId: string, chapterId: string): Promise<boolean> {
  const built = await buildMemoryInjection(db, novelId, chapterId)
  if (!built) return false
  const payload = JSON.stringify(built.payload)
  withTransaction(db, (tx) => {
    tx
      .delete(MemoryInjectionSnapshotTable)
      .where(
        and(
          eq(MemoryInjectionSnapshotTable.novel_id, novelId),
          eq(MemoryInjectionSnapshotTable.chapter_id, chapterId),
        ),
      )
      .run()
    tx
      .insert(MemoryInjectionSnapshotTable)
      .values({
        novel_id: novelId,
        chapter_id: chapterId,
        payload,
        budget_used: built.budgetUsed,
        built_at: Date.now(),
      })
      .run()
  })
  return true
}

/** 起草开始时一次读快照；缺失或损坏时返回 null（调用方决定降级，不重算） */
export async function readMemoryInjectionSnapshot(
  db: Db,
  novelId: string,
  chapterId: string,
): Promise<MemoryInjectionPayload | null> {
  const [row] = await db
    .select({ payload: MemoryInjectionSnapshotTable.payload })
    .from(MemoryInjectionSnapshotTable)
    .where(
      and(
        eq(MemoryInjectionSnapshotTable.novel_id, novelId),
        eq(MemoryInjectionSnapshotTable.chapter_id, chapterId),
      ),
    )
    .limit(1)
    .all()
  if (!row) return null
  try {
    const parsed: unknown = JSON.parse(row.payload)
    if (typeof parsed !== "object" || parsed === null) return null
    const sections = ["characters", "foreshadows", "recentFacts", "plannedSettings", "techniques"] as const
    if (!sections.every((key) => key in parsed && Array.isArray(parsed[key]))) return null
    return parsed as MemoryInjectionPayload
  } catch {
    return null
  }
}
