import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq, isNull } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  NovelTable,
  ChapterTable,
  ChapterSummaryTable,
  CharacterTable,
  EntityRefTable,
  SegmentSummaryTable,
  StorySpineEntryTable,
  computeFingerprint,
} from "../src/index.js"
import {
  UPGRADE_TASKS,
  listPendingUpgradeTasks,
  estimateUpgradeCost,
  runDeterministicUpgrade,
  getUpgradeGate,
  setUpgradeGate,
} from "../src/upgrade.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `derived-upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用
  }
})

async function seedNovel(storySpine?: string) {
  const db = getDb(projectDir)
  const novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable)
    .values({
      id: novelId,
      title: "测试小说",
      genre: "玄幻",
      synopsis: "",
      master_outline: "",
      status: "draft",
      story_spine: storySpine ?? null,
      created_at: now,
      updated_at: now,
    })
    .run()
  return novelId
}

describe("升级任务注册表", () => {
  test("新书无摘要缺指纹任务，仅引用扫描任务（零行且存在章节）", async () => {
    const novelId = await seedNovel()
    await createChapter(novelId, "第一章", 1, null, projectDir)
    const db = getDb(projectDir)
    const pending = await listPendingUpgradeTasks(db, novelId)
    expect(pending.map((t) => t.id)).toEqual(["content-fingerprints", "entity-refs"])
  })

  test("缺指纹章节触发指纹基准与摘要重建任务", async () => {
    const novelId = await seedNovel()
    const ch1 = await createChapter(novelId, "第一章", 1, null, projectDir)
    const db = getDb(projectDir)
    db.insert(ChapterSummaryTable)
      .values({
        id: crypto.randomUUID(),
        chapter_id: ch1.id,
        summary: "旧摘要",
        key_events: "[]",
        char_changes: "[]",
        source_fingerprint: null,
      })
      .run()
    const pending = await listPendingUpgradeTasks(db, novelId)
    const ids = pending.map((t) => t.id)
    expect(ids).toContain("content-fingerprints")
    expect(ids).toContain("chapter-summaries")
  })

  test("legacy 主轴文本激活转换任务，结构化条目已存在则不触发", async () => {
    const novelId = await seedNovel("第一段主轴\n\n第二段主轴")
    const db = getDb(projectDir)
    const pending = await listPendingUpgradeTasks(db, novelId)
    expect(pending.map((t) => t.id)).toContain("legacy-spine-entries")

    // 已有结构化条目时不再触发
    db.insert(StorySpineEntryTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        content: "已有条目",
        status: "synced",
        source_fingerprint: "fp",
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .run()
    const pending2 = await listPendingUpgradeTasks(db, novelId)
    expect(pending2.map((t) => t.id)).not.toContain("legacy-spine-entries")
  })

  test("注册表任务都有版本标识与合法种类", () => {
    for (const task of UPGRADE_TASKS) {
      expect(task.version.length).toBeGreaterThan(0)
      expect(["deterministic", "ai"]).toContain(task.kind)
    }
  })
})

describe("升级成本预估", () => {
  test("确定性项数与 AI 章数按缺指纹数据计算", async () => {
    const novelId = await seedNovel()
    const ch1 = await createChapter(novelId, "第一章", 1, null, projectDir)
    const ch2 = await createChapter(novelId, "第二章", 2, null, projectDir)
    const db = getDb(projectDir)
    for (const ch of [ch1, ch2]) {
      db.insert(ChapterSummaryTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: ch.id,
          summary: "旧摘要",
          key_events: "[]",
          char_changes: "[]",
          source_fingerprint: null,
        })
        .run()
    }
    const cost = await estimateUpgradeCost(db, novelId)
    expect(cost.deterministicTasks).toBeGreaterThanOrEqual(2)
    expect(cost.aiChapters).toBe(2)
  })
})

