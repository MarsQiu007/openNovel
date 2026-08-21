/**
 * 规模测试 — 验证写作快照在 100/500/1000 章场景下 token 预算合规。
 *
 * P0-P6 分层预算合计 12K，章纲单独保留 1.5K，总硬上限 13.5K。
 */

import { applyBudget } from "./budget.js"
import type {
  ContextPacket,
  ActiveCharacter,
  ChapterSummaryItem,
  PlotThreadSummary,
  ForeshadowingSummary,
  StyleGuideInfo,
  WorldEntrySummary,
  WorldEntryIndexItem,
  RelationshipSummary,
  VolumeListItem,
  RecalledHistoryItem,
} from "./context.js"

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

function charTokens(char: ActiveCharacter): number {
  return estimateTokens(char.name + char.role + char.description + char.location + char.mood + char.summary)
}

function chapterTokens(ch: ChapterSummaryItem): number {
  return estimateTokens(ch.chapterTitle + ch.summary + ch.keyEvents.join(""))
}

function threadTokens(t: PlotThreadSummary): number {
  return estimateTokens(t.title + t.status + t.priority + t.description)
}

function foreshadowTokens(f: ForeshadowingSummary): number {
  return estimateTokens(f.content + f.state + (f.plantedChapterId ?? ""))
}

function styleGuideTokens(sg: StyleGuideInfo): number {
  return estimateTokens(JSON.stringify(sg.rules) + sg.tone + sg.pov + sg.tense)
}

function worldEntryTokens(w: WorldEntrySummary): number {
  return estimateTokens(w.category + w.title + w.content)
}

function worldEntryIndexTokens(item: WorldEntryIndexItem): number {
  return estimateTokens(item.category + item.title)
}

function relationshipTokens(r: RelationshipSummary): number {
  return estimateTokens(r.type + r.description + r.charAName + r.charBName)
}

function volumeTokens(v: VolumeListItem): number {
  return estimateTokens(v.title + v.summary)
}

function recalledHistoryTokens(r: RecalledHistoryItem): number {
  return estimateTokens(r.chapterTitle + r.summary + r.keyEvents.join(""))
}

