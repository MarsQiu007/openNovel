/**
 * 章节写入守卫（write_chapter / revise_chapter 共用）。
 *
 * 从 novel-writer.ts 原样搬入，V1/V2 双入口窗口期共用同一份实现。
 */
import { and, eq, lt } from "drizzle-orm"
import { parseStyleRules } from "../context.js"
import { ChapterTable, getDb, StyleGuideTable } from "../session-store.js"

/**
 * 检测正文中误入的大纲/节拍标签。
 * 这些文字属于创作提纲，不应出现在读者可见正文中；命中则要求 writer 重写。
 */
export function detectOutlineLabels(text: string): string[] {
  const beatLabels = ["开篇钩子", "发展推进", "高潮/转折", "结尾悬念", "场景概要", "出场角色", "字数预估"]
  const samples: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("【") && line.endsWith("】") && beatLabels.some((label) => line.includes(label))) {
      samples.push(line.slice(0, 40))
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      samples.push(line.slice(0, 40))
      continue
    }
    if (/^场景[一二三四五六七八九十百千0-9]+/.test(line)) {
      samples.push(line.slice(0, 40))
      continue
    }
    // 短行的中文编号通常是提纲分节，不是小说正文；避免误杀长句叙事。
    if (/^[一二三四五六七八九十百]+、/.test(line) && line.length <= 40) {
      samples.push(line.slice(0, 40))
      continue
    }
    if (beatLabels.includes(line)) samples.push(line)
  }
  return [...new Set(samples)].slice(0, 5)
}

/**
 * 检测正文中把书籍控制层坐标（第N章/第N卷）当作叙事时间使用的泄漏句式。
 * 仅拦截「记得在第N章」「在第N章的时候」等明确坐标复述，不拦截合法的书中书/元小说场景。
 */
export function detectCoordinateLeak(text: string): string[] {
  const patterns = [
    /记得在第\d+章/g,
    /在第\d+章的时候/g,
    /在第\d+章发生了/g,
  ]
  const samples: string[] = []
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern)
    for (const m of matches) {
      const start = Math.max(0, m.index! - 10)
      const end = Math.min(text.length, m.index! + m[0].length + 10)
      samples.push(text.slice(start, end).trim())
      if (samples.length >= 5) return [...new Set(samples)]
    }
  }
  return [...new Set(samples)].slice(0, 5)
}

/**
 * 读取目标字数下限：style_guide.rules.chapter_length，缺省 2500。
 * write_chapter/revise_chapter 用它做字数门禁——不达标拒绝写入。
 */
/** 篇幅限制容差系数：启用时正文字数必须在目标 ±15% 区间内 */
export const CHAPTER_LENGTH_TOLERANCE = 0.15

/** 读取书籍篇幅限制开关（style_guide.rules.chapter_length_limit === "true"） */
export async function getChapterLengthLimit(db: ReturnType<typeof getDb>, novelId: string): Promise<boolean> {
  const [sg] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).all()
  return parseStyleRules(sg?.rules).chapter_length_limit === "true"
}

/** 章节字数门槛校验：通过返回 null；拒绝返回带 reason 的结果（too_short/too_long） */
export function checkChapterLengthGate(
  toolName: string,
  wordCount: number,
  target: number,
  limit: boolean,
): { title: string; output: string; metadata: { rejected: true; reason: "too_short" | "too_long"; word_count: number; target: number; lower_bound: number; upper_bound: number | null } } | null {
  const lowerBound = limit ? Math.floor(target * (1 - CHAPTER_LENGTH_TOLERANCE)) : target
  const upperBound = limit ? Math.ceil(target * (1 + CHAPTER_LENGTH_TOLERANCE)) : null
  if (wordCount < lowerBound) {
    const rangeText = limit ? `本章篇幅限制区间为 ${lowerBound}–${upperBound} 字` : `本章目标至少 ${target} 字，还差 ${target - wordCount} 字`
    const actionText = toolName === "revise_chapter" ? "请在修订内容中补足字数后重新调用 revise_chapter" : "请扩写正文补足字数后重新调用 write_chapter，不要先写入不足的内容"
    return {
      title: `${toolName}（字数不达标）`,
      output: `字数不足：当前 ${wordCount} 字，${rangeText}。${actionText}。`,
      metadata: { rejected: true, reason: "too_short", word_count: wordCount, target, lower_bound: lowerBound, upper_bound: upperBound },
    }
  }
  if (upperBound != null && wordCount > upperBound) {
    return {
      title: `${toolName}（字数超标）`,
      output: `字数超标：当前 ${wordCount} 字，超出本章篇幅限制上限 ${upperBound} 字（目标 ${target} 的 +15%）。请精炼压缩后重新调用 ${toolName}：优先删除注水内容（重复描写/无意义对话/循环独白），不要砍剧情主线。`,
      metadata: { rejected: true, reason: "too_long", word_count: wordCount, target, lower_bound: lowerBound, upper_bound: upperBound },
    }
  }
  return null
}

