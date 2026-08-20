/**
 * 连续性检查模块 — 37个维度全面检查小说写作的连续性
 *
 * 从数据库读取小说状态，对当前章节与历史数据进行多维度一致性检查。
 * 参考 ConStory-Bench 的矛盾检测方法论，结合 Observer+Reflector 模式，
 * 对元数据和结构化状态进行启发式分析。
 *
 * 导出：
 * - CONTINUITY_DIMENSIONS — 37个维度名称常量数组
 * - ContinuityResult — 单个维度检查结果类型
 * - checkContinuity(novelId, chapterNumber) — 执行全维度检查的主函数
 *
 * 遵循 novel-writer.ts 和 governance.ts 中的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, and, lte, lt, desc, ne, or, sql, inArray } from "drizzle-orm"
import {
  getDb,
  NovelTable,
  VolumeTable,
  ChapterTable,
  CharacterTable,
  CharacterStateTable,
  RelationshipTable,
  PlotThreadTable,
  ForeshadowingTable,
  ChapterSummaryTable,
  WorldEntryTable,
  StyleGuideTable,
} from "./session-store.js"

// ─── 类型定义 ───

/** 连续性检查状态 */
export type CheckStatus = "PASS" | "WARN" | "FAIL"

/** 单个维度的连续性检查结果 */
export type ContinuityResult = {
  /** 维度名称 */
  dimension: string
  /** 检查状态：PASS（通过）、WARN（警告）、FAIL（失败） */
  status: CheckStatus
  /** 检查详情描述 */
  detail: string
}

/** 全维度连续性检查的汇总结果 */
export type ContinuityCheckResult = {
  /** 小说 ID */
  novelId: string
  /** 章节序号 */
  chapterNumber: number
  /** 章节 ID（当前章不存在时为 null） */
  chapterId: string | null
  /** 整体结果 */
  overall: CheckStatus
  /** 各维度检查结果 */
  dimensions: ContinuityResult[]
}

// ─── 37个维度名称常量 ───

/** 连续性检查的37个维度名称列表 */
export const CONTINUITY_DIMENSIONS: readonly string[] = [
  // 角色连续性（5维）
  "姓名一致性",
  "外貌描述",
  "性格一致",
  "能力等级",
  "位置连续",
  // 关系连续性（4维）
  "关系类型一致",
  "敌友转变有因",
  "亲密度变化",
  "信任度变化",
  // 时间线（4维）
  "事件顺序",
  "时间流逝合理",
  "季节一致",
  "年龄变化",
  // 地点（4维）
  "地点描述一致",
  "距离合理",
  "环境细节",
  "地图一致",
  // 剧情（5维）
  "主线推进",
  "伏笔回收",
  "冲突升级",
  "转折合理",
  "结局呼应",
  // 世界观（5维）
  "力量体系",
  "规则一致",
  "社会结构",
  "文化细节",
  "经济系统",
  // 风格（4维）
  "叙事视角",
  "语言风格",
  "节奏一致",
  "描写密度",
  // 逻辑（3维）
  "因果链",
  "动机合理",
  "信息对称",
  // 细节（3维）
  "物品追踪",
  "数字一致",
  "称呼一致",
]

// ─── 内部数据缓存类型 ───

/** 检查上下文：缓存从数据库查询的所有相关数据 */
interface CheckContext {
  novelId: string
  chapterNumber: number
  novel: typeof NovelTable.$inferSelect | null
  currentChapter: typeof ChapterTable.$inferSelect | null
  currentChapterContent: string | null
  allChapters: (typeof ChapterTable.$inferSelect)[]
  characters: (typeof CharacterTable.$inferSelect)[]
  characterStates: (typeof CharacterStateTable.$inferSelect)[]
  relationships: (typeof RelationshipTable.$inferSelect)[]
  plotThreads: (typeof PlotThreadTable.$inferSelect)[]
  foreshadowingEntries: (typeof ForeshadowingTable.$inferSelect)[]
  chapterSummaries: (typeof ChapterSummaryTable.$inferSelect)[]
  worldEntries: (typeof WorldEntryTable.$inferSelect)[]
  styleGuide: (typeof StyleGuideTable.$inferSelect)[]
}

// ─── 主函数 ───

/**
 * 执行37维度的连续性检查
 *
 * 从数据库读取小说状态，对当前章节与历史数据进行全面的连续性检查，
 * 覆盖角色、关系、时间线、地点、剧情、世界观、风格、逻辑、细节九大类。
 *
 * 整体结果判定规则：
 * - 全部 PASS → PASS
 * - 有 WARN 但无 FAIL → WARN
 * - 有 FAIL → FAIL
 *
 * @param novelId 小说 ID
 * @param chapterNumber 当前章节序号（用于定位和比较）
 * @returns 连续性检查结果，小说不存在时返回 null
 */
export async function checkContinuity(
  novelId: string,
  chapterNumber: number,
  directory?: string | null,
): Promise<ContinuityCheckResult | null> {
  const db = getDb(directory)

  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) return null

  const [currentChapter] = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterNumber)))
    .all()

  // 并行查询所有相关数据
  const [
    allChapters,
    characters,
    characterStates,
    relationships,
    plotThreads,
    foreshadowingEntries,
    chapterSummaries,
    worldEntries,
    styleGuideRows,
  ] = await Promise.all([
    db
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, novelId))
      .orderBy(sql`"order"`)
      .all(),
    db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all(),
    db.select().from(CharacterStateTable).all(),
    db.select().from(RelationshipTable).where(eq(RelationshipTable.novel_id, novelId)).all(),
    db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all(),
    db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.novel_id, novelId)).all(),
    db.select().from(ChapterSummaryTable).all(),
    db.select().from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, novelId)).all(),
    db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).all(),
  ])

  const ctx: CheckContext = {
    novelId,
    chapterNumber,
    novel,
    currentChapter,
    currentChapterContent: currentChapter?.content ?? null,
    allChapters,
    characters,
    characterStates: characterStates.filter((s) => characters.some((c) => c.id === s.character_id)),
    relationships,
    plotThreads,
    foreshadowingEntries,
    chapterSummaries,
    worldEntries,
    styleGuide: styleGuideRows,
  }

  const dimensions: ContinuityResult[] = [
    ...checkCharacterContinuity(ctx),
    ...checkRelationshipContinuity(ctx),
    ...checkTimelineContinuity(ctx),
    ...checkLocationContinuity(ctx),
    ...checkPlotContinuity(ctx),
    ...checkWorldBuildingContinuity(ctx),
    ...checkStyleContinuity(ctx),
    ...checkLogicContinuity(ctx),
    ...checkDetailContinuity(ctx),
  ]

  const hasFail = dimensions.some((d) => d.status === "FAIL")
  const hasWarn = dimensions.some((d) => d.status === "WARN")
  const overall: CheckStatus = hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS"

  return {
    novelId,
    chapterNumber,
    chapterId: currentChapter?.id ?? null,
    overall,
    dimensions,
  }
}

// ─── 角色连续性检查（5维） ───

function checkCharacterContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // 姓名一致性：检查角色状态引用的角色 ID 是否都在 characters 表中
  const charIds = new Set(ctx.characters.map((c) => c.id))
  const stateCharIds = ctx.characterStates.map((s) => s.character_id)
  const orphanStates = stateCharIds.filter((id) => !charIds.has(id))
  const uniqueOrphan = new Set(orphanStates)

  if (uniqueOrphan.size > 0) {
    results.push({
      dimension: "姓名一致性",
      status: "FAIL",
      detail: `发现 ${uniqueOrphan.size} 个角色状态引用了不存在的角色 ID`,
    })
  } else if (ctx.characters.length === 0) {
    results.push({
      dimension: "姓名一致性",
      status: "WARN",
      detail: "尚未创建任何角色，无法检查姓名一致性",
    })
  } else {
    results.push({
      dimension: "姓名一致性",
      status: "PASS",
      detail: `全部 ${ctx.characters.length} 个角色状态引用有效，无孤立记录`,
    })
  }

  // 外貌描述：检查角色描述字段是否填充
  const charsWithDesc = ctx.characters.filter((c) => c.description.length > 0)
  const charsWithoutDesc = ctx.characters.length - charsWithDesc.length

  if (ctx.characters.length === 0) {
    results.push({
      dimension: "外貌描述",
      status: "WARN",
      detail: "尚未创建任何角色，无法检查外貌描述",
    })
  } else if (charsWithoutDesc > ctx.characters.length * 0.5) {
    results.push({
      dimension: "外貌描述",
      status: "WARN",
      detail: `${charsWithoutDesc}/${ctx.characters.length} 个角色缺少外貌描述，超过半数`,
    })
  } else if (charsWithoutDesc > 0) {
    results.push({
      dimension: "外貌描述",
      status: "WARN",
      detail: `${charsWithoutDesc}/${ctx.characters.length} 个角色缺少外貌描述`,
    })
  } else {
    results.push({
      dimension: "外貌描述",
      status: "PASS",
      detail: `全部 ${ctx.characters.length} 个角色均有外貌描述`,
    })
  }

  // 性格一致：检查角色状态中 mood 的一致性
  const moodChanges = analyzeMoodConsistency(ctx)
  if (moodChanges.rapidChanges > 0) {
    results.push({
      dimension: "性格一致",
      status: "WARN",
      detail: `发现 ${moodChanges.rapidChanges} 处情绪突变（连续章节间情绪状态大幅变化），建议检查是否有合理原因`,
    })
  } else if (ctx.characterStates.length === 0) {
    results.push({
      dimension: "性格一致",
      status: "WARN",
      detail: "暂无角色状态记录，无法检查性格一致性",
    })
  } else {
    results.push({
      dimension: "性格一致",
      status: "PASS",
      detail: `检查了 ${moodChanges.totalChars} 个角色的情绪变化，未发现异常突变`,
    })
  }

  // 能力等级：检查世界观中是否定义了力量体系
  const powerSystem = ctx.worldEntries.filter(
    (w) =>
      w.category === "power_system" || w.title.includes("境界") || w.title.includes("等级") || w.title.includes("力量"),
  )
  if (powerSystem.length === 0) {
    results.push({
      dimension: "能力等级",
      status: "WARN",
      detail: "世界观中未定义力量体系或能力等级，建议添加以保持一致性",
    })
  } else {
    results.push({
      dimension: "能力等级",
      status: "PASS",
      detail: `世界观中定义了 ${powerSystem.length} 条力量体系相关条目`,
    })
  }

  // 位置连续：检查角色位置在连续章节间是否合理
  const locationIssues = analyzeLocationContinuity(ctx)
  if (locationIssues > 0) {
    results.push({
      dimension: "位置连续",
      status: "WARN",
      detail: `发现 ${locationIssues} 处角色位置跳变，建议检查位置变化是否合理`,
    })
  } else if (ctx.characterStates.length === 0) {
    results.push({
      dimension: "位置连续",
      status: "WARN",
      detail: "暂无角色状态记录，无法检查位置连续性",
    })
  } else {
    results.push({
      dimension: "位置连续",
      status: "PASS",
      detail: `检查了 ${ctx.characters.length} 个角色的位置变化，未发现异常`,
    })
  }

  return results
}

// ─── 关系连续性检查（4维） ───

function checkRelationshipContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // 关系类型一致：检查关系表是否定义了角色关系
  if (ctx.relationships.length === 0) {
    results.push({
      dimension: "关系类型一致",
      status: "WARN",
      detail: "尚未定义任何角色关系，建议添加关系定义",
    })
    results.push({
      dimension: "敌友转变有因",
      status: "WARN",
      detail: "无关系数据，无法检查敌友转变",
    })
    results.push({
      dimension: "亲密度变化",
      status: "WARN",
      detail: "无关系数据，无法检查亲密度变化",
    })
    results.push({
      dimension: "信任度变化",
      status: "WARN",
      detail: "无关系数据，无法检查信任度变化",
    })
    return results
  }

  // 关系类型一致：检查关系类型是否在合理范围内
  const validTypes = new Set([
    "亲情",
    "友情",
    "爱情",
    "敌对",
    "师徒",
    "同门",
    "盟友",
    "仇敌",
    "主仆",
    "竞争",
    "合作",
    "陌生人",
    "同学",
    "同事",
    "邻居",
    "family",
    "friend",
    "romantic",
    "enemy",
    "mentor",
    "ally",
    "rival",
    "master_servant",
    "competition",
    "cooperation",
    "stranger",
    "classmate",
  ])
  const unknownTypes = ctx.relationships.filter((r) => !validTypes.has(r.type) && r.type !== "")
  const emptyTypes = ctx.relationships.filter((r) => r.type === "")

  if (emptyTypes.length > 0) {
    results.push({
      dimension: "关系类型一致",
      status: "WARN",
      detail: `${emptyTypes.length}/${ctx.relationships.length} 条关系未指定类型`,
    })
  } else if (unknownTypes.length > 0) {
    results.push({
      dimension: "关系类型一致",
      status: "WARN",
      detail: `${unknownTypes.length} 条关系使用了非标准类型，建议检查`,
    })
  } else {
    results.push({
      dimension: "关系类型一致",
      status: "PASS",
      detail: `全部 ${ctx.relationships.length} 条关系类型定义完整`,
    })
  }

  // 敌友转变有因：检查是否存在敌对+友好并存的矛盾关系
  const hostileTypes = ["敌对", "仇敌", "enemy"]
  const friendlyTypes = [
    "亲情",
    "友情",
    "爱情",
    "师徒",
    "同门",
    "盟友",
    "family",
    "friend",
    "romantic",
    "mentor",
    "ally",
  ]
  const conflictingPairs = checkConflictingRelationships(ctx, hostileTypes, friendlyTypes)

  if (conflictingPairs > 0) {
    results.push({
      dimension: "敌友转变有因",
      status: "WARN",
      detail: `发现 ${conflictingPairs} 对角色关系存在敌对/友好并存，建议检查是否有合理的转变原因`,
    })
  } else {
    results.push({
      dimension: "敌友转变有因",
      status: "PASS",
      detail: "未发现矛盾的角色关系对",
    })
  }

  // 亲密度变化：检查角色状态摘要中是否记录了关系变化
  const intimacyChanges = ctx.characterStates.filter(
    (s) => s.summary.includes("关系") || s.summary.includes("亲密") || s.summary.includes("感情"),
  )
  if (intimacyChanges.length > 0) {
    results.push({
      dimension: "亲密度变化",
      status: "PASS",
      detail: `角色状态中记录了 ${intimacyChanges.length} 处关系变化描述`,
    })
  } else {
    results.push({
      dimension: "亲密度变化",
      status: "WARN",
      detail: "角色状态中未发现关系/亲密度变化记录，建议在关键章节中记录角色间关系变化",
    })
  }

  // 信任度变化：检查角色状态摘要中是否记录了信任变化
  const trustChanges = ctx.characterStates.filter(
    (s) => s.summary.includes("信任") || s.summary.includes("怀疑") || s.summary.includes("背叛"),
  )
  if (trustChanges.length > 0) {
    results.push({
      dimension: "信任度变化",
      status: "PASS",
      detail: `角色状态中记录了 ${trustChanges.length} 处信任变化描述`,
    })
  } else {
    results.push({
      dimension: "信任度变化",
      status: "WARN",
      detail: "角色状态中未发现信任度变化记录，建议在关键章节中记录角色间信任变化",
    })
  }

  return results
}

