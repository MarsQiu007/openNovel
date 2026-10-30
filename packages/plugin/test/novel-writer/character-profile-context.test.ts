/**
 * 角色档案上下文装配/渲染/预算测试（character-profile task 3.2）。
 *
 * 覆盖：两个渲染面（formatSnapshotToolOutput / renderSnapshotSection）的档案
 * 分字段渲染一致性、无档案角色维持原形态、混合书库同段共存、charTokens
 * 计入档案字段（applyBudget 按真实体积裁剪）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { closeDb, CharacterStateTable, CharacterTable, ChapterTable, getDb, NovelTable } from "@opennovel-ai/novel-store"
import { assembleSnapshot, formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import { renderSnapshotSection } from "../../src/novel-writer/tools/context-render.js"
import { assembleWriterSnapshot } from "../../src/novel-writer/recall.js"
import { applyBudget } from "../../src/novel-writer/budget.js"
import type { ContextPacket } from "../../src/novel-writer/context.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `char-profile-ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件句柄释放有延迟，尽力清理即可
  }
})

const PROFILE_JSON = JSON.stringify({
  appearance: "左脸旧疤",
  speech: "句尾带哼",
  tone: "冷、短句",
  personality: "外冷内热",
  mannerism: "思考时摩挲指环",
  extensions: { 武器风格: "双手重剑" },
})

/** 混合书库：一个带档案的活跃角色 + 一个无档案的活跃角色 */
async function seedMixedCharacters() {
  const db = getDb(dir)
  await db.insert(NovelTable).values({ id: "novel-ctx", title: "混合书", genre: "玄幻", synopsis: "" }).run()
  // character_states.chapter_id 有外键，补一个真实章节行
  await db.insert(ChapterTable).values({ id: "ch-dummy", novel_id: "novel-ctx", title: "第一章", order: 1 }).run()
  await db
    .insert(CharacterTable)
    .values({
      id: "char-with",
      novel_id: "novel-ctx",
      name: "林天",
      role: "protagonist",
      description: "青云门弟子。",
      profile: PROFILE_JSON,
    })
    .run()
  await db
    .insert(CharacterTable)
    .values({ id: "char-plain", novel_id: "novel-ctx", name: "苏瑶", role: "secondary", description: "药峰首席。" })
    .run()
  await db
    .insert(CharacterStateTable)
    .values([
      { id: "st-1", character_id: "char-with", chapter_id: "ch-dummy", active: 1, location: "青云门", mood: "冷" },
      { id: "st-2", character_id: "char-plain", chapter_id: "ch-dummy", active: 1, location: "药峰", mood: "静" },
    ])
    .run()
}

function charBlock(output: string, name: string): string[] {
  const lines = output.split("\n")
  const start = lines.findIndex((line) => line.includes(`- ${name}`))
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith("- ") || line.startsWith("【"))
  return [lines[start], ...rest.slice(0, end === -1 ? rest.length : end)]
}

