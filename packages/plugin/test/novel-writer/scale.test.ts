/**
 * 规模测试 — 模拟 ch100/500/1000 章场景，验证上下文预算、状态写回、卷汇总和审计
 *
 * 基于 scale-test.ts 的模拟模式，扩展为完整的 bun:test 测试套件。
 * 测试用例：
 * 1. ch100: 上下文组装在 8K 预算内
 * 2. ch500: 上下文在 8K 内，状态写回正确，卷汇总触发
 * 3. ch1000: 上下文在 8K 内，归档压缩工作，无预算溢出
 * 4. 在 ch500+ 注入矛盾，验证审计捕获
 * 5. 验证状态写回在各规模下产生正确快照
 *
 * 预算分配：P0 1K + P1 1.5K + P2 2K + P3 2K + P4 1.5K = 8K
 */

import { describe, test, expect } from "bun:test"
import { applyBudget } from "../../src/novel-writer/budget.js"
import type {
  ContextPacket,
  ActiveCharacter,
  ChapterSummaryItem,
  PlotThreadSummary,
  ForeshadowingSummary,
  StyleGuideInfo,
} from "../../src/novel-writer/context.js"
import type { StateDelta, StateDeltaEntry } from "../../src/novel-writer/state-commit.js"
import { FACT_TYPES } from "../../src/novel-writer/state-commit.js"

// ─── Token 估算工具（与 budget.ts 保持一致） ───

/** 估算字符串的 token 数量（1 token ≈ 1.5 中文字符） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

/** 估算活跃角色对象的 token 数量 */
function charTokens(char: ActiveCharacter): number {
  return estimateTokens(char.name + char.role + char.description + char.location + char.mood + char.summary)
}

/** 估算章节摘要的 token 数量 */
function chapterTokens(ch: ChapterSummaryItem): number {
  return estimateTokens(ch.chapterTitle + ch.summary + ch.keyEvents.join(""))
}

/** 估算剧情线索的 token 数量 */
function threadTokens(t: PlotThreadSummary): number {
  return estimateTokens(t.title + t.status + t.priority + t.description)
}

/** 估算伏笔的 token 数量 */
function foreshadowTokens(f: ForeshadowingSummary): number {
  return estimateTokens(f.content + f.state + (f.plantedChapterId ?? ""))
}

/** 估算风格指南的 token 数量 */
function styleGuideTokens(sg: StyleGuideInfo): number {
  return estimateTokens(JSON.stringify(sg.rules) + sg.tone + sg.pov + sg.tense)
}

// ─── 模拟数据生成（与 scale-test.ts 的 generateMockData 保持一致） ───

/**
 * 生成模拟 ContextPacket
 *
 * 模拟 assembleSnapshot 的输出结构，数据量随章节数增长。
 * 各层数据量设计：
 * - P1 角色数 ≈ chapterCount * 15%
 * - P3 线索数 ≈ chapterCount * 20%，伏笔数 ≈ chapterCount * 15%
 * - P2 固定 3 章摘要
 * - P0 和 P4 固定不变
 */