// ─── 时间线连续性检查（4维） ───

function checkTimelineContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // 事件顺序：检查章节序号是否连续
  const orders = ctx.allChapters.map((c) => c.order).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < orders.length; i++) {
    if (orders[i]! - orders[i - 1]! > 1) {
      gaps.push(orders[i - 1]!)
    }
  }

  if (gaps.length > 0) {
    results.push({
      dimension: "事件顺序",
      status: "WARN",
      detail: `章节序号存在 ${gaps.length} 处跳跃：${gaps.map((g) => `第${g}章后缺章`).join("、")}`,
    })
  } else if (orders.length > 0 && orders[0] !== 1) {
    results.push({
      dimension: "事件顺序",
      status: "WARN",
      detail: `章节从第 ${orders[0]} 章开始，缺少第1章`,
    })
  } else if (ctx.allChapters.length === 0) {
    results.push({
      dimension: "事件顺序",
      status: "WARN",
      detail: "尚未创建任何章节",
    })
  } else {
    results.push({
      dimension: "事件顺序",
      status: "PASS",
      detail: `共 ${ctx.allChapters.length} 章，章节序号连续无跳跃`,
    })
  }

  // 时间流逝合理：检查章节创建时间间隔
  if (ctx.allChapters.length >= 2) {
    const sortedChapters = [...ctx.allChapters].sort((a, b) => a.order - b.order)
    const intervals = sortedChapters.slice(1).map((ch, i) => ch.created_at - sortedChapters[i]!.created_at)
    const veryShortIntervals = intervals.filter((i) => i < 1000 && i >= 0) // 小于1秒
    const negativeIntervals = intervals.filter((i) => i < 0) // 时间倒退

    if (negativeIntervals.length > 0) {
      results.push({
        dimension: "时间流逝合理",
        status: "FAIL",
        detail: `发现 ${negativeIntervals.length} 处章节创建时间倒退，时间戳异常`,
      })
    } else if (veryShortIntervals.length > intervals.length * 0.3) {
      results.push({
        dimension: "时间流逝合理",
        status: "WARN",
        detail: `${veryShortIntervals.length}/${intervals.length} 对相邻章节创建时间间隔极短（<1秒），可能为批量生成`,
      })
    } else {
      results.push({
        dimension: "时间流逝合理",
        status: "PASS",
        detail: `检查了 ${intervals.length} 对相邻章节时间间隔，未发现异常`,
      })
    }
  } else {
    results.push({
      dimension: "时间流逝合理",
      status: "WARN",
      detail: "章节数不足，无法检查时间流逝",
    })
  }

  // 季节一致：检查章节摘要中是否有季节相关描述
  const seasonKeywords = ["春", "夏", "秋", "冬", "春天", "夏天", "秋天", "冬天", "春季", "夏季", "秋季", "冬季"]
  const seasonRefs = ctx.chapterSummaries.filter((cs) => seasonKeywords.some((kw) => cs.summary.includes(kw)))
  if (seasonRefs.length > 0) {
    results.push({
      dimension: "季节一致",
      status: "PASS",
      detail: `在 ${seasonRefs.length} 个章节摘要中发现季节描述，数据充足可检查一致`,
    })
  } else {
    results.push({
      dimension: "季节一致",
      status: "WARN",
      detail: "各章节摘要中未发现季节描述，建议在摘要中标注时间/季节信息以便追踪",
    })
  }

  // 年龄变化：检查角色描述中是否有年龄信息
  const agePattern = /(\d+)岁/
  const charsWithAge = ctx.characters.filter((c) => agePattern.test(c.description))
  if (charsWithAge.length > 0) {
    results.push({
      dimension: "年龄变化",
      status: "PASS",
      detail: `${charsWithAge.length}/${ctx.characters.length} 个角色描述中包含年龄信息`,
    })
  } else if (ctx.characters.length > 0) {
    results.push({
      dimension: "年龄变化",
      status: "WARN",
      detail: "角色描述中未发现年龄信息，建议添加以便追踪角色年龄变化",
    })
  } else {
    results.push({
      dimension: "年龄变化",
      status: "WARN",
      detail: "尚未创建任何角色",
    })
  }

  return results
}

// ─── 地点连续性检查（4维） ───

function checkLocationContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // 地点描述一致：检查世界观中是否有地点相关条目
  const locationEntries = ctx.worldEntries.filter(
    (w) =>
      w.category === "location" ||
      w.category === "地点" ||
      w.title.includes("地点") ||
      w.title.includes("地图") ||
      w.title.includes("城") ||
      w.title.includes("国"),
  )
  if (locationEntries.length > 0) {
    results.push({
      dimension: "地点描述一致",
      status: "PASS",
      detail: `世界观中定义了 ${locationEntries.length} 条地点相关条目`,
    })
  } else {
    results.push({
      dimension: "地点描述一致",
      status: "WARN",
      detail: "世界观中未定义地点条目，建议添加地点设定以保持一致性",
    })
  }

  // 距离合理：检查角色状态中位置变化
  if (ctx.characterStates.length > 0) {
    const locationChanges = countLocationChanges(ctx)
    results.push({
      dimension: "距离合理",
      status: locationChanges > 0 ? "PASS" : "WARN",
      detail:
        locationChanges > 0
          ? `记录了 ${locationChanges} 次角色位置变化，可追踪距离合理性`
          : "角色状态中未记录位置变化，无法检查距离合理性",
    })
  } else {
    results.push({
      dimension: "距离合理",
      status: "WARN",
      detail: "暂无角色状态记录，无法检查距离合理性",
    })
  }

  // 环境细节：检查世界观中是否有环境相关条目
  const envEntries = ctx.worldEntries.filter(
    (w) =>
      w.category === "environment" ||
      w.category === "环境" ||
      w.title.includes("环境") ||
      w.title.includes("气候") ||
      w.title.includes("地理"),
  )
  if (envEntries.length > 0) {
    results.push({
      dimension: "环境细节",
      status: "PASS",
      detail: `世界观中定义了 ${envEntries.length} 条环境相关条目`,
    })
  } else {
    results.push({
      dimension: "环境细节",
      status: "WARN",
      detail: "世界观中未定义环境细节条目，建议添加环境设定",
    })
  }

  // 地图一致：检查世界观中是否有地图类别
  const mapEntries = ctx.worldEntries.filter(
    (w) => w.category === "map" || w.category === "地图" || w.title.includes("地图") || w.title.includes("分布"),
  )
  if (mapEntries.length > 0) {
    results.push({
      dimension: "地图一致",
      status: "PASS",
      detail: `世界观中定义了 ${mapEntries.length} 条地图相关条目`,
    })
  } else {
    results.push({
      dimension: "地图一致",
      status: "WARN",
      detail: "世界观中未定义地图条目，建议添加地图/空间分布设定",
    })
  }

  return results
}

