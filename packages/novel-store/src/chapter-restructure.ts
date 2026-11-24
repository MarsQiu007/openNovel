/**
 * 章节结构重切（fixed-split-restructure · design D1-D4）。
 *
 * 面向固定长度兜底分章等不合理边界的确认式修复：方案（按锚点拆分 / 相邻合并 / 改题）
 * 先经 simulateRestructure 纯函数按序模拟校验，应用时 applyRestructureTx 在单事务内
 * 对实时行重跑模拟防漂移，再按「版本快照与正文更新 → 合并删除 → 新章升序落位 → 改题」
 * 写入，全部复用 chapter-sequence 既有原语（relocate/delete/repair）。
 */
import { asc, desc, eq } from "drizzle-orm"
import { countWords } from "@opennovel-ai/schema/schema"
import { ChapterTable, ChapterVersionTable, createChapterTx, getDb } from "./index.js"
import { deleteChapterTx, relocateChaptersTx, repairChapterSequenceTx } from "./chapter-sequence.js"
import { withTransaction, type Tx } from "./tx.js"

// ─── 操作模型（design D1） ───

export type RestructureOp =
  | { op: "split"; chapterId: string; anchor: string; newTitle?: string; key?: string }
  | { op: "merge"; chapterId: string; nextChapterId: string }
  | { op: "retitle"; chapterId: string; title: string }

/** 模拟与实时行共用的章节最小形状。 */
export interface RestructureChapter {
  id: string
  title: string
  content: string
  order: number
  volumeId: string | null
}

export interface RestructurePreviewStep {
  /** 操作在方案中的序号（从 1 开始，供错误与预览定位） */
  index: number
  op: RestructureOp["op"]
  summary: string
  /** 作用章（拆分/改题）或合并目标章；新章为 new:<key> 占位 */
  chapterId: string
  anchorOffset?: number
}

export interface RestructureFinalChapter {
  /** 既有章真实 id；拆分新章为 null */
  sourceId: string | null
  title: string
  content: string
  volumeId: string | null
}

export interface RestructurePlan {
  steps: RestructurePreviewStep[]
  finalChapters: RestructureFinalChapter[]
  /** 被合并删除的既有章 id */
  deletedChapterIds: string[]
  /** 正文被修改的既有章 id（应用时需版本快照） */
  modifiedChapterIds: string[]
  /** 标题被修改的既有章 id */
  retitledChapterIds: string[]
}

export type RestructureSimulation =
  | { ok: true; plan: RestructurePlan }
  | { ok: false; error: { opIndex: number; message: string } }

interface ModelChapter {
  /** 真实章 id 或 new:<key> 占位 */
  id: string
  sourceId: string | null
  title: string
  content: string
  volumeId: string | null
}

const NEW_CHAPTER_PREFIX = "new:"

function simulationError(opIndex: number, message: string): RestructureSimulation {
  return { ok: false, error: { opIndex, message: `第 ${opIndex + 1} 个操作${message}` } }
}

/** 解析操作引用：new:<key> 占位或真实章 id，返回模型下标；未命中返回 -1。 */
function resolveModelIndex(model: ModelChapter[], ref: string): number {
  return model.findIndex((chapter) => chapter.id === ref)
}

/**
 * 重切方案纯函数模拟（design D2）：按序在内存模型上应用操作并逐一校验。
 * 不触碰数据库；预览含锚点偏移与合并删除警示所需的最终统计。
 */