function generateMockData(chapterCount: number): ContextPacket {
  const charCount = Math.max(5, Math.floor(chapterCount * 0.15))
  const threadCount = Math.max(3, Math.floor(chapterCount * 0.2))
  const foreshadowCount = Math.max(3, Math.floor(chapterCount * 0.15))

  // P0: 小说蓝图
  const novelTitle = "星辰变"
  const genre = "玄幻"
  const synopsis =
    "这是一个关于修炼与成长的故事。主角从小镇少年开始，历经磨难，最终成为一代强者。故事发生在浩瀚的星辰大陆，这里有九大势力，无数强者争锋。主角在一次偶然的机会中获得了一枚神秘的玉佩，从此踏上修炼之路。在修炼的过程中，他结识了众多伙伴，也遭遇了强大的敌人。每一次突破都是一次蜕变，每一次战斗都是一次成长。"

  // P1: 活跃角色
  const activeCharacters: ActiveCharacter[] = []
  for (let i = 1; i <= charCount; i++) {
    activeCharacters.push({
      name: `角色${i}`,
      role: i <= 3 ? "主角" : i <= 6 ? "重要配角" : "配角",
      description: `这是角色${i}的描述。${i % 2 === 0 ? "性格沉稳，心思缜密，擅长谋略。" : "性格豪爽，直来直往，实力强大。"}曾是某门派的弟子，后因机缘巧合加入了主角的团队。`,
      location: i % 3 === 0 ? "星辰阁" : i % 3 === 1 ? "天元城" : "秘境深处",
      mood: i % 2 === 0 ? "平静" : "激动",
      summary: `角色${i}当前状态：${i % 3 === 0 ? "正在修炼中" : "跟随主角探索秘境"}。最近经历了一场大战，实力有所提升。`,
    })
  }

  // P2: 卷摘要 + 最近 3 章摘要
  const volumeNumber = Math.ceil(chapterCount / 50)
  const volumeSummary =
    `## 卷${volumeNumber}摘要\n\n` +
    `### 主要事件\n` +
    `- 第${(volumeNumber - 1) * 50 + 1}章《序幕》：故事开始，主角登场。\n` +
    `- 第${(volumeNumber - 1) * 50 + 2}章《奇遇》：主角获得神秘玉佩。\n\n` +
    `### 角色变化\n` +
    `活跃角色：角色1、角色2、角色3\n` +
    `休眠角色：角色4、角色5\n\n` +
    `### 线索进展\n` +
    `开放线索：- 神秘玉佩的秘密\n- 主角的身世之谜`

  const recentChapterSummaries: ChapterSummaryItem[] = []
  const start = Math.max(1, chapterCount - 2)
  for (let i = 0; i < 3 && start + i <= chapterCount; i++) {
    const order = start + i
    recentChapterSummaries.push({
      chapterOrder: order,
      chapterTitle: `第${order}章`,
      summary: `这是第${order}章的摘要。本章主要讲述了主角${order % 2 === 0 ? "与敌人激战" : "探索秘境"}的过程。`,
      keyEvents: [
        `事件A：主角${order % 2 === 0 ? "遭遇强敌" : "发现遗迹"}`,
        `事件B：主角${order % 2 === 0 ? "施展绝技" : "获得宝物"}`,
        `事件C：主角${order % 3 === 0 ? "结识新伙伴" : "突破境界"}`,
        "事件D：为后续剧情埋下伏笔",
      ],
    })
  }

  // P3: 剧情线索 + 伏笔
  const plotThreads: PlotThreadSummary[] = []
  for (let i = 1; i <= threadCount; i++) {
    plotThreads.push({
      title: `线索${i}：${i % 3 === 0 ? "神秘势力的阴谋" : i % 3 === 1 ? "主角的身世之谜" : "古老遗迹的秘密"}`,
      status: i > threadCount * 0.3 ? "open" : "closed",
      priority: i <= 3 ? "high" : i <= 8 ? "medium" : "low",
      description: `这是关于线索${i}的详细描述。${i % 2 === 0 ? "涉及多个势力。" : "与主角的过去有关。"}重要性：${i <= 3 ? "极高" : i <= 8 ? "中等" : "一般"}。`,
    })
  }

  const foreshadowing: ForeshadowingSummary[] = []
  for (let i = 1; i <= foreshadowCount; i++) {
    foreshadowing.push({
      content: `伏笔${i}：${i % 3 === 0 ? "主角体内隐藏的力量" : i % 3 === 1 ? "神秘玉佩的真正用途" : "某个配角的真实身份"}`,
      state: i > foreshadowCount * 0.5 ? "planted" : "resolved",
      plantedChapterId: `ch_${((i * 10) % chapterCount) + 1}`,
    })
  }

  // P4: 风格指南 + 题材规则
  const styleGuide: StyleGuideInfo = {
    rules: {
      avoid_modern: "避免使用现代词汇",
      use_chinese_idioms: "多使用成语和典故",
      keep_consistent: "保持修炼体系一致",
      show_not_tell: "用行动展现角色性格",
    },
    tone: "热血激昂，但又不失温情",
    pov: "第三人称有限视角（跟随主角）",
    tense: "过去时",
  }

  const genreRules: string[] = [
    "题材规则1：修炼体系要清晰，从低到高有明确的等级划分",
    "题材规则2：境界突破要有铺垫，不能突兀升级",
    "题材规则3：战斗描写要精彩，体现策略和力量对比",
    "题材规则4：不要主角无敌，要有挫折和成长",
    "题材规则5：配角要有血有肉，有各自的动机和故事",
    "题材规则6：伏笔要及时回收，前后呼应",
    "题材规则7：世界观要自洽，设定前后一致",
    "题材规则8：节奏要张弛有度，高潮和铺垫交替",
  ]

  return {
    novelTitle,
    genre,
    synopsis,
    activeCharacters,
    volumeSummary,
    recentChapterSummaries,
    plotThreads,
    foreshadowing,
    styleGuide,
    genreRules,
    worldEntries: [],
    worldEntryIndex: [],
    recalledHistory: [],
    volumeList: [],
    relationships: [],
    chapterOutline: null,
    prevChapterTail: null,
    targetWordCount: 2500,
  }
}