describe("formatSnapshotToolOutput 档案渲染", () => {
  test("带档案角色分字段渲染，无档案角色维持原形态，混合同段共存", async () => {
    await seedMixedCharacters()
    const snapshot = await assembleSnapshot("novel-ctx", 0, dir)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.activeCharacters).toHaveLength(2)

    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    const withProfile = charBlock(result.output, "林天")
    const withoutProfile = charBlock(result.output, "苏瑶")

    // 核心四维独立行 + 次要行（习惯动作/扩展），行序：描述→档案→位置
    expect(withProfile[0]).toBe("- 林天（protagonist）：青云门弟子。")
    expect(withProfile).toContain("  身体特征：左脸旧疤")
    expect(withProfile).toContain("  说话习惯：句尾带哼")
    expect(withProfile).toContain("  语气：冷、短句")
    expect(withProfile).toContain("  个性：外冷内热")
    expect(withProfile).toContain("  习惯动作：思考时摩挲指环")
    expect(withProfile).toContain("  扩展：武器风格=双手重剑")
    expect(withProfile[withProfile.length - 1]).toContain("位置：青云门")

    // 无档案角色维持原形态，不出现任何档案行
    expect(withoutProfile[0]).toBe("- 苏瑶（secondary）：药峰首席。")
    expect(withoutProfile.some((line) => line.includes("身体特征") || line.includes("扩展："))).toBe(false)
  })

  test("次要行有值才渲染：只有习惯动作与扩展的角色不产生核心四维空行", async () => {
    const db = getDb(dir)
    await db.insert(NovelTable).values({ id: "novel-ctx2", title: "次要行书", genre: "玄幻", synopsis: "" }).run()
    await db.insert(ChapterTable).values({ id: "ch-dummy-2", novel_id: "novel-ctx2", title: "第一章", order: 1 }).run()
    await db
      .insert(CharacterTable)
      .values({
        id: "char-min",
        novel_id: "novel-ctx2",
        name: "独孤",
        role: "secondary",
        description: "剑客。",
        profile: JSON.stringify({ mannerism: "擦剑", extensions: { 剑名: "听雨" } }),
      })
      .run()
    await db
      .insert(CharacterStateTable)
      .values({ id: "st-min", character_id: "char-min", chapter_id: "ch-dummy-2", active: 1, location: "", mood: "" })
      .run()

    const snapshot = await assembleSnapshot("novel-ctx2", 0, dir)
    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    const block = charBlock(result.output, "独孤")
    expect(block).toContain("  习惯动作：擦剑")
    expect(block).toContain("  扩展：剑名=听雨")
    expect(block.some((line) => line.includes("身体特征") || line.includes("说话习惯") || line.includes("语气") || line.includes("个性"))).toBe(false)
    // 位置/情绪为空且无 summary 时不渲染状态行（原行为）
    expect(block.some((line) => line.includes("位置"))).toBe(false)
  })
})

describe("renderSnapshotSection 档案渲染", () => {
  test("系统注入段与工具输出面渲染一致", async () => {
    await seedMixedCharacters()
    const snapshot = await assembleWriterSnapshot("novel-ctx", 0, dir)
    expect(snapshot).not.toBeNull()
    const section = renderSnapshotSection(snapshot!)

    expect(section).toContain("- 林天（protagonist）：青云门弟子。")
    expect(section).toContain("  身体特征：左脸旧疤")
    expect(section).toContain("  说话习惯：句尾带哼")
    expect(section).toContain("  习惯动作：思考时摩挲指环")
    expect(section).toContain("  扩展：武器风格=双手重剑")
    expect(section).toContain("- 苏瑶（secondary）：药峰首席。")
    // 混合同段：苏瑶块不带档案行
    expect(charBlock(section, "苏瑶").some((line) => line.includes("身体特征"))).toBe(false)
  })
})

describe("applyBudget 档案计入角色 token", () => {
  function makePacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
    return {
      novelTitle: "预算书",
      genre: "玄幻",
      synopsis: "一个预算测试故事".repeat(10),
      activeCharacters: [],
      departedCharacters: [],
      volumeSummary: null,
      recentChapterSummaries: [],
      segmentSummaries: [],
      plotThreads: [],
      foreshadowing: [],
      styleGuide: null,
      genreRules: [],
      worldEntries: [],
      worldEntryIndex: [],
      recalledHistory: [],
      volumeList: [],
      relationships: [],
      chapterOutline: null,
      prevChapterTail: null,
      targetWordCount: 2500,
      ...overrides,
    }
  }

  const baseChar = {
    role: "配角",
    description: "一个角色".repeat(20),
    location: "某地",
    mood: "平静",
    summary: "状态摘要",
  }
  // 每个角色约 1.4K token 档案体积，30 个角色必然超出 P1 角色预算
  const heavyProfile = { appearance: "档案体积填充".repeat(140) }

  test("带档案角色占用更多预算：同规模下保留数更少", () => {
    const plainPacket = makePacket({
      activeCharacters: Array.from({ length: 30 }, (_, i) => ({ name: `角色${i}`, ...baseChar })),
    })
    const profilePacket = makePacket({
      activeCharacters: Array.from({ length: 30 }, (_, i) => ({
        name: `角色${i}`,
        ...baseChar,
        profile: heavyProfile,
      })),
    })
    const plain = applyBudget(plainPacket)
    const withProfile = applyBudget(profilePacket)
    expect(withProfile.activeCharacters.length).toBeLessThan(plain.activeCharacters.length)
  })
})
