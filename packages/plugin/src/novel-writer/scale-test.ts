/**
 * 规模测试 — 验证上下文快照在 100/500/1000 章场景下 token 预算合规
 *
 * 测试方法：
 * 1. 生成模拟 ContextPacket 数据（模拟不同规模的小说）
 * 2. 调用 applyBudget 进行预算裁剪
 * 3. 记录每层 token 数，验证总 token 数 <= 8K
 *
 * 预算分配：P0 1K + P1 1.5K + P2 2K + P3 2K + P4 1.5K = 8K
 */

import { applyBudget } from "./budget.js"
import type {
  ContextPacket,
  ActiveCharacter,
  ChapterSummaryItem,
  PlotThreadSummary,
  ForeshadowingSummary,
  StyleGuideInfo,
} from "./context.js"

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

// ─── 模拟数据生成 ───

/**
 * 生成模拟 ContextPacket
 *
 * 模拟 assembleSnapshot 的输出结构，数据量随章节数增长。
 * 各层数据量设计：
 * - P1 角色数 ≈ chapterCount * 15%
 * - P3 线索数 ≈ chapterCount * 20%，伏笔数 ≈ chapterCount * 15%
 * - P2 固定 3 章摘要（与 assembleSnapshot 行为一致）
 * - P0 和 P4 固定不变
 */
function generateMockData(chapterCount: number): ContextPacket {
  const charCount = Math.max(5, Math.floor(chapterCount * 0.15)) // 角色数：章节数 * 15%
  const threadCount = Math.max(3, Math.floor(chapterCount * 0.2)) // 线索数：章节数 * 20%
  const foreshadowCount = Math.max(3, Math.floor(chapterCount * 0.15)) // 伏笔数：章节数 * 15%
  const genreRuleCount = 8 // 固定 8 条题材规则

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
      id: `fs-${i}`,
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
    departedCharacters: [],
    volumeSummary,
    recentChapterSummaries,
    plotThreads,
    foreshadowing,
    styleGuide,
    genreRules,
    worldEntries: [],
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

/** 单层测试报告 */
interface LayerReport {
  name: string
  budget: number
  before: number
  after: number
  status: "pass" | "fail"
  itemsBefore: number
  itemsAfter: number
}

/** 规模测试报告 */
interface TestReport {
  scale: string
  chapterCount: number
  layers: LayerReport[]
  totalBefore: number
  totalAfter: number
  overallPass: boolean
}

/**
 * 运行单个规模测试
 *
 * 1. 生成模拟数据
 * 2. 测量裁剪前 token
 * 3. 调用 applyBudget
 * 4. 测量裁剪后 token
 * 5. 验证每层 <= 预算且总 token <= 8K
 */
function runTest(chapterCount: number): TestReport {
  const budgets = [1000, 1500, 2000, 2000, 1500]
  const layerNames = ["P0 蓝图", "P1 活跃角色", "P2 卷+章摘要", "P3 线索+伏笔", "P4 风格+规则"]

  const mock = generateMockData(chapterCount)
  const before = calculateLayerTokens(mock)
  const itemsBefore = [
    3, // novelTitle + genre + synopsis = 3 个字段
    mock.activeCharacters.length,
    (mock.volumeSummary ? 1 : 0) + mock.recentChapterSummaries.length,
    mock.plotThreads.length + mock.foreshadowing.length,
    (mock.styleGuide ? 1 : 0) + mock.genreRules.length,
  ]

  const afterPacket = applyBudget(mock)
  const after = calculateLayerTokens(afterPacket)
  const itemsAfter = [
    3,
    afterPacket.activeCharacters.length,
    (afterPacket.volumeSummary ? 1 : 0) + afterPacket.recentChapterSummaries.length,
    afterPacket.plotThreads.length + afterPacket.foreshadowing.length,
    (afterPacket.styleGuide ? 1 : 0) + afterPacket.genreRules.length,
  ]

  const layers: LayerReport[] = layerNames.map((name, i) => ({
    name,
    budget: budgets[i],
    before: before[i],
    after: after[i],
    status: after[i] <= budgets[i] ? "pass" : "fail",
    itemsBefore: itemsBefore[i],
    itemsAfter: itemsAfter[i],
  }))

  const totalBefore = before.reduce((a, b) => a + b, 0)
  const totalAfter = after.reduce((a, b) => a + b, 0)
  const overallPass = layers.every((l) => l.status === "pass") && totalAfter <= 8000

  return {
    scale: `ch${chapterCount}`,
    chapterCount,
    layers,
    totalBefore,
    totalAfter,
    overallPass,
  }
}

/** 打印单个规模测试报告 */
function printReport(report: TestReport): void {
  const sep = "=".repeat(70)
  const dash = "-".repeat(70)

  console.log(`\n${sep}`)
  console.log(`  规模测试：${report.scale}（${report.chapterCount} 章）`)
  console.log(`${sep}`)

  console.log(`\n  ├─ 预算分配：P0 1K + P1 1.5K + P2 2K + P3 2K + P4 1.5K = 8K`)
  console.log(`  ├─ 裁剪前总计：${report.totalBefore} tokens`)
  console.log(`  ├─ 裁剪后总计：${report.totalAfter} tokens`)
  console.log(`  ├─ 预算上限：8,000 tokens`)
  console.log(`  └─ 结果：${report.overallPass ? "✅ 通过" : "❌ 未通过"}`)

  console.log(`\n  ${dash}`)
  console.log(`  层级详情`)
  console.log(`  ${dash}`)
  console.log(
    `  ${"层级".padEnd(16)} ${"预算".padEnd(8)} ${"裁剪前".padEnd(10)} ${"裁剪后".padEnd(10)} ${"条目(前→后)".padEnd(16)} ${"状态"}`,
  )
  console.log(`  ${dash}`)

  for (const layer of report.layers) {
    const statusStr = layer.status === "pass" ? "✅ 通过" : "❌ 超预算"
    const itemsStr = `${String(layer.itemsBefore)}→${String(layer.itemsAfter)}`
    console.log(
      `  ${layer.name.padEnd(16)}` +
        `${String(layer.budget).padStart(8)}` +
        `${String(layer.before).padStart(10)}` +
        `${String(layer.after).padStart(10)}` +
        `${itemsStr.padStart(16)}` +
        `  ${statusStr}`,
    )
  }
  console.log()
}

// ─── 主入口 ───

async function main(): Promise<void> {
  console.log(
    "\n╔══════════════════════════════════════════════════════════════════════╗\n" +
      "║           上下文快照 Token 预算规模测试                              ║\n" +
      "║           测试场景：ch100 / ch500 / ch1000                          ║\n" +
      "╚══════════════════════════════════════════════════════════════════════╝",
  )

  const scenarios = [100, 500, 1000]
  const reports = scenarios.map(runTest)

  for (const report of reports) {
    printReport(report)
  }

  // 汇总
  console.log("=".repeat(70))
  console.log("  汇总")
  console.log("=".repeat(70))

  const allPass = reports.every((r) => r.overallPass)
  for (const r of reports) {
    const statusStr = r.overallPass ? "✅ 通过" : "❌ 未通过"
    console.log(
      `  ${r.scale.padEnd(8)}：裁剪前 ${String(r.totalBefore).padStart(6)} tokens →` +
        ` 裁剪后 ${String(r.totalAfter).padStart(5)} tokens  ${statusStr}`,
    )
  }
  console.log(`\n  总体结论：${allPass ? "✅ 所有场景均通过预算检查" : "❌ 存在未通过场景"}`)
  console.log()

  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error("测试执行失败:", err)
  process.exit(1)
})