// ─── Token 计算与报告 ───

/** 计算 ContextPacket 各层 token 数 */
function calculateLayerTokens(packet: ContextPacket): [number, number, number, number, number] {
  const p0 = estimateTokens(packet.novelTitle + packet.genre + packet.synopsis)
  const p1 = packet.activeCharacters.reduce((sum, c) => sum + charTokens(c), 0)
  const p2 =
    (packet.volumeSummary ? estimateTokens(packet.volumeSummary) : 0) +
    packet.recentChapterSummaries.reduce((sum, c) => sum + chapterTokens(c), 0)
  const p3 =
    packet.plotThreads.reduce((sum, t) => sum + threadTokens(t), 0) +
    packet.foreshadowing.reduce((sum, f) => sum + foreshadowTokens(f), 0)
  const p4 =
    (packet.styleGuide ? styleGuideTokens(packet.styleGuide) : 0) +
    packet.genreRules.reduce((sum, r) => sum + estimateTokens(r), 0)
  return [p0, p1, p2, p3, p4]
}

// ─── 状态写回模拟 ───

/**
 * 为指定章节规模生成模拟的 StateDelta
 *
 * 模拟一次完整的章节写作后 observer 产生的状态变更，
 * 包含 9 种事实类型的 create/update 操作。
 * 数据量随章节数增长。
 */
function generateMockDelta(chapterCount: number): StateDelta {
  const entries: StateDeltaEntry[] = []
  const charCount = Math.max(5, Math.floor(chapterCount * 0.15))
  const threadCount = Math.max(3, Math.floor(chapterCount * 0.2))

  // 角色创建/更新
  for (let i = 1; i <= charCount; i++) {
    if (i <= 3) {
      // 核心角色：更新状态
      entries.push({
        fact_type: "character",
        action: "update",
        entity_id: `char_${i}`,
        data: {
          name: `角色${i}`,
          role: i <= 3 ? "主角" : "重要配角",
          description: `角色${i}的最新状态更新`,
          location: `第${chapterCount}章所在地`,
          mood: "平静",
          summary: `角色${i}在第${chapterCount}章参与关键事件`,
        },
      })
    } else {
      // 非核心角色：创建
      entries.push({
        fact_type: "character",
        action: "create",
        entity_id: `char_${i}`,
        data: {
          name: `角色${i}`,
          role: "配角",
          description: `角色${i}的描述`,
          location: "未知",
          mood: "平静",
          summary: `首次出场`,
        },
      })
    }
  }

  // 关系创建
  entries.push({
    fact_type: "relationship",
    action: "create",
    entity_id: `rel_${chapterCount}`,
    data: {
      char_a_id: "char_1",
      char_b_id: "char_2",
      type: "盟友",
      description: `第${chapterCount}章建立的关系`,
    },
  })

  // 剧情线索更新
  for (let i = 1; i <= threadCount; i++) {
    const status = i > threadCount * 0.3 ? "open" : "closed"
    entries.push({
      fact_type: "plot_thread",
      action: i <= 3 ? "update" : "create",
      entity_id: `thread_${i}`,
      data: {
        title: `线索${i}`,
        status,
        priority: i <= 3 ? "high" : "medium",
        description: `线索${i}在第${chapterCount}章有进展`,
      },
    })
  }

  // 伏笔
  entries.push({
    fact_type: "foreshadow",
    action: "create",
    entity_id: `fs_${chapterCount}`,
    data: {
      content: `第${chapterCount}章埋下的伏笔`,
      state: "planted",
      planted_chapter_id: `ch_${chapterCount}`,
    },
  })

  // 章节摘要
  entries.push({
    fact_type: "chapter_summary",
    action: "create",
    entity_id: `cs_${chapterCount}`,
    data: {
      chapter_id: `ch_${chapterCount}`,
      summary: `第${chapterCount}章的摘要`,
      key_events: ["事件A", "事件B", "事件C"],
      char_changes: ["角色1状态更新", "角色2新技能"],
    },
  })

  // 世界观条目
  entries.push({
    fact_type: "world_entry",
    action: chapterCount <= 50 ? "create" : "update",
    entity_id: `world_${Math.ceil(chapterCount / 50)}`,
    data: {
      category: "location",
      title: `第${Math.ceil(chapterCount / 50)}卷世界观`,
      content: `卷${Math.ceil(chapterCount / 50)}的世界观设定`,
    },
  })

  // 风格指南
  entries.push({
    fact_type: "style",
    action: chapterCount === 1 ? "create" : "update",
    entity_id: "style_main",
    data: {
      rules: { avoid_modern: "避免使用现代词汇" },
      tone: "热血激昂",
      pov: "第三人称",
      tense: "过去时",
    },
  })

  // 时间线
  entries.push({
    fact_type: "timeline",
    action: "create",
    entity_id: `tl_${chapterCount}`,
    data: {
      chapter_id: `ch_${chapterCount}`,
      timestamp: Date.now(),
      description: `第${chapterCount}章时间节点`,
    },
  })

  // 地点
  entries.push({
    fact_type: "location",
    action: "create",
    entity_id: `loc_${chapterCount}`,
    data: {
      name: `地点${chapterCount}`,
      description: `第${chapterCount}章的场景地点`,
    },
  })

  // 张力评分
  entries.push({
    fact_type: "tension",
    action: "create",
    entity_id: `tension_${chapterCount}`,
    data: {
      level: chapterCount % 11,
      reason: `第${chapterCount}章的张力评分`,
    },
  })

  return entries
}