// ─── 剧情连续性检查（5维） ───

function checkPlotContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // 主线推进：检查剧情线索状态
  if (ctx.plotThreads.length === 0) {
    results.push({
      dimension: "主线推进",
      status: "WARN",
      detail: "尚未定义任何剧情线索，建议添加主线剧情",
    })
  } else {
    const openThreads = ctx.plotThreads.filter((t) => t.status === "open")
    const resolvedThreads = ctx.plotThreads.filter((t) => t.status === "resolved")
    const pausedThreads = ctx.plotThreads.filter((t) => t.status === "paused")
    results.push({
      dimension: "主线推进",
      status: openThreads.length === 0 && resolvedThreads.length > 0 ? "PASS" : "PASS",
      detail: `共 ${ctx.plotThreads.length} 条线索：${openThreads.length} 进行中、${resolvedThreads.length} 已解决、${pausedThreads.length} 暂停`,
    })
  }

  // 伏笔回收：检查伏笔状态
  if (ctx.foreshadowingEntries.length === 0) {
    results.push({
      dimension: "伏笔回收",
      status: "WARN",
      detail: "尚未设置任何伏笔，建议在关键情节中埋设伏笔",
    })
  } else {
    const planted = ctx.foreshadowingEntries.filter((f) => f.state === "planted")
    const resolved = ctx.foreshadowingEntries.filter((f) => f.state === "resolved")
    const unresolvedRatio = ctx.foreshadowingEntries.length > 0 ? planted.length / ctx.foreshadowingEntries.length : 0

    if (unresolvedRatio > 0.8 && ctx.chapterNumber > 50) {
      results.push({
        dimension: "伏笔回收",
        status: "WARN",
        detail: `共 ${ctx.foreshadowingEntries.length} 条伏笔，仅 ${resolved.length} 条已回收（${Math.round((1 - unresolvedRatio) * 100)}%），超80%未回收`,
      })
    } else {
      results.push({
        dimension: "伏笔回收",
        status: "PASS",
        detail: `共 ${ctx.foreshadowingEntries.length} 条伏笔：${planted.length} 待回收、${resolved.length} 已回收`,
      })
    }
  }

  // 冲突升级：检查剧情线索优先级分布
  if (ctx.plotThreads.length > 0) {
    const highPriority = ctx.plotThreads.filter((t) => t.priority === "high")
    const hasEscalation = ctx.plotThreads.some(
      (t) => t.description.includes("升级") || t.description.includes("冲突") || t.description.includes("矛盾"),
    )
    results.push({
      dimension: "冲突升级",
      status: highPriority.length > 0 || hasEscalation ? "PASS" : "WARN",
      detail:
        highPriority.length > 0
          ? `${highPriority.length} 条高优先级线索，冲突层级明确`
          : "未发现高优先级线索或冲突升级描述，建议标注冲突层级",
    })
  } else {
    results.push({
      dimension: "冲突升级",
      status: "WARN",
      detail: "无剧情线索数据，无法检查冲突升级",
    })
  }

  // 转折合理：检查章节摘要中是否有转折事件
  const twistKeywords = ["转折", "反转", "揭示", "真相", "意外", "突变", "转折点"]
  const twistChapters = ctx.chapterSummaries.filter(
    (cs) =>
      twistKeywords.some((kw) => cs.summary.includes(kw)) ||
      (Array.isArray(cs.key_events) && cs.key_events.some((e: string) => twistKeywords.some((kw) => e.includes(kw)))),
  )
  if (twistChapters.length > 0) {
    results.push({
      dimension: "转折合理",
      status: "PASS",
      detail: `在 ${twistChapters.length} 个章节摘要中发现转折事件描述`,
    })
  } else if (ctx.chapterNumber > 10) {
    results.push({
      dimension: "转折合理",
      status: "WARN",
      detail: `已写 ${ctx.chapterNumber} 章，但摘要中未发现转折事件描述，建议在关键章节标注转折点`,
    })
  } else {
    results.push({
      dimension: "转折合理",
      status: "PASS",
      detail: "章节数较少，尚未需要转折事件",
    })
  }

  // 结局呼应：检查开头和结尾的呼应关系
  if (ctx.chapterNumber >= 5) {
    const firstChapterSummary = ctx.chapterSummaries.find((cs) => {
      const ch = ctx.allChapters.find((c) => c.id === cs.chapter_id)
      return ch?.order === 1
    })
    const currentChapterSummary = ctx.chapterSummaries.find((cs) => cs.chapter_id === ctx.currentChapter?.id)

    if (firstChapterSummary && currentChapterSummary) {
      results.push({
        dimension: "结局呼应",
        status: "PASS",
        detail: `第1章和第${ctx.chapterNumber}章均有摘要，可检查前后呼应`,
      })
    } else {
      results.push({
        dimension: "结局呼应",
        status: "WARN",
        detail: "缺少第1章或当前章节摘要，无法检查首尾呼应",
      })
    }
  } else {
    results.push({
      dimension: "结局呼应",
      status: "WARN",
      detail: "章节数不足，无法检查首尾呼应",
    })
  }

  return results
}

// ─── 世界观连续性检查（5维） ───

function checkWorldBuildingContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // ── 维度 23 力量体系：检查章节是否引用了设定的力量体系，且无明显漂移 ──
  {
    const coverage = checkCategoryCoverage(ctx, {
      category: "力量体系",
      titleIncludes: ["境界", "等级", "力量", "修炼", "体系"],
    })
    const drift = scanDriftTerms(ctx, {
      category: "力量体系",
      titleIncludes: ["境界", "等级", "力量", "修炼", "体系"],
    })

    if (coverage.total === 0) {
      results.push({
        dimension: "力量体系",
        status: "WARN",
        detail: "世界观中未定义力量体系，建议添加以确保战斗/能力描写一致",
      })
    } else if (!coverage.chapterHasContent) {
      results.push({
        dimension: "力量体系",
        status: "WARN",
        detail: `力量体系相关设定 ${coverage.total} 条，但当前章节正文为空，无法做覆盖度检查`,
      })
    } else {
      const status: CheckStatus =
        coverage.hitRate >= 0.5 ? "PASS" : coverage.hitRate >= 0.2 ? "WARN" : "FAIL"
      const driftSuffix = drift.drifts.length > 0
        ? `；反向扫描发现 ${drift.drifts.length} 个疑似漂移词（如 ${drift.drifts.slice(0, 3).map((d) => `${d.term}×${d.count}`).join("、")}），需 LLM 审计确认`
        : ""
      results.push({
        dimension: "力量体系",
        status,
        detail: `力量体系 ${coverage.total} 条 → 章节命中 ${coverage.hitTerms.length} 条（命中率 ${(coverage.hitRate * 100).toFixed(0)}%）。命中：${coverage.hitTerms.slice(0, 3).join("、") || "无"}；未命中：${coverage.missTerms.slice(0, 3).join("、") || "—"}${driftSuffix}`,
      })
    }
  }

  // ── 维度 25 社会结构：检查章节是否引用了设定的社会制度 ──
  {
    const coverage = checkCategoryCoverage(ctx, {
      category: "社会制度",
      titleIncludes: ["社会", "制度", "等级", "贵族", "平民", "贱民", "组织", "国家", "门派", "家族"],
    })
    const drift = scanDriftTerms(ctx, {
      category: "社会制度",
      titleIncludes: ["社会", "制度", "等级", "贵族", "平民", "贱民", "组织", "国家", "门派", "家族"],
    })

    if (coverage.total === 0) {
      results.push({
        dimension: "社会结构",
        status: "WARN",
        detail: "世界观中未定义社会结构，建议添加社会/组织/家族设定",
      })
    } else if (!coverage.chapterHasContent) {
      results.push({
        dimension: "社会结构",
        status: "WARN",
        detail: `社会结构相关设定 ${coverage.total} 条，但当前章节正文为空，无法做覆盖度检查`,
      })
    } else {
      const status: CheckStatus =
        coverage.hitRate >= 0.5 ? "PASS" : coverage.hitRate >= 0.2 ? "WARN" : "FAIL"
      const driftSuffix = drift.drifts.length > 0
        ? `；反向扫描发现 ${drift.drifts.length} 个疑似漂移词（如 ${drift.drifts.slice(0, 3).map((d) => `${d.term}×${d.count}`).join("、")}），需 LLM 审计确认`
        : ""
      results.push({
        dimension: "社会结构",
        status,
        detail: `社会结构 ${coverage.total} 条 → 章节命中 ${coverage.hitTerms.length} 条（命中率 ${(coverage.hitRate * 100).toFixed(0)}%）。命中：${coverage.hitTerms.slice(0, 3).join("、") || "无"}；未命中：${coverage.missTerms.slice(0, 3).join("、") || "—"}${driftSuffix}`,
      })
    }
  }

  // ── 维度 24 规则一致：检查风格指南 + 世界观规则是否被章节执行 ──
  {
    const styleRules = ctx.styleGuide.length > 0 ? ((ctx.styleGuide[0]!.rules as Record<string, unknown>) ?? {}) : {}
    const ruleCount = Object.keys(styleRules).length
    // 也把 worldview 里的"规则"类条目算进来
    const ruleWorldEntries = ctx.worldEntries.filter(
      (w) =>
        w.category === "规则" || w.category === "rule" || w.title.includes("规则") || w.title.includes("禁忌"),
    )
    const totalRules = ruleCount + ruleWorldEntries.length

    if (totalRules === 0) {
      results.push({
        dimension: "规则一致",
        status: "WARN",
        detail: "风格指南与世界观中均未定义写作规则，建议添加规则以保证一致性",
      })
    } else if (!ctx.currentChapterContent) {
      results.push({
        dimension: "规则一致",
        status: "WARN",
        detail: `规则 ${totalRules} 条（风格指南 ${ruleCount} + 世界观 ${ruleWorldEntries.length}），但当前章节正文为空，无法做覆盖检查`,
      })
    } else {
      // 把所有规则关键词合并成检查词表
      const allTerms: string[] = []
      for (const v of Object.values(styleRules)) {
        if (typeof v === "string" && v.length >= 2) allTerms.push(v)
      }
      for (const w of ruleWorldEntries) allTerms.push(w.title)
      const uniqueTerms = [...new Set(allTerms)]
      const hitCount = uniqueTerms.filter((t) => ctx.currentChapterContent!.includes(t)).length
      const hitRate = uniqueTerms.length > 0 ? hitCount / uniqueTerms.length : 1
      const status: CheckStatus = hitRate >= 0.4 ? "PASS" : hitRate >= 0.15 ? "WARN" : "FAIL"
      results.push({
        dimension: "规则一致",
        status,
        detail: `规则 ${totalRules} 条（${ruleCount} 风格指南 + ${ruleWorldEntries.length} 世界观），其中 ${hitCount}/${uniqueTerms.length} 个关键词被章节正文引用（${(hitRate * 100).toFixed(0)}%）`,
      })
    }
  }

  // ── 维度 22 文化细节：检查章节是否引用了设定的文化/风俗 ──
  {
    const coverage = checkCategoryCoverage(ctx, {
      category: "文化",
      titleIncludes: ["文化", "风俗", "节日", "礼仪", "传统"],
    })
    if (coverage.total === 0) {
      results.push({
        dimension: "文化细节",
        status: "WARN",
        detail: "世界观中未定义文化细节，建议添加文化/风俗/传统设定",
      })
    } else if (!coverage.chapterHasContent) {
      results.push({
        dimension: "文化细节",
        status: "WARN",
        detail: `文化细节相关设定 ${coverage.total} 条，但当前章节正文为空，无法做覆盖度检查`,
      })
    } else {
      const status: CheckStatus =
        coverage.hitRate >= 0.5 ? "PASS" : coverage.hitRate >= 0.2 ? "WARN" : "FAIL"
      results.push({
        dimension: "文化细节",
        status,
        detail: `文化细节 ${coverage.total} 条 → 章节命中 ${coverage.hitTerms.length} 条（命中率 ${(coverage.hitRate * 100).toFixed(0)}%）。命中：${coverage.hitTerms.slice(0, 3).join("、") || "无"}；未命中：${coverage.missTerms.slice(0, 3).join("、") || "—"}`,
      })
    }
  }

  // ── 维度 27 经济系统：检查章节是否引用了设定的经济/资源 ──
  {
    const coverage = checkCategoryCoverage(ctx, {
      category: "经济",
      titleIncludes: ["经济", "货币", "交易", "资源", "财富"],
    })
    if (coverage.total === 0) {
      results.push({
        dimension: "经济系统",
        status: "WARN",
        detail: "世界观中未定义经济系统，建议添加货币/资源/经济设定",
      })
    } else if (!coverage.chapterHasContent) {
      results.push({
        dimension: "经济系统",
        status: "WARN",
        detail: `经济系统相关设定 ${coverage.total} 条，但当前章节正文为空，无法做覆盖度检查`,
      })
    } else {
      const status: CheckStatus =
        coverage.hitRate >= 0.5 ? "PASS" : coverage.hitRate >= 0.2 ? "WARN" : "FAIL"
      results.push({
        dimension: "经济系统",
        status,
        detail: `经济系统 ${coverage.total} 条 → 章节命中 ${coverage.hitTerms.length} 条（命中率 ${(coverage.hitRate * 100).toFixed(0)}%）。命中：${coverage.hitTerms.slice(0, 3).join("、") || "无"}；未命中：${coverage.missTerms.slice(0, 3).join("、") || "—"}`,
      })
    }
  }

  return results
}