export function simulateRestructure(chapters: RestructureChapter[], ops: RestructureOp[]): RestructureSimulation {
  const model: ModelChapter[] = [...chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({
      id: chapter.id,
      sourceId: chapter.id,
      title: chapter.title,
      content: chapter.content,
      volumeId: chapter.volumeId,
    }))
  const originalContent = new Map(chapters.map((chapter) => [chapter.id, chapter.content]))
  const originalTitle = new Map(chapters.map((chapter) => [chapter.id, chapter.title]))
  const steps: RestructurePreviewStep[] = []
  const deletedChapterIds: string[] = []

  for (const [index, op] of ops.entries()) {
    if (op.op === "split") {
      const at = resolveModelIndex(model, op.chapterId)
      if (at === -1) return simulationError(index, `拆分的章节不存在：${op.chapterId}`)
      if (op.anchor.length === 0) return simulationError(index, "拆分锚点不能为空")
      const chapter = model[at]
      const first = chapter.content.indexOf(op.anchor)
      if (first === -1) return simulationError(index, `拆分锚点在「${chapter.title}」正文中未出现`)
      if (chapter.content.indexOf(op.anchor, first + 1) !== -1)
        return simulationError(index, `拆分锚点在「${chapter.title}」正文中出现多次，无法定位唯一切点`)
      const head = chapter.content.slice(0, first)
      const tail = chapter.content.slice(first)
      if (head.trim().length === 0 || tail.trim().length === 0)
        return simulationError(index, "拆分后两段正文均须非空（锚点不能位于章首或章尾）")
      const placeholder = op.key !== undefined ? `${NEW_CHAPTER_PREFIX}${op.key}` : `${NEW_CHAPTER_PREFIX}op-${index}`
      if (resolveModelIndex(model, placeholder) !== -1)
        return simulationError(index, `拆分新章占位标识重复：${placeholder}`)
      chapter.content = head
      model.splice(at + 1, 0, {
        id: placeholder,
        sourceId: null,
        title: op.newTitle ?? `${chapter.title}（续）`,
        content: tail,
        volumeId: chapter.volumeId,
      })
      steps.push({
        index: index + 1,
        op: "split",
        chapterId: chapter.id,
        anchorOffset: first,
        summary: `拆分「${chapter.title}」：锚点偏移 ${first}，新章「${op.newTitle ?? `${chapter.title}（续）`}」（${countWords(tail)} 字）`,
      })
      continue
    }
    if (op.op === "merge") {
      const at = resolveModelIndex(model, op.chapterId)
      if (at === -1) return simulationError(index, `合并目标章不存在：${op.chapterId}`)
      const nextAt = resolveModelIndex(model, op.nextChapterId)
      if (nextAt === -1) return simulationError(index, `被合并章不存在：${op.nextChapterId}`)
      if (nextAt !== at + 1) return simulationError(index, "合并对象在应用时点必须相邻（被并章须紧随目标章）")
      const target = model[at]
      const source = model[nextAt]
      target.content = `${target.content}\n\n${source.content}`
      model.splice(nextAt, 1)
      if (source.sourceId !== null) deletedChapterIds.push(source.sourceId)
      steps.push({
        index: index + 1,
        op: "merge",
        chapterId: target.id,
        summary: `合并「${source.title}」入「${target.title}」（合并后 ${countWords(target.content)} 字）${source.sourceId !== null ? `；将删除章节 ${source.sourceId}` : ""}`,
      })
      continue
    }
    const at = resolveModelIndex(model, op.chapterId)
    if (at === -1) return simulationError(index, `改题的章节不存在：${op.chapterId}`)
    if (op.title.trim().length === 0) return simulationError(index, "新标题不能为空")
    const chapter = model[at]
    steps.push({ index: index + 1, op: "retitle", chapterId: chapter.id, summary: `改题「${chapter.title}」→「${op.title}」` })
    chapter.title = op.title
  }

  const finalChapters: RestructureFinalChapter[] = model.map((chapter) => ({
    sourceId: chapter.sourceId,
    title: chapter.title,
    content: chapter.content,
    volumeId: chapter.volumeId,
  }))
  const modifiedChapterIds = model.flatMap((chapter) =>
    chapter.sourceId !== null && originalContent.get(chapter.sourceId) !== chapter.content ? [chapter.sourceId] : [],
  )
  const retitledChapterIds = model.flatMap((chapter) =>
    chapter.sourceId !== null && originalTitle.get(chapter.sourceId) !== chapter.title ? [chapter.sourceId] : [],
  )
  return { ok: true, plan: { steps, finalChapters, deletedChapterIds, modifiedChapterIds, retitledChapterIds } }
}