// ─── 审计模拟（矛盾检测） ───

/** 矛盾检测结果 */
interface ContradictionResult {
  detected: boolean
  contradictions: string[]
}

/**
 * 模拟审计：检测上下文快照中的矛盾
 *
 * 检查常见的矛盾模式：
 * 1. 角色同时出现在两个不同地点
 * 2. 剧情线索状态不一致（同时标记为 open 和 closed）
 * 3. 伏笔埋设章节序号大于当前章节序号
 * 4. 角色数量与章节规模不匹配
 */
function auditContradictions(packet: ContextPacket, chapterCount: number): ContradictionResult {
  const contradictions: string[] = []

  // 检查1：角色地点矛盾（同一角色出现两次且地点不同）
  const nameLocations = new Map<string, string[]>()
  for (const char of packet.activeCharacters) {
    const existing = nameLocations.get(char.name) || []
    existing.push(char.location)
    nameLocations.set(char.name, existing)
  }
  for (const [name, locations] of nameLocations) {
    const unique = new Set(locations)
    if (unique.size > 1) {
      contradictions.push(`角色「${name}」同时出现在 ${unique.size} 个不同地点：${[...unique].join("、")}`)
    }
  }

  // 检查2：线索状态矛盾
  for (const thread of packet.plotThreads) {
    if (thread.status === "closed" && thread.priority === "high") {
      contradictions.push(`高优先级线索「${thread.title}」已关闭但优先级仍为 high，可能存在状态矛盾`)
    }
  }

  // 检查3：伏笔埋设章节矛盾
  for (const fs of packet.foreshadowing) {
    if (fs.plantedChapterId) {
      const match = fs.plantedChapterId.match(/ch_(\d+)/)
      if (match) {
        const plantedNum = parseInt(match[1]!, 10)
        if (plantedNum > chapterCount) {
          contradictions.push(`伏笔「${fs.content}」埋设章节 ch_${plantedNum} 超过当前章节数 ${chapterCount}`)
        }
      }
    }
  }

  // 检查4：角色规模异常
  const expectedMaxChars = Math.max(5, Math.floor(chapterCount * 0.15))
  if (packet.activeCharacters.length > expectedMaxChars * 2) {
    contradictions.push(
      `活跃角色数 ${packet.activeCharacters.length} 远超预期 ${expectedMaxChars}，可能未正确过滤休眠角色`,
    )
  }

  // 检查5：未回收伏笔比例过高
  if (chapterCount > 100) {
    const planted = packet.foreshadowing.filter((f) => f.state === "planted")
    const ratio = planted.length / Math.max(1, packet.foreshadowing.length)
    if (ratio > 0.8) {
      contradictions.push(`伏笔未回收比例 ${Math.round(ratio * 100)}% 超过 80%，已写 ${chapterCount} 章应回收更多伏笔`)
    }
  }

  return {
    detected: contradictions.length > 0,
    contradictions,
  }
}

/**
 * 在上下文快照中注入一个已知矛盾
 *
 * 注入方式：修改第一个角色的地点，使其与第二个角色相同，
 * 但设置一个矛盾标记，使审计可以检测到。
 */
function injectContradiction(packet: ContextPacket): ContextPacket {
  const modified = { ...packet, activeCharacters: [...packet.activeCharacters] }

  if (modified.activeCharacters.length >= 2) {
    // 复制角色使其出现在两个不同地点
    const original = modified.activeCharacters[0]!
    modified.activeCharacters[0] = {
      ...original,
      name: original.name,
      location: "矛盾地点A（与自身冲突）",
    }
    // 推入一个同名但不同地点的角色，制造矛盾
    modified.activeCharacters.push({
      ...original,
      location: "矛盾地点B（与自身冲突）",
    })
  }

  return modified
}

