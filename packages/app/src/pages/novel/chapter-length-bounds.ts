/**
 * 章节编辑器字数进度模型（chapter-length-range）。
 *
 * 与 plugin 读取侧 D2 契约同源：先判 trim 空串、Number + isFinite + > 0 + floor、
 * 下限非法回落 2500、上限非法或 ≤ 下限降级 null（禁止裸 Number 派生 UI 值）。
 * 状态判定与 i18n 选键规则：无上限或上限 ≤ 下限退化态永不判 long。
 */

export type ChapterLengthBounds = { lower: number; upper: number | null }

/** 字数下限缺省值，与 plugin 守卫 / 快照组装 / 写作风格编辑器缺省对齐 */
export const DEFAULT_CHAPTER_LOWER = 2500

/** 写作风格 rules → 显式字数上下限（读取侧口径） */
export function parseChapterLengthBounds(rules: Record<string, string> | undefined): ChapterLengthBounds {
  const lowerTrimmed = (rules?.["chapter_length"] ?? "").trim()
  let lower = DEFAULT_CHAPTER_LOWER
  if (lowerTrimmed !== "") {
    const n = Number(lowerTrimmed)
    if (Number.isFinite(n) && n > 0) lower = Math.floor(n)
  }
  const upperTrimmed = (rules?.["chapter_length_max"] ?? "").trim()
  let upper: number | null = null
  if (upperTrimmed !== "") {
    const n = Number(upperTrimmed)
    if (Number.isFinite(n) && n > 0) {
      const parsed = Math.floor(n)
      if (parsed > lower) upper = parsed
    }
  }
  return { lower, upper }
}

export type LengthProgressState = "short" | "good" | "long"

/** 状态判定：低于下限 short；上限有效（> 下限）且超上限 long；其余 good（退化态永不判 long） */
export function lengthProgressState(count: number, lower: number, upper: number | null): LengthProgressState {
  if (count < lower) return "short"
  if (upper != null && upper > lower && count > upper) return "long"
  return "good"
}
