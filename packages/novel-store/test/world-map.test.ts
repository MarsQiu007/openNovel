import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { eq } from "drizzle-orm"
import {
  CharacterTable,
  CharacterMapPinTable,
  NovelTable,
  WorldEntryTable,
  WorldMapFeatureTable,
  WorldMapTable,
  createCharacterMapPin,
  createWorldEntry,
  createWorldMap,
  createWorldMapFeature,
  deleteWorldMapFeature,
  deleteCharacter,
  deleteNovel,
  deleteWorldEntry,
  getDb,
  getDbPath,
  promoteWorldMapDraft,
  updateWorldMapFeature,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `world-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下连接释放可能稍有延迟，尽力清理
  }
})

async function seedNovel(novelId = "novel-1") {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  return novelId
}

async function seedWorld(novelId: string) {
  const db = getDb(projectDir)
  const characterId = crypto.randomUUID()
  await db
    .insert(CharacterTable)
    .values({ id: characterId, novel_id: novelId, name: "主角", role: "support", status: "active", created_at: 1 })
    .run()
  const entryId = crypto.randomUUID()
  await db
    .insert(WorldEntryTable)
    .values({ id: entryId, novel_id: novelId, category: "地点", title: "青岚城", content: "", created_at: 1 })
    .run()
  return { characterId, entryId }
}

describe("world map data", () => {
  test("每本小说最多一个 active 和一个 draft", async () => {
    const novelId = await seedNovel()
    await createWorldMap(novelId, { status: "active", title: "正式地图" }, projectDir)
    await createWorldMap(novelId, { status: "draft", title: "草稿" }, projectDir)

    expect(createWorldMap(novelId, { status: "active" }, projectDir)).rejects.toThrow("active")
    expect(createWorldMap(novelId, { status: "draft" }, projectDir)).rejects.toThrow("draft")
  })

  test("拒绝越界坐标并创建区域和地点", async () => {
    const novelId = await seedNovel()
    const map = await createWorldMap(novelId, {}, projectDir)
    const region = await createWorldMapFeature(
      novelId,
      map.id,
      { kind: "region", name: "青岚盆地", polygon: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 2500, y: 5000 }] },
      projectDir,
    )
    expect(region.kind).toBe("region")

    await expect(
      createWorldMapFeature(novelId, map.id, { kind: "place", name: "越界城", x: 10001, y: 10 }, projectDir),
    ).rejects.toThrow("0..10000")
    await expect(
      createWorldMapFeature(novelId, map.id, { kind: "region", name: "坏区域", polygon: [{ x: 0, y: 0 }] }, projectDir),
    ).rejects.toThrow("三个顶点")
  })

  test("删除世界观或要素只断开关联", async () => {
    const novelId = await seedNovel()
    const { characterId, entryId } = await seedWorld(novelId)
    const map = await createWorldMap(novelId, {}, projectDir)
    const place = await createWorldMapFeature(
      novelId,
      map.id,
      { kind: "place", name: "青岚城", worldEntryId: entryId, x: 1000, y: 2000 },
      projectDir,
    )
    const pin = await createCharacterMapPin(
      novelId,
      map.id,
      { characterId, featureId: place.id, x: 1000, y: 2000 },
      projectDir,
    )
    await deleteWorldEntry(entryId, projectDir)
    let feature = await getDb(projectDir).select().from(WorldMapFeatureTable).where(eq(WorldMapFeatureTable.id, place.id)).get()
    expect(feature?.world_entry_id).toBeNull()

    await deleteWorldMapFeature(novelId, map.id, place.id, projectDir)
    const pins = await getDb(projectDir).select().from(CharacterMapPinTable).all()
    expect(pins).toHaveLength(1)
    expect(pins[0]?.feature_id).toBeNull()
    expect(pins[0]?.id).toBe(pin.id)
  })

  test("草稿提升会事务替换旧正式地图", async () => {
    const novelId = await seedNovel()
    const active = await createWorldMap(novelId, { status: "active", title: "旧地图" }, projectDir)
    const draft = await createWorldMap(novelId, { status: "draft", title: "新地图" }, projectDir)
    const promoted = await promoteWorldMapDraft(novelId, draft.id, projectDir)

    expect(promoted.status).toBe("active")
    expect(await getDb(projectDir).select().from(WorldMapTable).all()).toHaveLength(1)
    expect(await getDb(projectDir).select().from(WorldMapTable).where(eq(WorldMapTable.id, active.id)).get()).toBeUndefined()
  })

  test("角色和小说删除级联清理", async () => {
    const novelId = await seedNovel()
    const { characterId } = await seedWorld(novelId)
    const map = await createWorldMap(novelId, {}, projectDir)
    await createCharacterMapPin(novelId, map.id, { characterId, x: 1, y: 2 }, projectDir)
    await deleteCharacter(characterId, projectDir)
    expect(await getDb(projectDir).select().from(CharacterMapPinTable).all()).toHaveLength(0)

    await seedNovel("novel-2")
    const other = await createWorldMap("novel-2", {}, projectDir)
    await deleteNovel(novelId, projectDir)
    const maps = await getDb(projectDir).select().from(WorldMapTable).all()
    expect(maps).toHaveLength(1)
    expect(maps[0]?.id).toBe(other.id)
  })

  test("旧数据库打开时增量创建地图表", async () => {
    const dbPath = getDbPath(projectDir)
    const legacy = new Database(dbPath)
    legacy.exec(
      "CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, master_outline text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL)",
    )
    legacy.run("INSERT INTO novels VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["legacy", "旧书", "玄幻", "", "", 1, 1, "draft"])
    legacy.close()

    const db = getDb(projectDir, { fresh: true })
    expect(db.select().from(WorldMapTable).all()).toHaveLength(0)
    expect(db.select().from(NovelTable).all()).toHaveLength(1)
  })
})