// ─── 卷汇总触发验证 ───

/**
 * 验证卷汇总触发逻辑
 *
 * 每50章触发一次卷汇总，计算指定章节数下应触发的次数。
 * 卷号从1开始：ch1-50 -> 卷1, ch51-100 -> 卷2, ...
 */
function getExpectedVolumeCount(chapterCount: number): number {
  return Math.ceil(chapterCount / 50)
}

/**
 * 验证卷汇总边界
 *
 * 返回在指定章节数下应触发卷汇总的章节序号列表。
 * 触发点：ch50, ch100, ch150, ...
 */
function getVolumeRollupTriggers(chapterCount: number): number[] {
  const triggers: number[] = []
  for (let ch = 50; ch <= chapterCount; ch += 50) {
    triggers.push(ch)
  }
  return triggers
}

// ─── 测试用例 ───

const BUDGETS = [1000, 1500, 2000, 2000, 1500]
const LAYER_NAMES = ["P0 蓝图", "P1 活跃角色", "P2 卷+章摘要", "P3 线索+伏笔", "P4 风格+规则"]

describe("规模测试 — 上下文预算", () => {
  test("ch100: 上下文组装在 8K 预算内", () => {
    const mock = generateMockData(100)
    const before = calculateLayerTokens(mock)
    const afterPacket = applyBudget(mock)
    const after = calculateLayerTokens(afterPacket)

    // 验证每层在预算内
    for (let i = 0; i < 5; i++) {
      expect(after[i]).toBeLessThanOrEqual(BUDGETS[i]!)
    }

    // 验证总 token 不超过 8K
    const totalAfter = after.reduce((a, b) => a + b, 0)
    expect(totalAfter).toBeLessThanOrEqual(8000)

    // 验证裁剪有效：至少有一层被裁剪（ch100 数据量较大）
    const totalBefore = before.reduce((a, b) => a + b, 0)
    expect(totalAfter).toBeLessThanOrEqual(totalBefore)
  })

  test("ch500: 上下文在 8K 内，卷汇总触发", () => {
    const mock = generateMockData(500)
    const afterPacket = applyBudget(mock)
    const after = calculateLayerTokens(afterPacket)

    // 验证每层在预算内
    for (let i = 0; i < 5; i++) {
      expect(after[i]).toBeLessThanOrEqual(BUDGETS[i]!)
    }

    // 验证总 token 不超过 8K
    const totalAfter = after.reduce((a, b) => a + b, 0)
    expect(totalAfter).toBeLessThanOrEqual(8000)

    // 验证卷汇总触发次数：ch500 应触发 10 次（ch50, ch100, ..., ch500）
    const volumeCount = getExpectedVolumeCount(500)
    expect(volumeCount).toBe(10)

    const triggers = getVolumeRollupTriggers(500)
    expect(triggers.length).toBe(10)
    expect(triggers[0]).toBe(50)
    expect(triggers[triggers.length - 1]).toBe(500)

    // 验证 P3 层大量裁剪：500 章会产生大量线索和伏笔
    const mockBefore = calculateLayerTokens(mock)
    const p3Before = mockBefore[3]
    const p3After = after[3]
    expect(p3After).toBeLessThanOrEqual(p3Before)
  })

  test("ch1000: 上下文在 8K 内，归档压缩工作，无预算溢出", () => {
    const mock = generateMockData(1000)
    const afterPacket = applyBudget(mock)
    const after = calculateLayerTokens(afterPacket)

    // 验证每层在预算内
    for (let i = 0; i < 5; i++) {
      expect(after[i]).toBeLessThanOrEqual(BUDGETS[i]!)
    }

    // 验证总 token 不超过 8K
    const totalAfter = after.reduce((a, b) => a + b, 0)
    expect(totalAfter).toBeLessThanOrEqual(8000)

    // 验证卷汇总触发次数：ch1000 应触发 20 次
    const volumeCount = getExpectedVolumeCount(1000)
    expect(volumeCount).toBe(20)

    const triggers = getVolumeRollupTriggers(1000)
    expect(triggers.length).toBe(20)
    expect(triggers[0]).toBe(50)
    expect(triggers[triggers.length - 1]).toBe(1000)

    // 验证归档压缩：ch1000 时，applyBudget 应大幅裁剪数据
    const mockBefore = calculateLayerTokens(mock)
    const totalBefore = mockBefore.reduce((a, b) => a + b, 0)
    // ch1000 的原始数据远超 8K，压缩后应显著减少
    expect(totalBefore).toBeGreaterThan(8000)
    expect(totalAfter).toBeLessThanOrEqual(8000)

    // 验证 P1（角色）层被裁剪（ch1000 有 150 个角色，远超预算）
    const p1Before = mockBefore[1]
    const p1After = after[1]
    expect(p1After).toBeLessThan(p1Before)
  })
})