describe("Phase 1 确定性回填", () => {
  test("指纹基准 / 引用扫描 / legacy 主轴转换全部落库且幂等", async () => {
    const novelId = await seedNovel("主角抵达王都\n\n与公爵密谈")
    const db = getDb(projectDir)
    db.insert(CharacterTable)
      .values({ id: crypto.randomUUID(), novel_id: novelId, name: "林玄", role: "主角" })
      .run()
    const ch = await createChapter(novelId, "第一章", 1, null, projectDir)
    db.update(ChapterTable).set({ content: "林玄走出城门，遥望王都。" }).where(eq(ChapterTable.id, ch.id)).run()

    const result = await runDeterministicUpgrade(db, novelId)
    expect(result.fingerprints).toBe(1)
    expect(result.refs).toBe(1)
    expect(result.spineEntries).toBe(2)

    const chapters = db.select().from(ChapterTable).where(eq(ChapterTable.novel_id, novelId)).all()
    expect(chapters[0].content_fingerprint).toBe(computeFingerprint("林玄走出城门，遥望王都。"))

    const refs = db.select().from(EntityRefTable).where(eq(EntityRefTable.novel_id, novelId)).all()
    expect(refs).toHaveLength(1)
    expect(refs[0].source_fingerprint).not.toBeNull()

    const spine = db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.novel_id, novelId)).all()
    expect(spine).toHaveLength(2)
    expect(spine.every((e) => e.status === "legacy")).toBe(true)

    // 第二次执行全部幂等跳过
    const again = await runDeterministicUpgrade(db, novelId)
    expect(again.fingerprints).toBe(0)
    expect(again.refs).toBe(1) // 重扫覆盖，行数稳定
    expect(again.spineEntries).toBe(0)
  })

  test("段摘要按 20 章窗口重建并写入指纹", async () => {
    const novelId = await seedNovel()
    for (let i = 1; i <= 21; i++) {
      await createChapter(novelId, `第${i}章`, i, null, projectDir)
    }
    const db = getDb(projectDir)
    const result = await runDeterministicUpgrade(db, novelId)
    expect(result.segments).toBe(1) // 第1-20章段关闭，第21章段进行中
    const segments = db
      .select()
      .from(SegmentSummaryTable)
      .where(eq(SegmentSummaryTable.novel_id, novelId))
      .all()
    expect(segments).toHaveLength(1)
    expect(segments[0].source_fingerprint).not.toBeNull()
    expect(segments[0].summary).toContain("第1-20章")
  })
})

describe("升级消费闸门", () => {
  test("默认 open，切换 paused 后读取 persisted 状态", async () => {
    const novelId = await seedNovel()
    const db = getDb(projectDir)
    expect(await getUpgradeGate(db, novelId)).toBe("open")
    await setUpgradeGate(db, novelId, "paused")
    expect(await getUpgradeGate(db, novelId)).toBe("paused")
    await setUpgradeGate(db, novelId, "open")
    expect(await getUpgradeGate(db, novelId)).toBe("open")
  })
})

describe("队列 source 列迁移", () => {
  test("旧库打开后 source 列存在且默认 manual", () => {
    // 手工模拟旧库：无 source 列的队列表
    const raw = getDb(projectDir)
    raw.run("DROP TABLE IF EXISTS manual_edit_sync_queue")
    raw.run(
      "CREATE TABLE manual_edit_sync_queue (id text PRIMARY KEY, novel_id text NOT NULL, entity text NOT NULL, entity_id text, field text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'creative_fact', status text NOT NULL DEFAULT 'pending', source_fingerprint text, failure_reason text, created_at integer NOT NULL, updated_at integer NOT NULL)",
    )
    closeDb(projectDir)
    // 重新打开触发迁移
    const db = getDb(projectDir)
    const cols = db.all("PRAGMA table_info(manual_edit_sync_queue)") as Array<{ name: string; dflt_value: unknown }>
    const sourceCol = cols.find((c) => c.name === "source")
    expect(sourceCol).toBeDefined()
    expect(sourceCol!.dflt_value).toBe("'manual'")
  })
})

describe("诚实性约束", () => {
  test("确定性回填不伪造章节摘要指纹", async () => {
    const novelId = await seedNovel()
    const ch = await createChapter(novelId, "第一章", 1, null, projectDir)
    const db = getDb(projectDir)
    db.insert(ChapterSummaryTable)
      .values({
        id: crypto.randomUUID(),
        chapter_id: ch.id,
        summary: "旧摘要",
        key_events: "[]",
        char_changes: "[]",
        source_fingerprint: null,
      })
      .run()
    await runDeterministicUpgrade(db, novelId)
    // Phase 1 不得把未重建的摘要标记为已同步
    const stale = db
      .select({ id: ChapterSummaryTable.id })
      .from(ChapterSummaryTable)
      .where(isNull(ChapterSummaryTable.source_fingerprint))
      .all()
    expect(stale).toHaveLength(1)
  })
})