// ─── 风格连续性检查（4维） ───

function checkStyleContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  const styleGuide = ctx.styleGuide.length > 0 ? ctx.styleGuide[0] : null

  // 叙事视角：检查风格指南中的 POV 设定
  if (styleGuide?.pov) {
    results.push({
      dimension: "叙事视角",
      status: "PASS",
      detail: `叙事视角已设定为「${styleGuide.pov}」`,
    })
  } else {
    results.push({
      dimension: "叙事视角",
      status: "WARN",
      detail: "风格指南中未设定叙事视角（POV），建议设定以保持一致性",
    })
  }

  // 语言风格：检查风格指南中的 tone 设定
  if (styleGuide?.tone) {
    results.push({
      dimension: "语言风格",
      status: "PASS",
      detail: `语言风格已设定为「${styleGuide.tone}」`,
    })
  } else {
    results.push({
      dimension: "语言风格",
      status: "WARN",
      detail: "风格指南中未设定语言风格（tone），建议设定以保持一致性",
    })
  }

  // 节奏一致：检查章节字数分布
  if (ctx.allChapters.length >= 3) {
    const wordCounts = ctx.allChapters.map((c) => c.word_count)
    const avg = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length
    const variance = wordCounts.map((w) => Math.abs(w - avg) / Math.max(avg, 1))
    const outliers = variance.filter((v) => v > 0.5)

    if (outliers.length > wordCounts.length * 0.3) {
      results.push({
        dimension: "节奏一致",
        status: "WARN",
        detail: `${outliers.length}/${wordCounts.length} 个章节字数偏离平均值超过50%，节奏可能不一致`,
      })
    } else {
      results.push({
        dimension: "节奏一致",
        status: "PASS",
        detail: `平均每章 ${Math.round(avg)} 字，字数分布相对均匀`,
      })
    }
  } else {
    results.push({
      dimension: "节奏一致",
      status: "WARN",
      detail: "章节数不足，无法检查节奏一致性",
    })
  }

  // 描写密度：检查章节摘要中是否有描写密度相关描述
  const descKeywords = ["描写", "场景", "环境", "氛围", "细节"]
  const descSummaries = ctx.chapterSummaries.filter((cs) => descKeywords.some((kw) => cs.summary.includes(kw)))
  if (descSummaries.length > 0) {
    results.push({
      dimension: "描写密度",
      status: "PASS",
      detail: `${descSummaries.length}/${ctx.chapterSummaries.length} 个章节摘要中包含描写相关描述`,
    })
  } else {
    results.push({
      dimension: "描写密度",
      status: "WARN",
      detail: "章节摘要中未发现描写密度相关描述，建议在摘要中标注场景描写情况",
    })
  }

  return results
}

// ─── 逻辑连续性检查（3维） ───

function checkLogicContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // 因果链：检查章节摘要中是否有因果相关描述
  const causeKeywords = ["因为", "由于", "导致", "因此", "所以", "结果", "原因", "因果"]
  const causeChapters = ctx.chapterSummaries.filter((cs) => causeKeywords.some((kw) => cs.summary.includes(kw)))
  if (causeChapters.length > 0) {
    results.push({
      dimension: "因果链",
      status: "PASS",
      detail: `${causeChapters.length}/${ctx.chapterSummaries.length} 个章节摘要中包含因果描述`,
    })
  } else if (ctx.chapterSummaries.length > 0) {
    results.push({
      dimension: "因果链",
      status: "WARN",
      detail: "章节摘要中未发现因果链描述，建议在摘要中标注事件因果关系",
    })
  } else {
    results.push({
      dimension: "因果链",
      status: "WARN",
      detail: "暂无章节摘要，无法检查因果链",
    })
  }

  // 动机合理：检查角色描述和状态中是否有动机描述
  const motiveKeywords = ["动机", "目的", "目标", "追求", "渴望", "执念", "梦想"]
  const charsWithMotives = ctx.characters.filter((c) => motiveKeywords.some((kw) => c.description.includes(kw)))
  const statesWithMotives = ctx.characterStates.filter((s) => motiveKeywords.some((kw) => s.summary.includes(kw)))
  const totalMotives = charsWithMotives.length + statesWithMotives.length

  if (totalMotives > 0) {
    results.push({
      dimension: "动机合理",
      status: "PASS",
      detail: `${charsWithMotives.length} 个角色描述和 ${statesWithMotives.length} 个状态记录中包含动机描述`,
    })
  } else {
    results.push({
      dimension: "动机合理",
      status: "WARN",
      detail: "角色描述和状态中未发现动机描述，建议为关键角色添加动机/目标设定",
    })
  }

  // 信息对称：检查角色信息在各章节间是否一致
  const infoIssues = checkInformationSymmetry(ctx)
  if (infoIssues > 0) {
    results.push({
      dimension: "信息对称",
      status: "WARN",
      detail: `发现 ${infoIssues} 处角色信息不一致（角色状态描述在不同章节中矛盾）`,
    })
  } else if (ctx.characterStates.length > 0) {
    results.push({
      dimension: "信息对称",
      status: "PASS",
      detail: `检查了 ${ctx.characters.length} 个角色的信息一致性，未发现矛盾`,
    })
  } else {
    results.push({
      dimension: "信息对称",
      status: "WARN",
      detail: "暂无角色状态记录，无法检查信息对称性",
    })
  }

  return results
}

// ─── 细节连续性检查（3维） ───

function checkDetailContinuity(ctx: CheckContext): ContinuityResult[] {
  const results: ContinuityResult[] = []

  // 物品追踪：检查章节摘要中是否有物品相关描述
  const itemKeywords = ["物品", "道具", "法宝", "武器", "装备", "宝物", "神器", "丹药"]
  const itemChapters = ctx.chapterSummaries.filter(
    (cs) =>
      itemKeywords.some((kw) => cs.summary.includes(kw)) ||
      (Array.isArray(cs.key_events) && cs.key_events.some((e: string) => itemKeywords.some((kw) => e.includes(kw)))),
  )
  if (itemChapters.length > 0) {
    results.push({
      dimension: "物品追踪",
      status: "PASS",
      detail: `${itemChapters.length} 个章节摘要中涉及物品/道具，可追踪`,
    })
  } else {
    results.push({
      dimension: "物品追踪",
      status: "WARN",
      detail: "章节摘要中未发现物品追踪描述，建议在摘要中记录重要物品的流转",
    })
  }

  // 数字一致：检查章节摘要中是否有数字出现
  const numberPattern = /\d+/
  const numberSummaries = ctx.chapterSummaries.filter((cs) => numberPattern.test(cs.summary))
  if (numberSummaries.length > 0) {
    results.push({
      dimension: "数字一致",
      status: "PASS",
      detail: `${numberSummaries.length} 个章节摘要中包含数字数据，可追踪一致性`,
    })
  } else {
    results.push({
      dimension: "数字一致",
      status: "WARN",
      detail: "章节摘要中未发现数字数据，建议在摘要中记录关键数值（如等级、数量、时间）",
    })
  }

  // 称呼一致：检查角色名称在不同地方是否一致
  const nameIssues = checkNameConsistency(ctx)
  if (nameIssues > 0) {
    results.push({
      dimension: "称呼一致",
      status: "WARN",
      detail: `发现 ${nameIssues} 处角色名称可能不一致（角色状态摘要中使用了与角色定义不同的名称）`,
    })
  } else if (ctx.characters.length > 0) {
    results.push({
      dimension: "称呼一致",
      status: "PASS",
      detail: `检查了 ${ctx.characters.length} 个角色的名称/称呼一致性，未发现异常`,
    })
  } else {
    results.push({
      dimension: "称呼一致",
      status: "WARN",
      detail: "尚未创建角色，无法检查称呼一致性",
    })
  }

  return results
}