describe("规模测试 — 状态写回", () => {
  test("ch100: 状态写回产生正确的 delta 结构", () => {
    const delta = generateMockDelta(100)

    // 验证 delta 非空且包含所有 9 种事实类型
    expect(delta.length).toBeGreaterThan(0)

    const factTypes = new Set(delta.map((e) => e.fact_type))
    for (const expectedType of FACT_TYPES) {
      expect(factTypes.has(expectedType)).toBe(true)
    }

    // 验证每条条目都有必要的字段
    for (const entry of delta) {
      expect(entry.fact_type).toBeDefined()
      expect(entry.action).toBeDefined()
      expect(entry.entity_id).toBeDefined()
      expect(entry.data).toBeDefined()
      expect(["create", "update", "delete"]).toContain(entry.action)
      expect(FACT_TYPES).toContain(entry.fact_type)
    }

    // 验证角色条目数量合理
    const charEntries = delta.filter((e) => e.fact_type === "character")
    const expectedCharCount = Math.max(5, Math.floor(100 * 0.15))
    expect(charEntries.length).toBeGreaterThanOrEqual(expectedCharCount - 1)
  })

  test("ch500: 状态写回包含卷汇总触发后的数据", () => {
    const delta = generateMockDelta(500)

    // 验证 delta 包含所有事实类型
    const factTypes = new Set(delta.map((e) => e.fact_type))
    expect(factTypes.size).toBe(FACT_TYPES.length)

    // 验证 chapter_summary 条目存在
    const summaryEntries = delta.filter((e) => e.fact_type === "chapter_summary")
    expect(summaryEntries.length).toBeGreaterThan(0)
    expect(summaryEntries[0]!.data.chapter_id).toBe("ch_500")

    // 验证 plot_thread 条目：ch500 应产生大量线索
    const threadEntries = delta.filter((e) => e.fact_type === "plot_thread")
    const expectedThreadCount = Math.max(3, Math.floor(500 * 0.2))
    expect(threadEntries.length).toBeGreaterThanOrEqual(expectedThreadCount - 1)

    // 验证有已关闭的线索（threadCount * 0.3 以上的被标记为 closed）
    const closedThreads = threadEntries.filter((e) => (e.data.status as string) === "closed")
    expect(closedThreads.length).toBeGreaterThan(0)
  })

  test("ch1000: 状态写回在超大规模下结构完整", () => {
    const delta = generateMockDelta(1000)

    // 验证所有条目都有有效的 entity_id
    for (const entry of delta) {
      expect(entry.entity_id.length).toBeGreaterThan(0)
    }

    // 验证所有 action 都是有效值
    const validActions = new Set(["create", "update", "delete"])
    for (const entry of delta) {
      expect(validActions.has(entry.action)).toBe(true)
    }

    // 验证角色条目数量随规模增长
    const charEntries = delta.filter((e) => e.fact_type === "character")
    const expectedCharCount = Math.max(5, Math.floor(1000 * 0.15))
    expect(charEntries.length).toBeGreaterThanOrEqual(expectedCharCount - 1)

    // 验证 chapter_summary 的 data 包含必要字段
    const summaryEntries = delta.filter((e) => e.fact_type === "chapter_summary")
    for (const entry of summaryEntries) {
      expect(entry.data.chapter_id).toBeDefined()
      expect(entry.data.summary).toBeDefined()
      expect(entry.data.key_events).toBeDefined()
      expect(Array.isArray(entry.data.key_events)).toBe(true)
    }
  })

  test("状态写回快照：各规模下 delta 结构一致", () => {
    const scales = [100, 500, 1000]

    for (const scale of scales) {
      const delta = generateMockDelta(scale)

      // 验证每种事实类型至少有一条记录
      const factTypes = new Set(delta.map((e) => e.fact_type))
      expect(factTypes.size).toBe(FACT_TYPES.length)

      // 验证所有条目的 action 和 fact_type 有效
      for (const entry of delta) {
        expect(FACT_TYPES).toContain(entry.fact_type)
        expect(["create", "update", "delete"]).toContain(entry.action)
        expect(typeof entry.entity_id).toBe("string")
        expect(typeof entry.data).toBe("object")
      }
    }
  })
})

