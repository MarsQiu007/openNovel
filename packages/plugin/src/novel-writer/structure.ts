/**
 * 确定性结构检查 — 不依赖 LLM 的结构质量规则
 *
 * 输入 listStructureForEditor 聚合的数据，输出结构风险和覆盖率报告。
 * LLM 负责摘要和建议，本模块只做确定性检查。
 */

export type ArcKind =
  | "setup"
  | "rising"
  | "turn"
  | "midpoint"
  | "crisis"
  | "climax"
  | "resolution"
  | "note"

export type ArcBeatLite = {
  id: string
  arc_id: string
  chapter_id: string | null
  chapter_order: number | null
  kind: string
  status: string
}

export type StoryArcLite = {
  id: string
  arc_type: string
  title: string
  status: string
  planned_start_chapter: number | null
  planned_end_chapter: number | null
  actual_start_chapter: number | null
  actual_end_chapter: number | null
}

export type PlotThreadLite = {
  id: string
  title: string
  status: string
  priority: string
}

export type ForeshadowingLite = {
  id: string
  content: string
  state: string
  planted_chapter_id: string | null
  resolved_chapter_id: string | null
}

export type ChapterLite = {
  id: string
  order: number
  status: string
}

export type StructureIssue = {
  severity: "high" | "medium" | "low"
  category: string
  message: string
  arcId?: string
  chapterId?: string
}

export type StructureReport = {
  issues: StructureIssue[]
  arcCoverage: Array<{
    arcId: string
    arcTitle: string
    hasClimax: boolean
    hasResolution: boolean
    beatCount: number
    plannedRange: { start: number | null; end: number | null }
    actualRange: { start: number | null; end: number | null }
  }>
  openThreadCount: number
  unresolvedForeshadowingCount: number
}

/**
 * 检查结构线是否有高潮和结局节点。
 */
export function checkArcCoverage(
  arcs: StoryArcLite[],
  beats: ArcBeatLite[],
): StructureReport["arcCoverage"] {
  return arcs.map((arc) => {
    const arcBeats = beats.filter((b) => b.arc_id === arc.id)
    const hasClimax = arcBeats.some((b) => b.kind === "climax")
    const hasResolution = arcBeats.some((b) => b.kind === "resolution")
    const actualStart = arcBeats.reduce<number | null>(
      (min, b) => (b.chapter_order != null && (min == null || b.chapter_order < min) ? b.chapter_order : min),
      null,
    )
    const actualEnd = arcBeats.reduce<number | null>(
      (max, b) => (b.chapter_order != null && (max == null || b.chapter_order > max) ? b.chapter_order : max),
      null,
    )
    return {
      arcId: arc.id,
      arcTitle: arc.title,
      hasClimax,
      hasResolution,
      beatCount: arcBeats.length,
      plannedRange: { start: arc.planned_start_chapter, end: arc.planned_end_chapter },
      actualRange: { start: actualStart, end: actualEnd },
    }
  })
}

/**
 * 综合结构检查：弧覆盖、伏笔回收、线索闭合、节奏塌陷。
 */
export function checkStructure(input: {
  arcs: StoryArcLite[]
  beats: ArcBeatLite[]
  threads: PlotThreadLite[]
  foreshadowing: ForeshadowingLite[]
  chapters: ChapterLite[]
}): StructureReport {
  const issues: StructureIssue[] = []
  const coverage = checkArcCoverage(input.arcs, input.beats)

  for (const cov of coverage) {
    if (cov.beatCount === 0 && cov.plannedRange.start != null) {
      issues.push({
        severity: "medium",
        category: "arc_empty",
        message: `结构线「${cov.arcTitle}」已规划但无任何节点`,
        arcId: cov.arcId,
      })
    }
    if (cov.beatCount > 0 && !cov.hasClimax && cov.plannedRange.end != null) {
      const lastChapter = input.chapters.reduce((max, c) => Math.max(max, c.order), 0)
      if (lastChapter >= cov.plannedRange.end) {
        issues.push({
          severity: "high",
          category: "arc_missing_climax",
          message: `结构线「${cov.arcTitle}」已到规划终点但缺少高潮节点`,
          arcId: cov.arcId,
        })
      }
    }
    if (
      cov.actualRange.end != null &&
      cov.plannedRange.end != null &&
      cov.actualRange.end > cov.plannedRange.end + 5
    ) {
      issues.push({
        severity: "medium",
        category: "arc_overrun",
        message: `结构线「${cov.arcTitle}」实际终点(第${cov.actualRange.end}章)超过规划终点(第${cov.plannedRange.end}章)5章以上`,
        arcId: cov.arcId,
      })
    }
  }

  const openThreads = input.threads.filter((t) => t.status === "open")
  const highPriorityOpen = openThreads.filter((t) => t.priority === "high")
  if (highPriorityOpen.length > 3) {
    issues.push({
      severity: "medium",
      category: "too_many_high_priority_threads",
      message: `有 ${highPriorityOpen.length} 条高优先级线索未闭合，可能导致叙事分散`,
    })
  }

  const unresolvedForeshadowing = input.foreshadowing.filter((f) => f.state !== "resolved")
  const plantedChapters = new Set(
    unresolvedForeshadowing.map((f) => f.planted_chapter_id).filter((id): id is string => id != null),
  )
  const chapterOrderMap = new Map(input.chapters.map((c) => [c.id, c.order]))
  for (const fs of unresolvedForeshadowing) {
    if (fs.planted_chapter_id) {
      const plantedOrder = chapterOrderMap.get(fs.planted_chapter_id)
      const lastChapter = input.chapters.reduce((max, c) => Math.max(max, c.order), 0)
      if (plantedOrder != null && lastChapter - plantedOrder > 30) {
        issues.push({
          severity: "medium",
          category: "foreshadowing_stale",
          message: `伏笔「${fs.content}」已超过30章未回收`,
        })
      }
    }
  }

  const completedArcsWithoutResolution = coverage.filter(
    (c) => !c.hasResolution && c.actualRange.end != null,
  )
  for (const cov of completedArcsWithoutResolution) {
    const arc = input.arcs.find((a) => a.id === cov.arcId)
    if (arc?.status === "completed") {
      issues.push({
        severity: "high",
        category: "arc_completed_without_resolution",
        message: `结构线「${cov.arcTitle}」已标记完成但缺少结局节点`,
        arcId: cov.arcId,
      })
    }
  }

  return {
    issues,
    arcCoverage: coverage,
    openThreadCount: openThreads.length,
    unresolvedForeshadowingCount: unresolvedForeshadowing.length,
  }
}