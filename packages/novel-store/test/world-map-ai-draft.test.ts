import { beforeEach, describe, expect, test, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import {
  CharacterTable,
  NovelTable,
  WorldEntryTable,
  createCharacterMapPin,
  createWorldMap,
  createWorldMapFeature,
  getDb,
  getWorldMapAggregate,
  replaceWorldMapDraft,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `world-map-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 SQLite 连接释放可能略晚于测试结束。
  }
})

describe("replaceWorldMapDraft", () => {
  test("替换草稿要素并清除图钉，正式地图不受影响", async () => {
    const db = getDb(projectDir)
    const novelId = "novel-map-ai"
    const characterId = crypto.randomUUID()
    const entryId = crypto.randomUUID()
    await db.insert(NovelTable).values({
      id: novelId,
      title: "AI 地图小说",
      genre: "玄幻",
      synopsis: "",
      status: "draft",
      created_at: 1,
      updated_at: 1,
    }).run()
    await db.insert(CharacterTable).values({
      id: characterId,
      novel_id: novelId,
      name: "主角",
      role: "protagonist",
      status: "active",
      created_at: 1,
    }).run()
    await db.insert(WorldEntryTable).values({
      id: entryId,
      novel_id: novelId,
      category: "地点",
      title: "青岚城",
      content: "",
      created_at: 1,
    }).run()

    const active = await createWorldMap(novelId, { status: "active", title: "正式地图" }, projectDir)
    const activeFeature = await createWorldMapFeature(
      novelId,
      active.id,
      {
        kind: "place",
        name: "正式地点",
        description: "",
        color: "#64748b",
        worldEntryId: null,
        x: 500,
        y: 500,
      },
      projectDir,
    )
    await createCharacterMapPin(
      novelId,
      active.id,
      { characterId, featureId: activeFeature.id, x: 500, y: 500 },
      projectDir,
    )

    const draft = await createWorldMap(novelId, { status: "draft", title: "旧草稿" }, projectDir)
    const oldFeature = await createWorldMapFeature(
      novelId,
      draft.id,
      { kind: "place", name: "旧地点", x: 100, y: 100 },
      projectDir,
    )
    await createCharacterMapPin(novelId, draft.id, { characterId, featureId: oldFeature.id, x: 100, y: 100 }, projectDir)

    const replaced = await replaceWorldMapDraft(
      novelId,
      {
        title: "AI 世界地图",
        description: "东部临海，西部荒漠。",
        features: [
          {
            kind: "region",
            name: "西部荒漠",
            description: "干旱区域",
            color: "#f97316",
            worldEntryId: null,
            polygon: [
              { x: 100, y: 200 },
              { x: 3200, y: 300 },
              { x: 1600, y: 2800 },
            ],
          },
          {
            kind: "place",
            name: "青岚城",
            description: "商业重镇",
            color: "#4f46e5",
            worldEntryId: entryId,
            x: 7200,
            y: 6400,
          },
        ],
      },
      projectDir,
    )

    expect(replaced.id).toBe(draft.id)
    const aggregate = await getWorldMapAggregate(novelId, "draft", projectDir)
    expect(aggregate?.map.title).toBe("AI 世界地图")
    expect(aggregate?.map.description).toBe("东部临海，西部荒漠。")
    expect(aggregate?.features).toHaveLength(2)
    expect(aggregate?.features.map((feature) => feature.name).sort()).toEqual(["西部荒漠", "青岚城"])
    expect(aggregate?.features.find((feature) => feature.name === "青岚城")?.world_entry_id).toBe(entryId)
    expect(aggregate?.pins).toEqual([])

    const activeAggregate = await getWorldMapAggregate(novelId, "active", projectDir)
    expect(activeAggregate?.map.id).toBe(active.id)
    expect(activeAggregate?.features.map((feature) => feature.id)).toEqual([activeFeature.id])
    expect(activeAggregate?.pins).toHaveLength(1)
    expect(activeAggregate?.pins[0]?.feature_id).toBe(activeFeature.id)
  })

  test("非法输入整体拒绝，不残留半成品", async () => {
    const novelId = "novel-map-ai-invalid"
    const db = getDb(projectDir)
    await db.insert(NovelTable).values({
      id: novelId,
      title: "非法草稿",
      genre: "玄幻",
      synopsis: "",
      status: "draft",
      created_at: 1,
      updated_at: 1,
    }).run()
    await expect(
      replaceWorldMapDraft(
        novelId,
        {
          title: "失败地图",
          features: [{ kind: "region", name: "退化区域", polygon: [{ x: 1, y: 1 }] }],
        },
        projectDir,
      ),
    ).rejects.toThrow("至少需要三个顶点")
    expect(await getWorldMapAggregate(novelId, "draft", projectDir)).toBeUndefined()
  })
})