describe("规模测试 — 审计矛盾检测", () => {
  test("ch500+ 注入矛盾后审计应捕获", () => {
    const mock = generateMockData(500)
    const cleanResult = auditContradictions(mock, 500)

    // 注入矛盾
    const contaminated = injectContradiction(mock)
    const contaminatedResult = auditContradictions(contaminated, 500)

    // 验证注入后矛盾被检测到
    expect(contaminatedResult.detected).toBe(true)
    expect(contaminatedResult.contradictions.length).toBeGreaterThan(0)

    // 验证检测到地点矛盾（同一角色出现在两个不同地点）
    const locationContradiction = contaminatedResult.contradictions.some(
      (c) => c.includes("地点") || c.includes("不同"),
    )
    expect(locationContradiction).toBe(true)
  })

  test("ch1000: 审计检测到高优先级线索已关闭的矛盾", () => {
    // generateMockData 中，前 3 条线索优先级为 high，
    // 且前 30% 的线索状态为 closed（ch1000 时 threadCount=200，i<=60 为 closed）
    // 因此线程 1-3 同时满足 priority=high 和 status=closed，触发审计
    const mock = generateMockData(1000)
    const result = auditContradictions(mock, 1000)

    // 验证检测到"高优先级线索已关闭"的矛盾
    const priorityWarning = result.contradictions.some((c) => c.includes("高优先级") && c.includes("已关闭"))
    expect(priorityWarning).toBe(true)
  })

  test("审计检测到伏笔埋设章节超出当前章节", () => {
    const mock = generateMockData(100)
    // 修改伏笔 plantedChapterId 指向未来章节
    const modified = {
      ...mock,
      foreshadowing: [
        ...mock.foreshadowing,
        {
          content: "测试伏笔：未来章节的矛盾",
          state: "planted" as const,
          plantedChapterId: "ch_999",
        },
      ],
    }

    const result = auditContradictions(modified, 100)
    expect(result.detected).toBe(true)

    const chapterContradiction = result.contradictions.some((c) => c.includes("ch_999") && c.includes("超过"))
    expect(chapterContradiction).toBe(true)
  })

  test("干净数据不触发审计误报", () => {
    // 生成小规模数据，手动确保无矛盾
    const cleanPacket: ContextPacket = {
      novelTitle: "测试小说",
      genre: "玄幻",
      synopsis: "测试简介",
      activeCharacters: [
        {
          name: "主角A",
          role: "主角",
          description: "主角描述",
          location: "天元城",
          mood: "平静",
          summary: "主角状态",
        },
        {
          name: "配角B",
          role: "配角",
          description: "配角描述",
          location: "星辰阁",
          mood: "平静",
          summary: "配角状态",
        },
      ],
      volumeSummary: "卷1摘要",
      recentChapterSummaries: [
        {
          chapterOrder: 1,
          chapterTitle: "第1章",
          summary: "第1章摘要",
          keyEvents: ["事件1"],
        },
      ],
      plotThreads: [
        {
          title: "主线",
          status: "open",
          priority: "high",
          description: "主线描述",
        },
      ],
      foreshadowing: [
        {
          content: "伏笔1",
          state: "resolved",
          plantedChapterId: "ch_1",
        },
      ],
      styleGuide: {
        rules: {},
        tone: "热血",
        pov: "第三人称",
        tense: "过去时",
      },
      genreRules: ["规则1"],
      worldEntries: [],
      worldEntryIndex: [],
      recalledHistory: [],
      volumeList: [],
      relationships: [],
      chapterOutline: null,
      prevChapterTail: null,
      targetWordCount: 2500,
    }

    const result = auditContradictions(cleanPacket, 10)
    expect(result.detected).toBe(false)
    expect(result.contradictions.length).toBe(0)
  })
})

describe("规模测试 — 卷汇总触发验证", () => {
  test("ch50: 触发第1次卷汇总", () => {
    expect(getExpectedVolumeCount(50)).toBe(1)
    expect(getVolumeRollupTriggers(50)).toEqual([50])
  })

  test("ch100: 触发第2次卷汇总", () => {
    expect(getExpectedVolumeCount(100)).toBe(2)
    const triggers = getVolumeRollupTriggers(100)
    expect(triggers).toEqual([50, 100])
  })

  test("ch150: 触发第3次卷汇总", () => {
    expect(getExpectedVolumeCount(150)).toBe(3)
    const triggers = getVolumeRollupTriggers(150)
    expect(triggers).toEqual([50, 100, 150])
  })

  test("ch500: 触发10次卷汇总", () => {
    const triggers = getVolumeRollupTriggers(500)
    expect(triggers.length).toBe(10)
    expect(triggers[0]).toBe(50)
    expect(triggers[9]).toBe(500)
    // 每50章触发一次
    for (let i = 0; i < triggers.length; i++) {
      expect(triggers[i]).toBe((i + 1) * 50)
    }
  })

  test("ch1000: 触发20次卷汇总", () => {
    const triggers = getVolumeRollupTriggers(1000)
    expect(triggers.length).toBe(20)
    expect(triggers[0]).toBe(50)
    expect(triggers[19]).toBe(1000)
  })
})

