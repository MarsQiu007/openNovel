/**
 * 书稿分层写作规范测试（agent-instruction-layering）
 *
 * 覆盖 discoverInstructions 的三层收集/缺失跳过/无卷两层/读取失败降级，
 * instructionLines 渲染顺序（远→近注入、近者优先），applyBudget 的 P4b
 * 预算截断（远层整层截断、最近层按字符截断），以及 assembleSnapshot 集成。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { closeDb, getDb, NovelTable, VolumeTable, ChapterTable } from "../../src/novel-writer/session-store.js"
import { discoverInstructions, type InstructionLayer } from "../../src/novel-writer/instructions.js"
import {
  assembleSnapshot,
  formatSnapshotToolOutput,
  instructionLines,
  INSTRUCTIONS_TRUNCATED_HINT,
  type ContextPacket,
} from "../../src/novel-writer/context.js"
import { applyBudget } from "../../src/novel-writer/budget.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `novel-instructions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(dir, ".novel", "instructions"), { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下文件句柄释放有延迟，尽力清理即可
  }
})

function writeInstruction(name: string, content: string): void {
  writeFileSync(join(dir, ".novel", "instructions", name), content, "utf-8")
}

describe("discoverInstructions 分层收集", () => {
  test("三层齐全时按远→近返回 book → volume → chapter", () => {
    writeInstruction("book.md", "全书规范")
    writeInstruction("volume-2.md", "第二卷规范")
    writeInstruction("chapter-5.md", "第五章规范")

    const layers = discoverInstructions(dir, 2, 5)
    expect(layers.map((l) => l.content)).toEqual(["全书规范", "第二卷规范", "第五章规范"])
    expect(layers[0].path).toEndWith(join("instructions", "book.md"))
    expect(layers[1].path).toEndWith(join("instructions", "volume-2.md"))
    expect(layers[2].path).toEndWith(join("instructions", "chapter-5.md"))
  })

  test("缺失层静默跳过，只返回存在的层", () => {
    writeInstruction("book.md", "全书规范")

    const layers = discoverInstructions(dir, 2, 5)
    expect(layers.map((l) => l.content)).toEqual(["全书规范"])
  })

  test("空白内容文件不产生注入层", () => {
    writeInstruction("book.md", "全书规范")
    writeInstruction("chapter-5.md", "   \n  ")

    const layers = discoverInstructions(dir, 2, 5)
    expect(layers.map((l) => l.content)).toEqual(["全书规范"])
  })

  test("无卷书稿只生效 book/chapter 两层（volumeOrder 为 null 时忽略卷层文件）", () => {
    writeInstruction("book.md", "全书规范")
    writeInstruction("volume-2.md", "不应被收集")
    writeInstruction("chapter-5.md", "第五章规范")

    const layers = discoverInstructions(dir, null, 5)
    expect(layers.map((l) => l.content)).toEqual(["全书规范", "第五章规范"])
  })

  test("目录不存在时返回空数组", () => {
    rmSync(join(dir, ".novel", "instructions"), { recursive: true })
    expect(discoverInstructions(dir, 2, 5)).toEqual([])
  })

  test("读取失败的层以 degraded 标记保留（目录占位同名文件触发读取异常）", () => {
    writeInstruction("book.md", "全书规范")
    // 与目标文件同名的目录：existsSync 为 true 但 readFileSync 抛错
    mkdirSync(join(dir, ".novel", "instructions", "chapter-5.md"))

    const layers = discoverInstructions(dir, null, 5)
    expect(layers).toHaveLength(2)
    expect(layers[0].content).toBe("全书规范")
    expect(layers[1].degraded).toBe(true)
    expect(layers[1].content).toBe("")
    expect(layers[1].path).toEndWith(join("instructions", "chapter-5.md"))
  })
})

describe("instructionLines 渲染", () => {
  const layers: InstructionLayer[] = [
    { path: join("proj", ".novel", "instructions", "book.md"), content: "全书规范" },
    { path: join("proj", ".novel", "instructions", "volume-1.md"), content: "卷规范" },
    { path: join("proj", ".novel", "instructions", "chapter-3.md"), content: "章规范" },
  ]

  test("远→近逐层注入（近者后注入、自然优先），每层带来源行", () => {
    const lines = instructionLines(layers, false)
    const text = lines.join("\n")
    expect(text.indexOf("全书规范")).toBeLessThan(text.indexOf("卷规范"))
    expect(text.indexOf("卷规范")).toBeLessThan(text.indexOf("章规范"))
    expect(lines.filter((l) => l.startsWith("Instructions from: "))).toHaveLength(3)
  })

  test("degraded 层渲染降级提示、不渲染来源行", () => {
    const lines = instructionLines([{ path: "bad.md", content: "", degraded: true }], false)
    expect(lines).toEqual(["（规范文件读取失败，已跳过：bad.md）"])
  })

  test("truncated 时追加截断提示", () => {
    const lines = instructionLines(layers, true)
    expect(lines[lines.length - 1]).toBe(INSTRUCTIONS_TRUNCATED_HINT)
  })
})

function makePacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    novelTitle: "测试小说",
    genre: "玄幻",
    synopsis: "一个测试故事",
    storySpine: null,
    chapterOutline: null,
    activeCharacters: [],
    departedCharacters: [],
    volumeSummary: null,
    recentChapterSummaries: [],
    segmentSummaries: [],
    plotThreads: [],
    foreshadowing: [],
    activeArcs: [],
    styleGuide: null,
    styleGuideTruncated: false,
    genreRules: [],
    instructions: [],
    instructionsTruncated: false,
    worldEntries: [],
    worldEntryIndex: [],
    volumeList: [],
    relationships: [],
    protectedRelationships: [],
    relationshipContextTruncated: false,
    recalledHistory: [],
    prevChapterTail: null,
    targetWordCount: null,
    chapterLengthLimit: false,
    techniques: [],
    ...overrides,
  }
}

describe("applyBudget P4b 写作规范", () => {
  test("预算充足时全层保留、不设截断标记", () => {
    const result = applyBudget(
      makePacket({
        instructions: [
          { path: "book.md", content: "全书规范" },
          { path: "chapter-1.md", content: "章规范" },
        ],
      }),
    )
    expect(result.instructions.map((l) => l.content)).toEqual(["全书规范", "章规范"])
    expect(result.instructionsTruncated).toBe(false)
  })

  test("超限时远层整层截断、近层完整保留并附截断提示", () => {
    const farContent = "远层规范内容".repeat(300) // 约 2100 字符，远超 1K token 预算
    const result = applyBudget(
      makePacket({
        instructions: [
          { path: "book.md", content: farContent },
          { path: "chapter-1.md", content: "章规范" },
        ],
      }),
    )
    expect(result.instructionsTruncated).toBe(true)
    expect(result.instructions.map((l) => l.content)).toEqual(["章规范"])

    const output = formatSnapshotToolOutput(result, { hooks: [] }).output
    expect(output).toContain("章规范")
    expect(output).not.toContain("远层规范内容")
    expect(output).toContain(INSTRUCTIONS_TRUNCATED_HINT)
  })

  test("最近一层自身超预算时按字符截断保留", () => {
    const nearContent = "近层规范内容".repeat(300)
    const result = applyBudget(makePacket({ instructions: [{ path: "chapter-1.md", content: nearContent }] }))
    expect(result.instructionsTruncated).toBe(true)
    expect(result.instructions).toHaveLength(1)
    expect(result.instructions[0].content.length).toBeLessThan(nearContent.length)
    expect(result.instructions[0].content.length).toBeGreaterThan(0)
  })

  test("无规范层时不产生规范段", () => {
    const output = formatSnapshotToolOutput(makePacket(), { hooks: [] }).output
    expect(output).not.toContain("写作规范")
  })
})

describe("assembleSnapshot 写作规范集成", () => {
  async function seedNovelWithVolume() {
    const db = getDb(dir)
    await db.insert(NovelTable).values({ id: "novel-1", title: "测试", genre: "科幻", synopsis: "" }).run()
    await db
      .insert(VolumeTable)
      .values({ id: "vol-2", novel_id: "novel-1", title: "第二卷", summary: "", order: 2, created_at: 1 })
      .run()
    await db
      .insert(ChapterTable)
      .values({
        id: "ch-5",
        novel_id: "novel-1",
        volume_id: "vol-2",
        title: "第五章",
        content: "",
        word_count: 0,
        status: "draft",
        order: 5,
        created_at: 1,
        updated_at: 1,
      })
      .run()
  }

  test("快照收集当前卷/章生效的规范层并按层级排序渲染", async () => {
    await seedNovelWithVolume()
    writeInstruction("book.md", "全书规范")
    writeInstruction("volume-2.md", "第二卷规范")
    writeInstruction("volume-1.md", "不应出现（非当前卷）")
    writeInstruction("chapter-5.md", "第五章规范")
    writeInstruction("chapter-6.md", "不应出现（非当前章）")

    const snapshot = await assembleSnapshot("novel-1", 5, dir)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.instructions.map((l) => l.content)).toEqual(["全书规范", "第二卷规范", "第五章规范"])
    expect(snapshot!.instructionsTruncated).toBe(false)

    const output = formatSnapshotToolOutput(snapshot!, { hooks: [] }).output
    expect(output).toContain("═══ 写作规范（分层：全书 → 卷 → 章，近者优先）═══")
    expect(output.indexOf("全书规范")).toBeLessThan(output.indexOf("第二卷规范"))
    expect(output.indexOf("第二卷规范")).toBeLessThan(output.indexOf("第五章规范"))
    expect(output).not.toContain("不应出现")
  })

  test("无规范文件时快照 instructions 为空、输出无规范段", async () => {
    await seedNovelWithVolume()
    const snapshot = await assembleSnapshot("novel-1", 5, dir)
    expect(snapshot!.instructions).toEqual([])

    const output = formatSnapshotToolOutput(snapshot!, { hooks: [] }).output
    expect(output).not.toContain("写作规范")
  })
})
