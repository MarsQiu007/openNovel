import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

// agent-memory-system Wave 4：五件套组装、权重三信号排序、预算截断、物化快照确定性重建。

const originalCwd = process.cwd()
const testDir = join(tmpdir(), `novel-memory-injection-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const NOVEL = "novel-injection"

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
  process.chdir(testDir)
})

afterAll(() => {
  const { closeDb } = require("@opennovel-ai/novel-store")
  closeDb()
  delete process.env.OPENNOVEL_DB
  process.chdir(originalCwd)
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

async function freshDb() {
  const store = await import("../../src/novel-writer/session-store.js")
  const db = store.getDb(null, { fresh: true })
  db.delete(store.MemoryInjectionSnapshotTable).run()
  db.delete(store.MemoryFactTable).run()
  db.delete(store.TechniqueTable).run()
  db.delete(store.ForeshadowingTable).run()
  db.delete(store.WorldEntryTable).run()
  db.delete(store.CharacterStateTable).run()
  db.delete(store.CharacterTable).run()
  db.delete(store.ChapterTable).run()
  db.delete(store.NovelTable).run()
  return store
}

beforeEach(async () => {
  const store = await freshDb()
  const db = store.getDb(null)
  db.insert(store.NovelTable).values({ id: NOVEL, title: "注入测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  for (let order = 1; order <= 5; order++) {
    db.insert(store.ChapterTable).values({
      id: `ch-${order}`,
      novel_id: NOVEL,
      title: `第${order}章`,
      content: "",
      word_count: 0,
      status: order < 5 ? "approved" : "draft",
      order,
    }).run()
  }
})

async function seedFull() {
  const store = await import("../../src/novel-writer/session-store.js")
  const db = store.getDb(null)

  // 角色：活跃（第4章状态 active=1）/ 静默（active=0）/ planned（未落文）/ 新落文（第3章）
  db.insert(store.CharacterTable).values({ id: "char-active", novel_id: NOVEL, name: "林天", role: "主角", description: "少年", created_at: 1 }).run()
  db.insert(store.CharacterStateTable).values({ id: "cs-1", character_id: "char-active", chapter_id: "ch-4", active: 1, location: "断魂崖", mood: "悲愤", summary: "抵达崖顶" }).run()
  db.insert(store.CharacterTable).values({ id: "char-quiet", novel_id: NOVEL, name: "路人", role: "配角", description: "", created_at: 1 }).run()
  db.insert(store.CharacterStateTable).values({ id: "cs-2", character_id: "char-quiet", chapter_id: "ch-2", active: 0 }).run()
  db.insert(store.CharacterTable).values({
    id: "char-planned", novel_id: NOVEL, name: "未登场反派", role: "反派", description: "卷二登场",
    establishment: "planned", created_at: 1,
  }).run()
  db.insert(store.CharacterTable).values({
    id: "char-new", novel_id: NOVEL, name: "新配角", role: "配角", description: "",
    establishment: "established", established_chapter_id: "ch-3", created_at: 1,
  }).run()
  db.insert(store.CharacterStateTable).values({ id: "cs-3", character_id: "char-new", chapter_id: "ch-3", active: 1 }).run()

  // 伏笔：planted 入包 / resolved 不入
  db.insert(store.ForeshadowingTable).values({ id: "fs-open", novel_id: NOVEL, planted_chapter_id: "ch-2", content: "银瞳症的来历", state: "planted", created_at: 1 }).run()
  db.insert(store.ForeshadowingTable).values({ id: "fs-done", novel_id: NOVEL, planted_chapter_id: "ch-1", resolved_chapter_id: "ch-3", content: "已回收伏笔", state: "resolved", created_at: 1 }).run()

  // 记忆事实：窗口内 approved/reviewed/pending 都入（降权）；窗口外（ch-1 相对目标 ch-5）不入
  const fact = (id: string, chapter: string, status: string, text: string) =>
    db.insert(store.MemoryFactTable).values({
      id, novel_id: NOVEL, chapter_id: chapter, fact_type: "timeline", text, status, created_at: 1, updated_at: 1,
    }).run()
  fact("fact-approved", "ch-4", "approved", "三日后黄昏抵达断魂崖")
  fact("fact-pending", "ch-3", "pending", "当夜守灵")
  fact("fact-old", "ch-1", "approved", "开篇离乡")

  // planned 世界观设定
  db.insert(store.WorldEntryTable).values({
    id: "we-planned", novel_id: NOVEL, category: "力量体系", title: "锻体九重", content: " Planned 设定正文",
    establishment: "planned", created_at: 1,
  }).run()

  // 技巧：verified 本书 / verified 库级遗留（novel_id null）/ unverified 不入 / 他书不入
  const tech = (id: string, name: string, status: string, novelId: string | null, ledger: string, usage = 0) =>
    db.insert(store.TechniqueTable).values({
      id, name, principle: "p", instruction: `${name}的写法`, scene_types: "[]", level: "scene",
      evidence: "[]", common_misuse: "", confidence: 0.8, status, scope: "general",
      usage_count: usage, usage_ledger: ledger, novel_id: novelId, created_at: 1, updated_at: 1,
    }).run()
  tech("tech-verified", "断章悬念", "verified", NOVEL, JSON.stringify([{ chapter: 4, count: 2 }, { chapter: 3, count: 1 }]))
  tech("tech-legacy", "视角切换", "verified", null, "[]", 7)
  tech("tech-unverified", "未验证技巧", "unverified", NOVEL, "[]")
  tech("tech-other", "他书技巧", "verified", "novel-other", "[]")
  return db
}

describe("记忆注入组装器", () => {
  test("五件套按来源与窗口正确取舍", async () => {
    const db = await seedFull()
    const { buildMemoryInjection } = await import("../../src/novel-writer/session-store.js")

    const built = await buildMemoryInjection(db, NOVEL, "ch-5")
    expect(built).not.toBeNull()
    if (!built) return
    const { payload } = built

    // 1. 出场角色：活跃入、静默出
    const charNames = payload.characters.map((c) => c.name)
    expect(charNames).toContain("林天")
    expect(charNames).toContain("新配角")
    expect(charNames).not.toContain("路人")
    expect(charNames).not.toContain("未登场反派")
    const lin = payload.characters.find((c) => c.name === "林天")
    expect(lin?.location).toBe("断魂崖")

    // 2. 活跃伏笔：planted 入、resolved 出
    expect(payload.foreshadows.map((f) => f.id)).toEqual(["fs-open"])

    // 3. 相邻章新事实：窗口内 approved+pending 入（pending 降权排后）、窗口外与新落文设定
    const factIds = payload.recentFacts.map((f) => f.id)
    expect(factIds).toContain("fact-approved")
    expect(factIds).toContain("fact-pending")
    expect(factIds).not.toContain("fact-old")
    expect(factIds).toContain("char:char-new")
    // 确认级别排序：approved 在 pending 前
    expect(factIds.indexOf("fact-approved")).toBeLessThan(factIds.indexOf("fact-pending"))

    // 4. planned 设定
    const plannedTitles = payload.plannedSettings.map((s) => s.title)
    expect(plannedTitles).toContain("未登场反派")
    expect(plannedTitles).toContain("锻体九重")

    // 5. 技巧卡：verified 本书+库级入、unverified/他书出；账本近因汇总
    const techNames = payload.techniques.map((t) => t.name)
    expect(techNames).toContain("断章悬念")
    expect(techNames).toContain("视角切换")
    expect(techNames).not.toContain("未验证技巧")
    expect(techNames).not.toContain("他书技巧")
    const suspense = payload.techniques.find((t) => t.name === "断章悬念")
    expect(suspense?.ledgerSummary).toBe("近14章已用 3 次")
    const legacy = payload.techniques.find((t) => t.name === "视角切换")
    expect(legacy?.ledgerSummary).toBe("历史累计 7 次")
  }, 60000)

  test("预算截断：超预算段按权重舍弃且总量受控", async () => {
    const store = await import("../../src/novel-writer/session-store.js")
    const db = store.getDb(null)
    const { MEMORY_INJECTION_BUDGET, buildMemoryInjection } = await import("../../src/novel-writer/session-store.js")

    // 造 30 条同权重 planned 设定（score 并列 → id 升序决胜），总量必超 600 tokens 段预算
    for (let i = 0; i < 30; i++) {
      const id = `we-bulk-${String(i).padStart(3, "0")}`
      db.insert(store.WorldEntryTable).values({
        id, novel_id: NOVEL, category: "物品", title: `设定${id}`,
        content: "这是一段用于占用预算的设定正文，重复填充以超过分段预算上限。", establishment: "planned", created_at: 1,
      }).run()
    }

    const built = await buildMemoryInjection(db, NOVEL, "ch-5")
    expect(built).not.toBeNull()
    if (!built) return
    expect(built.budgetUsed).toBeLessThanOrEqual(MEMORY_INJECTION_BUDGET.total)
    expect(built.payload.plannedSettings.length).toBeLessThan(30)
    expect(built.payload.plannedSettings.length).toBeGreaterThan(0)
    // 同分按 id 升序截断：最前者必在包内
    expect(built.payload.plannedSettings[0].id).toBe("we-bulk-000")
  }, 60000)

  test("技巧账本卷级汇总：目标章所属卷内按章分布（卷N已用 X/Y 章，Wave 8）", async () => {
    const store = await import("../../src/novel-writer/session-store.js")
    const db = store.getDb(null)
    const { inArray } = await import("drizzle-orm")

    // 卷二 = ch-3..ch-5（ch-1/ch-2 属卷一，无卷行时 volume_id 留空）
    db.insert(store.VolumeTable).values({ id: "vol-2", novel_id: NOVEL, title: "卷二", order: 2, created_at: 1 }).run()
    db.update(store.ChapterTable).set({ volume_id: "vol-2" }).where(inArray(store.ChapterTable.id, ["ch-3", "ch-4", "ch-5"])).run()
    db.insert(store.TechniqueTable).values({
      id: "tech-vol", name: "卷级技法", principle: "p", instruction: "卷级技法写法", scene_types: "[]", level: "scene",
      evidence: "[]", common_misuse: "", confidence: 0.8, status: "verified", scope: "general",
      usage_count: 4, usage_ledger: JSON.stringify([{ chapter: 1, count: 1 }, { chapter: 3, count: 1 }, { chapter: 4, count: 2 }]),
      novel_id: NOVEL, created_at: 1, updated_at: 1,
    }).run()

    const { buildMemoryInjection } = await import("../../src/novel-writer/session-store.js")
    const built = await buildMemoryInjection(db, NOVEL, "ch-5")
    const card = built?.payload.techniques.find((t) => t.id === "tech-vol")
    // 卷内 ch-3/ch-4 两章用过（ch-1 属卷一不计），卷二共 3 章
    expect(card?.ledgerSummary).toBe("卷2已用 2/3 章")

    // 卷内无使用时回退近 14 章窗口口径
    db.insert(store.TechniqueTable).values({
      id: "tech-vol-fallback", name: "卷外技法", principle: "p", instruction: "卷外技法写法", scene_types: "[]", level: "scene",
      evidence: "[]", common_misuse: "", confidence: 0.8, status: "verified", scope: "general",
      usage_count: 1, usage_ledger: JSON.stringify([{ chapter: 1, count: 1 }]),
      novel_id: NOVEL, created_at: 1, updated_at: 1,
    }).run()
    const rebuilt = await buildMemoryInjection(db, NOVEL, "ch-5")
    expect(rebuilt?.payload.techniques.find((t) => t.id === "tech-vol-fallback")?.ledgerSummary).toBe("近14章已用 1 次")
  }, 60000)

  test("物化快照确定性重建：同一输入必得同一注入包", async () => {
    const db = await seedFull()
    const store = await import("../../src/novel-writer/session-store.js")
    const { rebuildMemoryInjectionSnapshot, readMemoryInjectionSnapshot, buildMemoryInjection } = await import(
      "../../src/novel-writer/session-store.js"
    )

    expect(await rebuildMemoryInjectionSnapshot(db, NOVEL, "ch-5")).toBe(true)
    const first = await readMemoryInjectionSnapshot(db, NOVEL, "ch-5")
    expect(await rebuildMemoryInjectionSnapshot(db, NOVEL, "ch-5")).toBe(true)
    const second = await readMemoryInjectionSnapshot(db, NOVEL, "ch-5")
    expect(second).toEqual(first)

    const direct = await buildMemoryInjection(db, NOVEL, "ch-5")
    expect(direct?.payload).toEqual(first)

    const [row] = await db
      .select()
      .from(store.MemoryInjectionSnapshotTable)
      .all()
    expect(row.novel_id).toBe(NOVEL)
    expect(row.chapter_id).toBe("ch-5")
    expect(row.budget_used).toBe(direct?.budgetUsed)

    // 缺失快照读返回 null；目标章不存在时重建为 no-op
    expect(await readMemoryInjectionSnapshot(db, NOVEL, "ch-1")).toBeNull()
    expect(await rebuildMemoryInjectionSnapshot(db, NOVEL, "ch-missing")).toBe(false)
  }, 60000)
})