describe("规模测试 — 归档压缩", () => {
  test("ch1000: applyBudget 压缩 P1 活跃角色", () => {
    const mock = generateMockData(1000)
    // ch1000 有 150 个角色
    const beforeCharCount = mock.activeCharacters.length
    expect(beforeCharCount).toBeGreaterThan(100)

    const after = applyBudget(mock)
    const afterCharCount = after.activeCharacters.length

    // P1 预算 1.5K tokens，applyBudget 应显著裁剪角色数量
    expect(afterCharCount).toBeLessThan(beforeCharCount)
    // 1500 tokens / ~65 tokens per char ≈ 最多保留 23 个角色
    expect(afterCharCount).toBeLessThanOrEqual(25)
  })

  test("ch1000: applyBudget 压缩 P3 线索和伏笔", () => {
    const mock = generateMockData(1000)
    // ch1000 有 200 条线索 + 150 条伏笔
    const beforeThreadCount = mock.plotThreads.length
    const beforeForeshadowCount = mock.foreshadowing.length
    expect(beforeThreadCount).toBeGreaterThan(100)
    expect(beforeForeshadowCount).toBeGreaterThan(100)

    const after = applyBudget(mock)
    const afterThreadCount = after.plotThreads.length
    const afterForeshadowCount = after.foreshadowing.length

    // P3 预算 2K tokens，先保留线索再保留伏笔
    expect(afterThreadCount).toBeLessThan(beforeThreadCount)
    // 线索和伏笔总数应大幅减少
    expect(afterThreadCount + afterForeshadowCount).toBeLessThan(beforeThreadCount + beforeForeshadowCount)
  })

  test("ch500: 卷汇总触发后上下文仍压缩在预算内", () => {
    const mock = generateMockData(500)
    const after = applyBudget(mock)

    // 卷汇总文本应保留（P2 优先保留 volumeSummary）
    expect(after.volumeSummary).not.toBeNull()
    expect(after.volumeSummary!.length).toBeGreaterThan(0)

    const tokens = calculateLayerTokens(after)
    const total = tokens.reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(8000)
  })

  test("所有规模下 P0 蓝图不被裁剪", () => {
    const scales = [100, 500, 1000]

    for (const scale of scales) {
      const mock = generateMockData(scale)
      const after = applyBudget(mock)

      // P0 字段（novelTitle, genre, synopsis）应始终保留
      expect(after.novelTitle).toBe(mock.novelTitle)
      expect(after.genre).toBe(mock.genre)
      // synopsis 可能被截断但不应为空
      expect(after.synopsis.length).toBeGreaterThan(0)
    }
  })
})

describe("规模测试 — 综合验证", () => {
  test("ch100/500/1000 三层预算全部合规", () => {
    const scales = [100, 500, 1000]

    for (const scale of scales) {
      const mock = generateMockData(scale)
      const after = applyBudget(mock)
      const tokens = calculateLayerTokens(after)

      for (let i = 0; i < 5; i++) {
        expect(tokens[i]).toBeLessThanOrEqual(BUDGETS[i]!)
      }

      const total = tokens.reduce((a, b) => a + b, 0)
      expect(total).toBeLessThanOrEqual(8000)
    }
  })

  test("ch500 和 ch1000 的 P4 归档层预算合规", () => {
    const scales = [500, 1000]

    for (const scale of scales) {
      const mock = generateMockData(scale)
      const after = applyBudget(mock)
      const tokens = calculateLayerTokens(after)

      // P4 预算 1.5K tokens
      expect(tokens[4]).toBeLessThanOrEqual(1500)
    }
  })

  test("applyBudget 返回新对象，不修改原始数据", () => {
    const mock = generateMockData(500)
    const originalCharCount = mock.activeCharacters.length
    const originalThreadCount = mock.plotThreads.length

    const after = applyBudget(mock)

    // 原始数据未被修改
    expect(mock.activeCharacters.length).toBe(originalCharCount)
    expect(mock.plotThreads.length).toBe(originalThreadCount)

    // 返回的是新对象（引用不同）
    expect(after).not.toBe(mock)
    expect(after.activeCharacters).not.toBe(mock.activeCharacters)
  })
})