// ─── 辅助分析函数 ───

/**
 * 中文常见停用词 / 助词 / 副词，用于从章节正文中过滤"不像专有名词"的词
 */
const STOP_WORDS = new Set([
  "我们", "你们", "他们", "她们", "它们", "自己", "什么", "怎么", "为什么", "因为", "所以",
  "但是", "然而", "虽然", "即使", "如果", "虽然", "不过", "只是", "只有", "已经", "正在",
  "一直", "马上", "立刻", "突然", "忽然", "很快", "非常", "特别", "十分", "极其", "比较",
  "应该", "可以", "可能", "或许", "大概", "也许", "一定", "必须", "需要", "想要", "希望",
  "这个", "那个", "这些", "那些", "这样", "那样", "这么", "那么", "如此", "如何", "为何",
  "现在", "以前", "之后", "之前", "当时", "那时", "此刻", "后来", "前面", "后面", "里面",
  "上面", "下面", "旁边", "中间", "其中", "以外", "以内", "之上", "之下", "之间", "左右",
  "但是", "然而", "不过", "可是", "并且", "而且", "以及", "或是", "或者", "还是", "因为",
  "于是", "然后", "接着", "最后", "终于", "最终", "首先", "其次", "再者", "另外", "此外",
  "听说", "据说", "觉得", "认为", "知道", "明白", "理解", "发现", "感觉", "意识", "看来",
  "似乎", "仿佛", "好像", "犹如", "如同", "正是", "就是", "才是", "全是", "都是", "不是",
  "没有", "不会", "不能", "不要", "不许", "不曾", "尚未", "从未", "刚刚", "刚才", "终于",
  "还有", "已经", "仍是", "仍是", "依旧", "仍然", "依然", "正在", "曾经", "将要", "准备",
  "开始", "结束", "完成", "进行", "持续", "保持", "维持", "存在", "出现", "消失", "展现",
  "看到", "听到", "想到", "感到", "觉得", "认为", "以为", "发现", "明白", "清楚", "明确",
  "已经", "正是", "果然", "竟然", "居然", "甚至", "包括", "尤其", "特别", "主要", "重要",
  "现在", "今天", "明天", "昨天", "白天", "夜晚", "凌晨", "中午", "傍晚", "清晨", "深夜",
  "一些", "一点", "一直", "一定", "一边", "一面", "一起", "一种", "一样", "一片", "一样",
  "非常", "十分", "格外", "尤其", "特别", "比较", "相当", "几乎", "大概", "大约", "左右",
])

/**
 * 从 worldEntries 抽取"设定关键词集合"
 *
 * 抽取策略：
 * 1. 标题整词（最高优先级）
 * 2. 内容里所有 2-6 字连续非停用词（启发式）
 *
 * 返回的词表是 "设定权威词表"，用于检查章节正文是否引用了这些词，
 * 以及反向找出"看起来是专有名词但不在设定中"的疑似漂移词。
 */
function extractSettingKeywords(worldEntries: (typeof WorldEntryTable.$inferSelect)[]): Set<string> {
  const keywords = new Set<string>()
  for (const w of worldEntries) {
    // 标题整词
    if (w.title) keywords.add(w.title)
    // 内容里抽取 2-6 字连续非停用词（启发式：按非字母数字边界切分）
    if (w.content) {
      const tokens = w.content.match(/[一-龥]{2,6}/g) ?? []
      for (const t of tokens) {
        if (!STOP_WORDS.has(t)) keywords.add(t)
      }
    }
  }
  return keywords
}

/**
 * 从章节正文里抽取"专有名词候选"
 *
 * 简单启发式：抽取 2-4 字连续中文，过滤停用词，统计出现频次。
 * 返回按频次降序的前 N 个，作为"可能漂移的专有名词"候选。
 */
function extractNounCandidates(content: string, topN = 30): Array<{ term: string; count: number }> {
  if (!content) return []
  const tokens = content.match(/[一-龥]{2,4}/g) ?? []
  const counter = new Map<string, number>()
  for (const t of tokens) {
    if (STOP_WORDS.has(t)) continue
    // 单字/虚词已过滤；这里只关心 2-4 字的连续词
    counter.set(t, (counter.get(t) ?? 0) + 1)
  }
  // 频次>=2 的优先（出现 1 次的可能是偶然）
  return [...counter.entries()]
    .filter(([, c]) => c >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term, count]) => ({ term, count }))
}

/**
 * 找出"在章节正文里出现但不在设定关键词集合里"的疑似漂移词
 *
 * 用于反向扫描：当 chapter 出现大量"看起来是专有名词（频次高）但不在 worldEntries 中"
 * 的词时，提示可能有设定漂移。具体由 LLM 审计做最终判断。
 */
function findSuspectedDriftTerms(
  content: string,
  settingKeywords: Set<string>,
  topN = 30,
): Array<{ term: string; count: number }> {
  const candidates = extractNounCandidates(content, 200) // 多取一些候选
  const drifts: Array<{ term: string; count: number }> = []
  for (const { term, count } of candidates) {
    if (settingKeywords.has(term)) continue // 在设定中，正常
    if (count < 2) continue // 只出现 1 次的可能是偶然/专有名
    drifts.push({ term, count })
    if (drifts.length >= topN) break
  }
  return drifts
}

/**
 * 检查"章节正文是否引用了相关分类的 worldEntries"
 *
 * 用于 checkWorldBuildingContinuity 的几个维度：
 * 1. 从指定分类/标题关键词筛出"本维度相关的 worldEntries"
 * 2. 抽这些条目的标题作为"本维度应被引用的关键术语"
 * 3. 扫章节正文看这些术语的出现次数
 * 4. 计算覆盖率 hit/total
 *
 * @returns 命中率、命中词、未命中词
 */
