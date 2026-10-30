/**
 * 角色档案（character-profile）解析/回写单测。
 *
 * 覆盖：维度齐全解析、字段缺失/类型不符降级、损坏 JSON 降级空档案、
 * 扩展 KV 增删改、未知维度 key 白名单、CRUD helper 回写与旧库迁移补列。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import {
  CHARACTER_PROFILE_DIMENSIONS,
  CHARACTER_PROFILE_KEYS,
  closeDb,
  createCharacter,
  getDb,
  isCharacterProfileKey,
  NovelTable,
  parseCharacterProfile,
  serializeCharacterProfile,
  updateCharacter,
} from "../src/index.js"

describe("parseCharacterProfile 容错解析", () => {
  test("维度齐全与扩展 KV 全量解析", () => {
    const profile = parseCharacterProfile(
      JSON.stringify({
        appearance: "左脸一道旧疤",
        speech: "句尾总带『哼』",
        tone: "冷、短句",
        personality: "外冷内热",
        mannerism: "思考时摩挲指环",
        extensions: { 武器风格: "双手重剑", 门派: "青云" },
      }),
    )
    expect(profile.appearance).toBe("左脸一道旧疤")
    expect(profile.speech).toBe("句尾总带『哼』")
    expect(profile.tone).toBe("冷、短句")
    expect(profile.personality).toBe("外冷内热")
    expect(profile.mannerism).toBe("思考时摩挲指环")
    expect(profile.extensions).toEqual({ 武器风格: "双手重剑", 门派: "青云" })
  })

  test("字段缺失/类型不符按空处理，未知 key 丢弃", () => {
    const profile = parseCharacterProfile(
      JSON.stringify({ appearance: 42, speech: null, tone: ["冷"], weapon: "双手重剑", extensions: "不是对象" }),
    )
    expect(profile).toEqual({})
  })

  test("损坏 JSON / 非对象 JSON / 空串 / null 降级空档案，不抛错", () => {
    expect(parseCharacterProfile("{not json")).toEqual({})
    expect(parseCharacterProfile("[1,2]")).toEqual({})
    expect(parseCharacterProfile("42")).toEqual({})
    expect(parseCharacterProfile("")).toEqual({})
    expect(parseCharacterProfile(null)).toEqual({})
    expect(parseCharacterProfile(undefined)).toEqual({})
  })

  test("extensions 标量值转字符串，空值剔除", () => {
    const profile = parseCharacterProfile(
      JSON.stringify({ extensions: { 等级: 3, 已飞升: true, 备注: "", 空数组: [] } }),
    )
    expect(profile.extensions).toEqual({ 等级: "3", 已飞升: "true" })
  })
})

describe("serializeCharacterProfile 写入边界", () => {
  test("全空档案返回空串（未建档语义）", () => {
    expect(serializeCharacterProfile({})).toBe("")
    expect(serializeCharacterProfile({ appearance: "  " })).toBe("")
    expect(serializeCharacterProfile(null)).toBe("")
    expect(serializeCharacterProfile(undefined)).toBe("")
  })

  test("空维度剔除，非空维度保留", () => {
    const json = serializeCharacterProfile({ appearance: "疤", speech: "", tone: undefined, personality: "外冷内热" })
    expect(JSON.parse(json)).toEqual({ appearance: "疤", personality: "外冷内热" })
  })

  test("serialize → parse 往返一致（扩展 KV 增删改走整包重写）", () => {
    const original = parseCharacterProfile(
      serializeCharacterProfile({ speech: "句尾带哼", extensions: { 武器风格: "双手重剑" } }),
    )
    // 增
    const added = serializeCharacterProfile({ ...original, extensions: { ...original.extensions, 门派: "青云" } })
    expect(parseCharacterProfile(added).extensions).toEqual({ 武器风格: "双手重剑", 门派: "青云" })
    // 改
    const changed = serializeCharacterProfile({ ...original, extensions: { 武器风格: "单手剑" } })
    expect(parseCharacterProfile(changed).extensions).toEqual({ 武器风格: "单手剑" })
    // 删（全部扩展删除后 extensions 容器消失）
    const removed = serializeCharacterProfile({ ...original, extensions: {} })
    expect(parseCharacterProfile(removed).extensions).toBeUndefined()
  })

  test("维度 key 白名单含五维与 extensions", () => {
    expect([...CHARACTER_PROFILE_DIMENSIONS]).toEqual(["appearance", "speech", "tone", "personality", "mannerism"])
    expect([...CHARACTER_PROFILE_KEYS]).toEqual([
      "appearance",
      "speech",
      "tone",
      "personality",
      "mannerism",
      "extensions",
    ])
    expect(isCharacterProfileKey("speech")).toBe(true)
    expect(isCharacterProfileKey("extensions")).toBe(true)
    expect(isCharacterProfileKey("weapon")).toBe(false)
  })
})

// ─── CRUD 回写与迁移补列 ───

const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, status text DEFAULT 'active' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
`

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `character-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

describe("角色档案 CRUD 回写", () => {
  test("createCharacter 落档案、updateCharacter 整包更新且不影响其他字段", async () => {
    const db = getDb(projectDir)
    const novelId = "novel-profile-1"
    db.insert(NovelTable)
      .values({ id: novelId, title: "档案书", genre: "玄幻", synopsis: "档案回写测试。", created_at: 1, updated_at: 1 })
      .run()
    const created = await createCharacter(
      novelId,
      "林天",
      "protagonist",
      "青云门弟子。",
      { appearance: "左脸旧疤", speech: "句尾带哼", extensions: { 武器风格: "双手重剑" } },
      projectDir,
    )
    expect(parseCharacterProfile(created.profile).appearance).toBe("左脸旧疤")
    expect(parseCharacterProfile(created.profile).extensions).toEqual({ 武器风格: "双手重剑" })

    const updated = await updateCharacter(
      created.id,
      { profile: { speech: "更简短生硬", extensions: { 武器风格: "单手剑" } } },
      projectDir,
    )
    const profile = parseCharacterProfile(updated.profile)
    // 整包语义：未携带的维度不再保留
    expect(profile.appearance).toBeUndefined()
    expect(profile.speech).toBe("更简短生硬")
    expect(profile.extensions).toEqual({ 武器风格: "单手剑" })
    // 非档案字段不受影响
    expect(updated.name).toBe("林天")
    expect(updated.description).toBe("青云门弟子。")
  })

  test("不带 profile 的既有调用行为不变（空档案）", async () => {
    const db = getDb(projectDir)
    const novelId = "novel-profile-2"
    db.insert(NovelTable)
      .values({ id: novelId, title: "兼容书", genre: "都市", synopsis: "空档案回退测试。", created_at: 1, updated_at: 1 })
      .run()
    const created = await createCharacter(novelId, "苏瑶", undefined, undefined, undefined, projectDir)
    expect(created.profile).toBe("")
    const updated = await updateCharacter(created.id, { role: "女主" }, projectDir)
    expect(updated.profile).toBe("")
    expect(updated.role).toBe("女主")
  })
})

describe("旧库迁移补列", () => {
  test("无 profile 列的存量库经 getDb 幂等补列且默认空串", () => {
    const dbPath = join(projectDir, ".novel", "novel.db")
    const seed = new Database(dbPath)
    seed.exec(LEGACY_SCHEMA)
    seed
      .query("INSERT INTO novels (id, title, genre, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("novel-1", "旧库", "玄幻", 1, 1)
    seed
      .query("INSERT INTO characters (id, novel_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run("character-1", "novel-1", "林天", 1)
    seed.close()

    getDb(projectDir)

    const check = new Database(dbPath, { readonly: true })
    try {
      const column = check.query("PRAGMA table_info(characters)").all().find((row) => row.name === "profile")
      expect(column).toBeDefined()
      const row = check.query("SELECT profile FROM characters WHERE id = 'character-1'").get() as {
        profile: string
      }
      expect(row.profile).toBe("")
    } finally {
      check.close()
    }
  })
})
