/**
 * save_novel_settings / check_novel_settings 角色档案测试（character-profile task 2.3）。
 *
 * 覆盖：批量建档落档案（插入与更新两分支）、description 缺省不抹空、
 * 非法档案 key 报错不落档案、check_novel_settings 档案维度行渲染。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { CharacterTable, getDb, NovelTable, parseCharacterProfile } from "../../src/novel-writer/session-store.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `char-profile-settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
  return createToolContext(projectDir, { sessionID: "ses-profile-settings", agent: "architect" })
}

async function seedNovel() {
  const db = getDb(projectDir)
  db.insert(NovelTable)
    .values({ id: "novel-profile", title: "档案设定书", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  return db
}

function save(settings: Array<{ type: string; data: Record<string, unknown> }>) {
  return createWritingTools().save_novel_settings.execute(
    { novel_id: "novel-profile", settings_json: JSON.stringify(settings) },
    toolCtx(),
  )
}

async function rowOf(db: ReturnType<typeof getDb>, name: string) {
  const [row] = await db.select().from(CharacterTable).where(eq(CharacterTable.name, name)).all()
  return row
}

describe("save_novel_settings 角色档案", () => {
  test("新增角色带 profile 落档案", async () => {
    const db = await seedNovel()
    await save([
      {
        type: "character",
        data: {
          ref: "protagonist",
          name: "林天",
          role: "protagonist",
          description: "青云门弟子。",
          profile: {
            appearance: "左脸旧疤",
            speech: "句尾带哼",
            tone: "冷、短句",
            personality: "外冷内热",
            mannerism: "思考时摩挲指环",
            extensions: { 武器风格: "双手重剑" },
          },
        },
      },
    ])
    const row = await rowOf(db, "林天")
    const profile = parseCharacterProfile(row.profile)
    expect(profile.appearance).toBe("左脸旧疤")
    expect(profile.mannerism).toBe("思考时摩挲指环")
    expect(profile.extensions).toEqual({ 武器风格: "双手重剑" })
  })

  test("更新分支落档案为整包替换；description 缺省时保留原描述", async () => {
    const db = await seedNovel()
    await save([{ type: "character", data: { name: "苏瑶", role: "secondary", description: "药峰首席。", profile: { appearance: "银发", speech: "轻声细语" } } }])

    // 只补档案不带 description：原描述保留，档案整包替换（旧维度被清除）
    await save([{ type: "character", data: { name: "苏瑶", profile: { speech: "更轻的嗓音" } } }])
    const row = await rowOf(db, "苏瑶")
    expect(row.description).toBe("药峰首席。")
    expect(parseCharacterProfile(row.profile)).toEqual({ speech: "更轻的嗓音" })
  })

  test("非法档案 key 报错该条且不落档案，不阻断同批其余设定", async () => {
    const db = await seedNovel()
    const result = await save([
      { type: "character", data: { name: "陆沉", role: "protagonist", profile: { weapon: "双手重剑" } } },
      { type: "character", data: { name: "苏瑶", role: "secondary" } },
    ])
    expect(result.output).toContain("未知维度")
    expect(result.output).toContain("extensions")

    const lu = await rowOf(db, "陆沉")
    expect(lu).toBeDefined()
    expect(lu.profile).toBe("")
    const su = await rowOf(db, "苏瑶")
    expect(su).toBeDefined()
  })
})

describe("check_novel_settings 档案呈现", () => {
  test("有档案角色渲染档案维度行，无档案角色不渲染", async () => {
    await seedNovel()
    await save([
      {
        type: "character",
        data: {
          name: "林天",
          description: "青云门弟子。",
          profile: { appearance: "左脸旧疤", speech: "句尾带哼", extensions: { 武器风格: "双手重剑" } },
        },
      },
      { type: "character", data: { name: "苏瑶", description: "药峰首席。" } },
    ])

    const result = await createWritingTools().check_novel_settings.execute(
      { novel_id: "novel-profile", scope: "characters" },
      toolCtx(),
    )
    expect(result.output).toContain("档案：身体特征：左脸旧疤；说话习惯：句尾带哼")
    expect(result.output).toContain("档案扩展：武器风格=双手重剑")
    // 两个角色只有一个建档：档案行全输出各恰好一次
    const lines = result.output.split("\n")
    expect(lines.filter((line) => line.trimStart().startsWith("档案："))).toHaveLength(1)
    expect(lines.filter((line) => line.trimStart().startsWith("档案扩展："))).toHaveLength(1)
  })
})
