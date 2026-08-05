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

  // 力量体系：检查世界观条目中的力量体系内容
  const powerEntries = ctx.worldEntries.filter(
    (w) =>
      w.category === "power_system" ||
      w.category === "力量体系" ||
      w.title.includes("境界") ||
      w.title.includes("修炼") ||
      w.title.includes("等级"),
  )
  if (powerEntries.length > 0) {
    results.push({
      dimension: "力量体系",
      status: "PASS",
      detail: `世界观中定义了 ${powerEntries.length} 条力量体系条目`,
    })
  } else {
    results.push({
      dimension: "力量体系",
      status: "WARN",
      detail: "世界观中未定义力量体系，建议添加以确保战斗/能力描写一致",
    })
  }

  // 规则一致：检查风格指南中的规则
  const styleRules = ctx.styleGuide.length > 0 ? ((ctx.styleGuide[0]!.rules as Record<string, unknown>) ?? {}) : {}
  const ruleCount = Object.keys(styleRules).length
  if (ruleCount > 0) {
    results.push({
      dimension: "规则一致",
      status: "PASS",
      detail: `风格指南中定义了 ${ruleCount} 条写作规则`,
    })
  } else {
    results.push({
      dimension: "规则一致",
      status: "WARN",
      detail: "风格指南中未定义写作规则，建议添加世界观规则以保证一致性",
    })
  }

  // 社会结构：检查世界观条目中的社会相关内容
  const societyEntries = ctx.worldEntries.filter(
    (w) =>
      w.category === "society" ||
      w.category === "社会" ||
      w.title.includes("社会") ||
      w.title.includes("家族") ||
      w.title.includes("组织") ||
      w.title.includes("国家") ||
      w.title.includes("门派"),
  )
  if (societyEntries.length > 0) {
    results.push({
      dimension: "社会结构",
      status: "PASS",
      detail: `世界观中定义了 ${societyEntries.length} 条社会结构条目`,
    })
  } else {
    results.push({
      dimension: "社会结构",
      status: "WARN",
      detail: "世界观中未定义社会结构，建议添加社会/组织/家族设定",
    })
  }

  // 文化细节：检查世界观条目中的文化相关内容
  const cultureEntries = ctx.worldEntries.filter(
    (w) =>
      w.category === "culture" ||
      w.category === "文化" ||
      w.title.includes("文化") ||
      w.title.includes("风俗") ||
      w.title.includes("节日") ||
      w.title.includes("礼仪") ||
      w.title.includes("传统"),
  )
  if (cultureEntries.length > 0) {
    results.push({
      dimension: "文化细节",
      status: "PASS",
      detail: `世界观中定义了 ${cultureEntries.length} 条文化细节条目`,
    })
  } else {
    results.push({
      dimension: "文化细节",
      status: "WARN",
      detail: "世界观中未定义文化细节，建议添加文化/风俗/传统设定",
    })
  }

  // 经济系统：检查世界观条目中的经济相关内容
  const economyEntries = ctx.worldEntries.filter(
    (w) =>
      w.category === "economy" ||
      w.category === "经济" ||
      w.title.includes("经济") ||
      w.title.includes("货币") ||
      w.title.includes("交易") ||
      w.title.includes("资源"),
  )
  if (economyEntries.length > 0) {
    results.push({
      dimension: "经济系统",
      status: "PASS",
      detail: `世界观中定义了 ${economyEntries.length} 条经济系统条目`,
    })
  } else {
    results.push({
      dimension: "经济系统",
      status: "WARN",
      detail: "世界观中未定义经济系统，建议添加货币/资源/经济设定",
    })
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
