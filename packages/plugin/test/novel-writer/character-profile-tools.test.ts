/**
 * 角色档案塑造操作测试（character-profile task 2.2）。
 *
 * 覆盖：单维度补丁不影响其余维度与 description、维度删除、扩展项按键增删改、
 * 未知维度 key 拒绝、整包替换、新增/重复合并落档案、去重档案继承、空档案回退。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  CharacterTable,
  getDb,
  NovelTable,
  parseCharacterProfile,
} from "../../src/novel-writer/session-store.js"
import { deduplicateCharacters } from "../../src/novel-writer/state-commit.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `char-profile-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function toolCtx() {
  return createToolContext(projectDir, { sessionID: "ses-profile-test", agent: "director" })
}

async function seedCharacter(input: {
  id: string
  name?: string
  role?: string
  description?: string
  profile?: Record<string, unknown>
}) {
  const db = getDb(projectDir)
  db.insert(NovelTable)
    .values({ id: "novel-profile", title: "档案工具书", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  db.insert(CharacterTable)
    .values({
      id: input.id,
      novel_id: "novel-profile",
      name: input.name ?? "林天",
      role: input.role ?? "protagonist",
      description: input.description ?? "青云门弟子。",
      status: "active",
      ...(input.profile !== undefined ? { profile: JSON.stringify(input.profile) } : {}),
    })
    .run()
  return db
}

async function manage(characterId: string, update: Record<string, unknown>) {
  const tools = createWritingTools()
  return tools.manage_characters.execute(
    { character_id: characterId, update: JSON.stringify(update) },
    toolCtx(),
  )
}

async function profileOf(characterId: string) {
  const [row] = await getDb(projectDir).select().from(CharacterTable).where(eq(CharacterTable.id, characterId)).all()
  return { row, profile: parseCharacterProfile(row.profile) }
}

describe("manage_characters 档案补丁", () => {
  test("单维度补丁只覆盖目标维度，其余维度与 description 不动", async () => {
    await seedCharacter({
      id: "char-1",
      profile: { appearance: "左脸旧疤", speech: "句尾带哼", extensions: { 武器风格: "双手重剑" } },
    })
    await manage("char-1", { profile_patch: { speech: "更简短生硬" } })
    const { row, profile } = await profileOf("char-1")
    expect(profile.speech).toBe("更简短生硬")
    expect(profile.appearance).toBe("左脸旧疤")
    expect(profile.extensions).toEqual({ 武器风格: "双手重剑" })
    expect(row.description).toBe("青云门弟子。")
    expect(row.name).toBe("林天")
  })

  test("profile_remove 删整维与单个扩展项，其余保留", async () => {
    await seedCharacter({
      id: "char-2",
      profile: {
        mannerism: "思考时摩挲指环",
        speech: "句尾带哼",
        extensions: { 武器风格: "双手重剑", 门派: "青云" },
      },
    })
    await manage("char-2", { profile_remove: ["mannerism", "extensions.武器风格"] })
    const { profile } = await profileOf("char-2")
    expect(profile.mannerism).toBeUndefined()
    expect(profile.extensions).toEqual({ 门派: "青云" })
    expect(profile.speech).toBe("句尾带哼")
  })

  test("扩展项按键增改，空字符串值删除该扩展项", async () => {
    await seedCharacter({
      id: "char-3",
      profile: { extensions: { 武器风格: "双手重剑", 旧别名: "废稿名" } },
    })
    await manage("char-3", {
      profile_patch: { extensions: { 门派: "青云", 武器风格: "单手剑", 旧别名: "" } },
    })
    const { profile } = await profileOf("char-3")
    expect(profile.extensions).toEqual({ 武器风格: "单手剑", 门派: "青云" })
  })

  test("未知维度 key 拒绝并提示走 extensions", async () => {
    await seedCharacter({ id: "char-4", profile: { speech: "句尾带哼" } })
    const rejected = await manage("char-4", { profile_patch: { weapon: "双手重剑" } })
    expect(rejected.output).toContain("未知维度")
    expect(rejected.output).toContain("extensions")

    const removeRejected = await manage("char-4", { profile_remove: ["weapon"] })
    expect(removeRejected.output).toContain("未知维度")

    // 校验失败不落库
    const { profile } = await profileOf("char-4")
    expect(profile.speech).toBe("句尾带哼")
  })

  test("profile 整包与 profile_patch 互斥", async () => {
    await seedCharacter({ id: "char-5", profile: { speech: "句尾带哼" } })
    const conflict = await manage("char-5", {
      profile: { appearance: "疤" },
      profile_patch: { tone: "冷" },
    })
    expect(conflict.output).toContain("互斥")
    const { profile } = await profileOf("char-5")
    expect(profile.speech).toBe("句尾带哼")
    expect(profile.appearance).toBeUndefined()
  })

  test("profile 整包替换：未携带的维度视为删除", async () => {
    await seedCharacter({
      id: "char-6",
      profile: { appearance: "左脸旧疤", speech: "句尾带哼", tone: "冷" },
    })
    await manage("char-6", { profile: { speech: "只保留说话习惯" } })
    const { profile } = await profileOf("char-6")
    expect(profile).toEqual({ speech: "只保留说话习惯" })
  })

  test("空档案角色不带档案参数时行为不变（profile 仍为空串）", async () => {
    await seedCharacter({ id: "char-7", description: "无档案角色。" })
    await manage("char-7", { role: "secondary" })
    const { row, profile } = await profileOf("char-7")
    expect(row.profile).toBe("")
    expect(profile).toEqual({})
    expect(row.role).toBe("secondary")
  })

  test("新增角色可携带档案；重复名合并分支按补丁落档案", async () => {
    await seedCharacter({ id: "char-seed", description: "" })
    const tools = createWritingTools()

    await tools.manage_characters.execute(
      {
        character_id: "",
        update: JSON.stringify({
          novel_id: "novel-profile",
          name: "苏瑶",
          role: "secondary",
          profile: { appearance: "银发", extensions: { 门派: "青云" } },
        }),
      },
      toolCtx(),
    )
    const [created] = await getDb(projectDir)
      .select()
      .from(CharacterTable)
      .where(eq(CharacterTable.name, "苏瑶"))
      .all()
    expect(parseCharacterProfile(created.profile).appearance).toBe("银发")

    // 同名重复触发合并分支：补丁在既有档案上叠加
    await tools.manage_characters.execute(
      {
        character_id: "",
        update: JSON.stringify({
          novel_id: "novel-profile",
          name: "苏瑶",
          profile_patch: { speech: "轻声细语" },
        }),
      },
      toolCtx(),
    )
    const rows = await getDb(projectDir).select().from(CharacterTable).where(eq(CharacterTable.name, "苏瑶")).all()
    expect(rows).toHaveLength(1)
    const profile = parseCharacterProfile(rows[0].profile)
    expect(profile.appearance).toBe("银发")
    expect(profile.speech).toBe("轻声细语")
  })
})

describe("去重档案继承", () => {
  test("保留行档案优先，被删行填补缺失维度", async () => {
    const db = await seedCharacter({
      id: "dup-kept",
      name: "陆沉",
      description: "保留行描述更长，去重时被保留。",
      profile: { speech: "保留行口癖" },
    })
    db.insert(CharacterTable)
      .values({
        id: "dup-removed",
        novel_id: "novel-profile",
        name: "陆沉",
        role: "secondary",
        description: "短",
        status: "active",
        profile: JSON.stringify({ speech: "被删行口癖", appearance: "左脸旧疤" }),
      })
      .run()

    const result = await deduplicateCharacters(projectDir, "novel-profile", false, false)
    expect(result.total_removed).toBe(1)

    const [kept] = await db.select().from(CharacterTable).where(eq(CharacterTable.id, "dup-kept")).all()
    const profile = parseCharacterProfile(kept.profile)
    // 保留行优先，被删行只填补缺失维度
    expect(profile.speech).toBe("保留行口癖")
    expect(profile.appearance).toBe("左脸旧疤")
    const remaining = await db.select().from(CharacterTable).where(eq(CharacterTable.name, "陆沉")).all()
    expect(remaining).toHaveLength(1)
  })

  test("保留行与被删行都无档案时不写库，行为不变", async () => {
    const db = await seedCharacter({ id: "plain-kept", name: "苏瑶", description: "保留行描述。" })
    db.insert(CharacterTable)
      .values({ id: "plain-removed", novel_id: "novel-profile", name: "苏瑶", description: "短", status: "active" })
      .run()

    await deduplicateCharacters(projectDir, "novel-profile", false, false)
    const [kept] = await db.select().from(CharacterTable).where(eq(CharacterTable.id, "plain-kept")).all()
    expect(kept.profile).toBe("")
  })
})