export interface RestructureApplyResult {
  novelId: string
  createdChapterIds: string[]
  deletedChapterIds: string[]
  modifiedChapterIds: string[]
  retitledChapterIds: string[]
  batchCancelled: boolean
}

function loadChapters(tx: Tx, novelId: string): RestructureChapter[] {
  return tx
    .select({
      id: ChapterTable.id,
      title: ChapterTable.title,
      content: ChapterTable.content,
      order: ChapterTable.order,
      volumeId: ChapterTable.volume_id,
    })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .orderBy(asc(ChapterTable.order))
    .all()
}

function nextVersionOf(tx: Tx, chapterId: string): number {
  const latest = tx
    .select({ version: ChapterVersionTable.version })
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, chapterId))
    .orderBy(desc(ChapterVersionTable.version))
    .limit(1)
    .get()
  return (latest?.version ?? 0) + 1
}

/**
 * 重切应用（组合形态，design D3）：实时行重跑模拟防漂移，单事务按
 * 「快照与正文 → 合并删除 → 新章升序落位 → 改题 → 序号安全网」写入。
 */
export function applyRestructureTx(tx: Tx, novelId: string, ops: RestructureOp[]): RestructureApplyResult {
  const chapters = loadChapters(tx, novelId)
  const simulation = simulateRestructure(chapters, ops)
  if (!simulation.ok) throw new Error(`重切方案校验失败：${simulation.error.message}`)
  const { plan } = simulation
  const before = new Map(chapters.map((chapter) => [chapter.id, chapter]))
  const now = Date.now()
  let batchCancelled = false

  for (const final of plan.finalChapters) {
    if (final.sourceId === null) continue
    const original = before.get(final.sourceId)
    if (!original) throw new Error(`重切应用漂移：章节 ${final.sourceId} 已不存在`)
    const contentChanged = original.content !== final.content
    const titleChanged = original.title !== final.title
    if (!contentChanged && !titleChanged) continue
    if (contentChanged) {
      tx.insert(ChapterVersionTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: final.sourceId,
          version: nextVersionOf(tx, final.sourceId),
          content: original.content,
          word_count: countWords(original.content),
          created_at: now,
          created_by: "restructure",
        })
        .run()
    }
    tx.update(ChapterTable)
      .set({
        ...(contentChanged ? { content: final.content, word_count: countWords(final.content) } : {}),
        ...(titleChanged ? { title: final.title } : {}),
        updated_at: now,
      })
      .where(eq(ChapterTable.id, final.sourceId))
      .run()
  }

  for (const chapterId of plan.deletedChapterIds) {
    const deletion = deleteChapterTx(tx, chapterId)
    batchCancelled = batchCancelled || deletion.batchCancelled
  }

  const createdChapterIds: string[] = []
  for (const [position, final] of plan.finalChapters.entries()) {
    if (final.sourceId !== null) continue
    const createdId = createChapterTx(tx, novelId, final.title, undefined, final.volumeId, final.content)
    const relocated = relocateChaptersTx(tx, novelId, { kind: "move", chapterId: createdId, targetOrder: position + 1 })
    batchCancelled = batchCancelled || relocated.batchCancelled
    createdChapterIds.push(createdId)
  }

  repairChapterSequenceTx(tx, novelId)
  return {
    novelId,
    createdChapterIds,
    deletedChapterIds: plan.deletedChapterIds,
    modifiedChapterIds: plan.modifiedChapterIds,
    retitledChapterIds: plan.retitledChapterIds,
    batchCancelled,
  }
}

/** 重切应用（自包形态）：单事务完成，失败整体回滚。 */
export function applyRestructure(
  novelId: string,
  ops: RestructureOp[],
  directory?: string | null,
): RestructureApplyResult {
  return withTransaction(getDb(directory), (tx) => applyRestructureTx(tx, novelId, ops))
}