export async function getTargetWordCount(db: ReturnType<typeof getDb>, novelId: string): Promise<number> {
  const [sg] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).all()
  const raw = parseStyleRules(sg?.rules).chapter_length
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2500
}

/**
 * 检测文本与前文章节的重复度（两层检测，任一命中即视为重复）。
 *
 * 1. 50 字符窗口（步长 10 采样）：统计本章有多少比例的片段与所有前文章节
 *    字面完全相同——捕捉"照抄"级重复。
 * 2. 本章开头 300 字与每章前文开头的 6-gram Jaccard 相似度：捕捉"重演"级
 *    重复——AI 改写措辞重演同一场景（如议事厅对质）时，字面窗口不命中，
 *    但开头高频片段高度重合。正常续写的新章节开头与前文开头几乎不共享
 *    6-gram（实测 <0.01），而重演场景约 0.10。
 */
export async function checkDuplicateRatio(
  db: ReturnType<typeof getDb>,
  novelId: string,
  content: string,
  chapterOrder: number,
): Promise<{ ratio: number; openingRatio: number; samples: string[]; duplicate: boolean }> {
  const prevChapters = await db
    .select({ order: ChapterTable.order, content: ChapterTable.content })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), lt(ChapterTable.order, chapterOrder)))
    .all()
  const prevContents = prevChapters.map((c) => c.content).filter((c) => c.length > 0)
  if (prevContents.length === 0 || content.length < 50) {
    return { ratio: 0, openingRatio: 0, samples: [], duplicate: false }
  }

  // 1) 50 字符窗口：照抄级重复
  const windowSize = 50
  const step = 10
  const windows = new Set<string>()
  for (let i = 0; i + windowSize <= content.length; i += step) {
    windows.add(content.slice(i, i + windowSize))
  }
  const allPrev = prevContents.join("\n")
  const matched: string[] = []
  for (const w of windows) {
    if (allPrev.includes(w)) matched.push(w)
  }
  const ratio = windows.size > 0 ? matched.length / windows.size : 0

  // 2) 开头 300 字 6-gram Jaccard：场景重演级重复（取与前文章节开头的最大相似度）
  const opening = content.slice(0, 300)
  let openingRatio = 0
  let bestMatchSample = ""
  for (const pc of prevContents) {
    const j = ngramJaccard6(opening, pc.slice(0, 300))
    if (j > openingRatio) {
      openingRatio = j
      bestMatchSample = pc.slice(0, 30)
    }
  }

  const duplicate = ratio > 0.15 || openingRatio > 0.05
  const samples = duplicate
    ? matched.length > 0
      ? matched.slice(0, 3).map((w) => w.slice(0, 30) + "…")
      : [bestMatchSample + "…"]
    : []
  return { ratio, openingRatio, samples, duplicate }
}

/** 6-gram 字符 Jaccard 相似度（用于开头场景重演检测） */
export function ngramJaccard6(a: string, b: string): number {
  const set = (s: string) => {
    const out = new Set<string>()
    for (let i = 0; i + 6 <= s.length; i++) out.add(s.slice(i, i + 6))
    return out
  }
  const A = set(a)
  const B = set(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) {
    if (B.has(x)) inter++
  }
  return inter / (A.size + B.size - inter)
}