function generateMockData(chapterCount: number): ContextPacket {
  const charCount = Math.max(5, Math.floor(chapterCount * 0.15))
  const threadCount = Math.max(3, Math.floor(chapterCount * 0.2))
  const foreshadowCount = Math.max(3, Math.floor(chapterCount * 0.15))
  const worldEntryCount = Math.min(200, Math.max(20, Math.floor(chapterCount * 0.2)))
  const relationshipCount = Math.min(80, Math.max(10, Math.floor(charCount * 0.8)))
  const volumeCount = Math.ceil(chapterCount / 50)

  const activeCharacters: ActiveCharacter[] = []
  for (let i = 1; i <= charCount; i++) {
    activeCharacters.push({
      name: `角色${i}`,
      role: i <= 3 ? "主角" : i <= 6 ? "重要配角" : "配角",
      description: `这是角色${i}的描述。${i % 2 === 0 ? "性格沉稳，心思缜密，擅长谋略。" : "性格豪爽，直来直往，实力强大。"}曾是某门派弟子，后加入主角团队。`,
      location: i % 3 === 0 ? "星辰阁" : i % 3 === 1 ? "天元城" : "秘境深处",
      mood: i % 2 === 0 ? "平静" : "激动",
      summary: `角色${i}当前状态：${i % 3 === 0 ? "正在修炼中" : "跟随主角探索秘境"}。最近经历大战，实力有所提升。`,
    })
  }

  const volumeNumber = volumeCount
  const volumeSummary =
    `## 卷${volumeNumber}摘要\n\n` +
    `### 主要事件\n` +
    `- 第${(volumeNumber - 1) * 50 + 1}章《序幕》：故事开始，主角登场。\n` +
    `- 第${(volumeNumber - 1) * 50 + 2}章《奇遇》：主角获得神秘玉佩。\n\n` +
    `### 角色变化\n` +
    `活跃角色：角色1、角色2、角色3\n` +
    `休眠角色：角色4、角色5\n\n` +
    `### 线索进展\n` +
    `开放线索：神秘玉佩的秘密、主角的身世之谜`

  const recentChapterSummaries: ChapterSummaryItem[] = []
  const start = Math.max(1, chapterCount - 2)
  for (let i = 0; i < 3 && start + i <= chapterCount; i++) {
    const order = start + i
    recentChapterSummaries.push({
      chapterOrder: order,
      chapterTitle: `第${order}章`,
      summary: `这是第${order}章的摘要。本章主要讲述主角${order % 2 === 0 ? "与敌人激战" : "探索秘境"}的过程。`,
      keyEvents: ["遭遇强敌", "获得宝物", "结识新伙伴", "为后续剧情埋下伏笔"],
    })
  }

  const plotThreads: PlotThreadSummary[] = []
  for (let i = 1; i <= threadCount; i++) {
    plotThreads.push({
      title: `线索${i}`,
      status: i > threadCount * 0.3 ? "open" : "closed",
      priority: i <= 3 ? "high" : i <= 8 ? "medium" : "low",
      description: `这是关于线索${i}的详细描述，涉及多个势力和历史伏笔，重要性随剧情推进变化。`,
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

  const categories = ["力量体系", "地理势力", "器物秘闻", "种族传承"]
  const worldEntries: WorldEntrySummary[] = []
  for (let i = 1; i <= worldEntryCount; i++) {
    worldEntries.push({
      id: `w${i}`,
      category: categories[i % categories.length],
      title: `设定${i}`,
      content: "这是一个长篇小说中需要保持一致的世界观硬约束条目。".repeat(12),
    })
  }

  const relationships: RelationshipSummary[] = []
  for (let i = 1; i <= relationshipCount; i++) {
    const a = ((i - 1) % charCount) + 1
    const b = (i % charCount) + 1
    relationships.push({
      type: i % 3 === 0 ? "盟友" : i % 3 === 1 ? "敌对" : "亲属",
      description: `角色${a}与角色${b}之间存在复杂关系，并在近期剧情中影响彼此决策。`,
      charAName: `角色${a}`,
      charBName: `角色${b}`,
    })
  }

  const volumeList: VolumeListItem[] = []
  for (let i = 1; i <= volumeCount; i++) {
    volumeList.push({
      order: i,
      title: `第${i}卷`,
      summary: `第${i}卷摘要：主角进入新阶段，遭遇新的势力和挑战，并推进多条主线线索。`,
    })
  }

  const recalledHistory: RecalledHistoryItem[] = []
  for (let i = 1; i <= 10; i++) {
    recalledHistory.push({
      chapterOrder: i,
      chapterTitle: `第${i}章`,
      summary: "这是与当前章纲高度相关的历史章节摘要，包含承诺、数字、事件和人物状态。".repeat(12),
      keyEvents: ["关键事件A", "关键事件B"],
      matchedBy: i % 2 === 0 ? "entity" : "fts",
      matchedEntities: ["实体名"],
      score: 100 - i,
    })
  }

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

  return {
    novelTitle: "星辰变",
    genre: "玄幻",
    synopsis: "这是一个关于修炼与成长的故事。主角从小镇少年开始，历经磨难，最终成为一代强者。".repeat(4),
    activeCharacters,
    departedCharacters: [],
    volumeSummary,
    recentChapterSummaries,
    plotThreads,
    foreshadowing,
    styleGuide,
    genreRules: [
      "修炼体系要清晰，从低到高有明确等级划分",
      "境界突破要有铺垫，不能突兀升级",
      "战斗描写要精彩，体现策略和力量对比",
      "不要主角无敌，要有挫折和成长",
      "伏笔要及时回收，前后呼应",
      "世界观要自洽，设定前后一致",
      "节奏要张弛有度，高潮和铺垫交替",
    ],
    worldEntries,
    worldEntryIndex: [],
    recalledHistory,
    volumeList,
    relationships,
    chapterOutline: "本章大纲需要明确主角目标、冲突升级、关键设定和结尾钩子。".repeat(120),
    prevChapterTail: null,
    targetWordCount: 2500,
    techniques: [],
  }
}

type LayerTokens = [number, number, number, number, number, number, number, number]

function calculateLayerTokens(packet: ContextPacket): LayerTokens {
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
  const p5 =
    packet.worldEntries.reduce((sum, w) => sum + worldEntryTokens(w), 0) +
    packet.worldEntryIndex.reduce((sum, item) => sum + worldEntryIndexTokens(item), 0) +
    packet.volumeList.reduce((sum, v) => sum + volumeTokens(v), 0) +
    packet.relationships.reduce((sum, r) => sum + relationshipTokens(r), 0)
  const p6 = packet.recalledHistory.reduce((sum, r) => sum + recalledHistoryTokens(r), 0)
  const outline = packet.chapterOutline ? estimateTokens(packet.chapterOutline) : 0
  return [p0, p1, p2, p3, p4, p5, p6, outline]
}

interface LayerReport {
  name: string
  budget: number
  before: number
  after: number
  status: "pass" | "fail"
  itemsBefore: number
  itemsAfter: number
}

interface TestReport {
  scale: string
  chapterCount: number
  layers: LayerReport[]
  totalBefore: number
  totalAfter: number
  overallPass: boolean
}

function runTest(chapterCount: number): TestReport {
  const budgets = [1000, 1500, 2000, 2000, 1000, 2000, 2500, 1500]
  const layerNames = ["P0 蓝图", "P1 角色", "P2 近期", "P3 线索", "P4 风格", "P5 设定", "P6 召回", "章纲"]

  const mock = generateMockData(chapterCount)
  const before = calculateLayerTokens(mock)
  const itemsBefore = [
    3,
    mock.activeCharacters.length,
    (mock.volumeSummary ? 1 : 0) + mock.recentChapterSummaries.length,
    mock.plotThreads.length + mock.foreshadowing.length,
    (mock.styleGuide ? 1 : 0) + mock.genreRules.length,
    mock.worldEntries.length + mock.worldEntryIndex.length + mock.volumeList.length + mock.relationships.length,
    mock.recalledHistory.length,
    mock.chapterOutline ? 1 : 0,
  ]

  const afterPacket = applyBudget(mock)
  const after = calculateLayerTokens(afterPacket)
  const itemsAfter = [
    3,
    afterPacket.activeCharacters.length,
    (afterPacket.volumeSummary ? 1 : 0) + afterPacket.recentChapterSummaries.length,
    afterPacket.plotThreads.length + afterPacket.foreshadowing.length,
    (afterPacket.styleGuide ? 1 : 0) + afterPacket.genreRules.length,
    afterPacket.worldEntries.length + afterPacket.worldEntryIndex.length + afterPacket.volumeList.length + afterPacket.relationships.length,
    afterPacket.recalledHistory.length,
    afterPacket.chapterOutline ? 1 : 0,
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
  const overallPass = layers.every((l) => l.status === "pass") && totalAfter <= 13500

  return { scale: `ch${chapterCount}`, chapterCount, layers, totalBefore, totalAfter, overallPass }
}

function printReport(report: TestReport): void {
  const sep = "=".repeat(76)
  const dash = "-".repeat(76)
  console.log(`\n${sep}`)
  console.log(`  规模测试：${report.scale}（${report.chapterCount} 章）`)
  console.log(sep)
  console.log(`  预算：P0-P6 = 12K，章纲 = 1.5K，总硬上限 = 13.5K`)
  console.log(`  裁剪前：${report.totalBefore} tokens；裁剪后：${report.totalAfter} tokens`)
  console.log(`  结果：${report.overallPass ? "PASS" : "FAIL"}`)
  console.log(dash)
  for (const layer of report.layers) {
    const status = layer.status === "pass" ? "PASS" : "FAIL"
    console.log(
      `  ${layer.name.padEnd(10)} budget=${String(layer.budget).padStart(5)} before=${String(layer.before).padStart(6)} after=${String(layer.after).padStart(6)} items=${String(layer.itemsBefore).padStart(4)}->${String(layer.itemsAfter).padStart(4)} ${status}`,
    )
  }
}

async function main(): Promise<void> {
  const reports = [100, 500, 1000].map(runTest)
  for (const report of reports) printReport(report)

  const allPass = reports.every((r) => r.overallPass)
  console.log("\n汇总")
  for (const r of reports) {
    console.log(`  ${r.scale}: ${r.totalAfter} tokens ${r.overallPass ? "PASS" : "FAIL"}`)
  }
  console.log(`\n总体结论：${allPass ? "所有场景均通过预算检查" : "存在未通过场景"}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error("测试执行失败:", err)
  process.exit(1)
})