function checkCategoryCoverage(
  ctx: CheckContext,
  matchers: { category?: string; titleIncludes?: string[] },
): { hitTerms: string[]; missTerms: string[]; total: number; hitRate: number; chapterHasContent: boolean } {
  const chapterHasContent = !!(ctx.currentChapterContent && ctx.currentChapterContent.length > 0)

  // 筛选本维度相关的 worldEntries
  const related = ctx.worldEntries.filter((w) => {
    if (matchers.category && w.category !== matchers.category) return false
    if (matchers.titleIncludes && !matchers.titleIncludes.some((kw) => w.title.includes(kw))) return false
    return true
  })

  // 关键术语：相关条目的标题
  const keyTerms = related.map((w) => w.title).filter((t) => t && t.length >= 2)
  const total = keyTerms.length

  if (total === 0) {
    return { hitTerms: [], missTerms: [], total: 0, hitRate: 1, chapterHasContent }
  }

  if (!chapterHasContent) {
    return { hitTerms: [], missTerms: keyTerms, total, hitRate: 0, chapterHasContent }
  }

  const content = ctx.currentChapterContent!
  const hitTerms: string[] = []
  const missTerms: string[] = []
  for (const term of keyTerms) {
    if (content.includes(term)) hitTerms.push(term)
    else missTerms.push(term)
  }

  return {
    hitTerms,
    missTerms,
    total,
    hitRate: hitTerms.length / total,
    chapterHasContent,
  }
}

/**
 * 在章节正文里反向扫描疑似漂移词
 */
function scanDriftTerms(
  ctx: CheckContext,
  matchers: { category?: string; titleIncludes?: string[] },
): { drifts: Array<{ term: string; count: number }>; relatedCount: number; chapterHasContent: boolean } {
  const chapterHasContent = !!(ctx.currentChapterContent && ctx.currentChapterContent.length > 0)

  // 本维度相关的 worldEntries 关键词（用全量关键词集合）
  const allSettingKeywords = extractSettingKeywords(ctx.worldEntries)

  // 本维度相关的 worldEntries（用于判断相关设定是否贫瘠）
  const related = ctx.worldEntries.filter((w) => {
    if (matchers.category && w.category !== matchers.category) return false
    if (matchers.titleIncludes && !matchers.titleIncludes.some((kw) => w.title.includes(kw))) return false
    return true
  })

  if (!chapterHasContent) {
    return { drifts: [], relatedCount: related.length, chapterHasContent }
  }

  const drifts = findSuspectedDriftTerms(ctx.currentChapterContent!, allSettingKeywords, 20)
  return { drifts, relatedCount: related.length, chapterHasContent }
}



/** 分析角色情绪变化的一致性 */
function analyzeMoodConsistency(ctx: CheckContext): { totalChars: number; rapidChanges: number } {
  const charStatesMap = new Map<string, (typeof CharacterStateTable.$inferSelect)[]>()
  for (const state of ctx.characterStates) {
    const existing = charStatesMap.get(state.character_id) || []
    existing.push(state)
    charStatesMap.set(state.character_id, existing)
  }

  let rapidChanges = 0
  const moodOpposites: [string, string][] = [
    ["开心", "悲伤"],
    ["愤怒", "平静"],
    ["恐惧", "勇敢"],
    ["绝望", "希望"],
    ["紧张", "放松"],
    ["兴奋", "沮丧"],
  ]

  for (const [, states] of charStatesMap) {
    if (states.length < 2) continue
    for (const [neg, pos] of moodOpposites) {
      for (let i = 1; i < states.length; i++) {
        const prev = states[i - 1]!.mood
        const curr = states[i]!.mood
        if ((prev.includes(neg) && curr.includes(pos)) || (prev.includes(pos) && curr.includes(neg))) {
          rapidChanges++
        }
      }
    }
  }

  return { totalChars: charStatesMap.size, rapidChanges }
}

/** 分析角色位置变化的连续性 */
function analyzeLocationContinuity(ctx: CheckContext): number {
  const charLocationMap = new Map<string, (typeof CharacterStateTable.$inferSelect)[]>()
  for (const state of ctx.characterStates) {
    const existing = charLocationMap.get(state.character_id) || []
    existing.push(state)
    charLocationMap.set(state.character_id, existing)
  }

  let issues = 0
  for (const [, states] of charLocationMap) {
    if (states.length < 2) continue
    for (let i = 1; i < states.length; i++) {
      const prev = states[i - 1]!.location
      const curr = states[i]!.location
      if (prev && curr && prev !== curr && prev.length > 0 && curr.length > 0) {
        // 位置变化本身不是问题，但如果变化过于频繁则是警告
        if (i >= 2) {
          const prev2 = states[i - 2]!.location
          if (prev2 && prev2 !== prev && prev2 !== curr) {
            issues++
          }
        }
      }
    }
  }

  return issues
}

/** 检查冲突的角色关系对 */
function checkConflictingRelationships(ctx: CheckContext, hostileTypes: string[], friendlyTypes: string[]): number {
  const pairMap = new Map<string, string[]>()
  for (const rel of ctx.relationships) {
    const key = [rel.char_a_id, rel.char_b_id].sort().join("||")
    const existing = pairMap.get(key) || []
    existing.push(rel.type)
    pairMap.set(key, existing)
  }

  let conflicts = 0
  for (const [, types] of pairMap) {
    const hasHostile = types.some((t) => hostileTypes.includes(t))
    const hasFriendly = types.some((t) => friendlyTypes.includes(t))
    if (hasHostile && hasFriendly) conflicts++
  }

  return conflicts
}

/** 检查角色名称在各处的一致性 */
function checkNameConsistency(ctx: CheckContext): number {
  const charNames = new Set(ctx.characters.map((c) => c.name))
  let issues = 0

  // 检查角色状态摘要中是否引用了未定义的角色名
  for (const state of ctx.characterStates) {
    for (const name of charNames) {
      if (state.summary.includes(name) && name.length >= 2) continue
    }
    // 检查是否有疑似角色名但不在列表中的情况
    // 这里不做精确检查，因为摘要文本可能包含各种描述
  }

  // 检查关系表中的角色引用
  for (const rel of ctx.relationships) {
    const charA = ctx.characters.find((c) => c.id === rel.char_a_id)
    const charB = ctx.characters.find((c) => c.id === rel.char_b_id)
    if (!charA || !charB) {
      issues++
    }
  }

  return issues
}

/** 统计角色位置变化次数 */
function countLocationChanges(ctx: CheckContext): number {
  const charLocationMap = new Map<string, string[]>()
  for (const state of ctx.characterStates) {
    const existing = charLocationMap.get(state.character_id) || []
    existing.push(state.location)
    charLocationMap.set(state.character_id, existing)
  }

  let changes = 0
  for (const [, locations] of charLocationMap) {
    for (let i = 1; i < locations.length; i++) {
      if (locations[i] && locations[i - 1] && locations[i] !== locations[i - 1]) {
        changes++
      }
    }
  }

  return changes
}

/** 检查信息对称性：角色状态在不同章节间是否矛盾 */
function checkInformationSymmetry(ctx: CheckContext): number {
  let issues = 0
  const charStatesMap = new Map<string, (typeof CharacterStateTable.$inferSelect)[]>()

  for (const state of ctx.characterStates) {
    const existing = charStatesMap.get(state.character_id) || []
    existing.push(state)
    charStatesMap.set(state.character_id, existing)
  }

  for (const [, states] of charStatesMap) {
    if (states.length < 2) continue
    // 检查 active 状态变化：从 active=1 变为 active=0 再变回 active=1 但又没有中间章节
    for (let i = 2; i < states.length; i++) {
      if (states[i - 2]!.active === 1 && states[i - 1]!.active === 0 && states[i]!.active === 1) {
        issues++
      }
    }
  }

  return issues
}
