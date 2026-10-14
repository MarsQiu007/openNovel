/**
 * 风格规则归一化测试 — style-rules-pipeline 变更
 *
 * 覆盖：normalizeStyleRules 全部输入形态与失败路径；
 * upsertStyleGuide / saveBookMeta 写入边界接入归一化后：
 * 嵌套输入落库为扁平映射、读取回对象形态（不再双重编码）、
 * 非空无法归一化时整体拒绝（含事务回滚）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { eq } from "drizzle-orm"
import {
  closeDb,
  getDb,
  getDbPath,
  NovelTable,
  StyleGuideTable,
  upsertStyleGuide,
} from "../src/index.js"
import { saveBookMeta } from "../src/manual-edit-sync.js"
import { normalizeStyleRules, requireNormalizedStyleRules } from "../src/style-rules.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `style-rules-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

describe("normalizeStyleRules", () => {
  test("嵌套对象按 父.子 展平，数组按索引展平", () => {
    const { rules, unnormalizable } = normalizeStyleRules({
      "异能体系": { "等级严格": "三级", "禁忌": [null, "血祭"] },
    })
    expect(unnormalizable).toBe(false)
    expect(rules).toEqual({ "异能体系.等级严格": "三级", "异能体系.禁忌.1": "血祭" })
  })

  test("字符串数组与对象数组按索引展平", () => {
    expect(normalizeStyleRules(["甲", "乙"]).rules).toEqual({ "0": "甲", "1": "乙" })
    expect(normalizeStyleRules([{ 节奏: 3 }]).rules).toEqual({ "0.节奏": "3" })
  })

  test("数字与布尔值转字符串", () => {
    expect(normalizeStyleRules({ chapter_length: 2500, limit: true }).rules).toEqual({
      chapter_length: "2500",
      limit: "true",
    })
  })

  test("JSON 字符串先解析再展平", () => {
    expect(normalizeStyleRules('{"a":{"b":1}}').rules).toEqual({ "a.b": "1" })
    expect(normalizeStyleRules('["x","y"]').rules).toEqual({ "0": "x", "1": "y" })
  })

  test("多行 键: 值 文本解析（兼容全角冒号）", () => {
    const { rules, unnormalizable } = normalizeStyleRules("叙事节奏: 紧凑推进\n语言风格：简洁克制")
    expect(unnormalizable).toBe(false)
    expect(rules).toEqual({ "叙事节奏": "紧凑推进", "语言风格": "简洁克制" })
  })

  test("行文本中任一非空行无法解析时整体判为无法归一化", () => {
    const { rules, unnormalizable } = normalizeStyleRules("叙事节奏: 紧凑\n这是一句没有冒号的话")
    expect(unnormalizable).toBe(true)
    expect(rules).toEqual({})
  })

  test("显式空对象/空数组/空串视为清空，不报错", () => {
    for (const input of [{}, [], "", "   ", "{}"]) {
      const result = normalizeStyleRules(input)
      expect(result.rules).toEqual({})
      expect(result.unnormalizable).toBe(false)
    }
  })

  test("非空但产出 0 条目（如全部为 null）判为无法归一化", () => {
    expect(normalizeStyleRules({ a: null }).unnormalizable).toBe(true)
    expect(normalizeStyleRules([null, undefined]).unnormalizable).toBe(true)
    expect(normalizeStyleRules({ "父": {} }).unnormalizable).toBe(true)
  })

  test("null / undefined 视为空，不报错", () => {
    expect(normalizeStyleRules(null)).toEqual({ rules: {}, unnormalizable: false })
    expect(normalizeStyleRules(undefined)).toEqual({ rules: {}, unnormalizable: false })
  })

  test("requireNormalizedStyleRules 失败时抛出带格式说明的错误", () => {
    expect(() => requireNormalizedStyleRules({ a: null })).toThrow("无法归一化")
    expect(() => requireNormalizedStyleRules({ a: null })).toThrow("扁平字符串映射")
    expect(requireNormalizedStyleRules({ a: "b" })).toEqual({ a: "b" })
  })
})

describe("upsertStyleGuide 写入边界", () => {
  async function seedNovelRow() {
    const db = getDb(projectDir)
    await db.insert(NovelTable).values({ id: "novel-sg", title: "风格测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  }

  test("嵌套输入落库为扁平映射，读取回对象形态（单次编码）", async () => {
    await seedNovelRow()
    await upsertStyleGuide(
      "novel-sg",
      { tone: "热血", rules: { "异能体系": { "等级严格": "三级" } } },
      projectDir,
    )
    const db = getDb(projectDir)
    const [row] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-sg")).all()
    expect(typeof row!.rules).toBe("object")
    expect(row!.rules).toMatchObject({ "异能体系.等级严格": "三级" })

    // 原始存储列应是单次编码：JSON.parse 一次即得到对象而非字符串
    const sqlite = new Database(getDbPath(projectDir))
    const raw = sqlite.query("SELECT rules FROM style_guide WHERE novel_id = ?").get("novel-sg") as { rules: string }
    sqlite.close()
    expect(typeof JSON.parse(raw.rules)).toBe("object")
  })

  test("非空无法归一化时整体拒绝，已有数据保持不变", async () => {
    await seedNovelRow()
    await upsertStyleGuide("novel-sg", { tone: "旧基调", rules: { a: "b" } }, projectDir)
    await expect(
      upsertStyleGuide("novel-sg", { tone: "新基调", rules: { x: null } }, projectDir),
    ).rejects.toThrow("无法归一化")
    const db = getDb(projectDir)
    const [row] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-sg")).all()
    expect(row!.tone).toBe("旧基调")
    expect(row!.rules).toMatchObject({ a: "b" })
  })

  test("显式空对象清空规则", async () => {
    await seedNovelRow()
    await upsertStyleGuide("novel-sg", { rules: { a: "b" } }, projectDir)
    await upsertStyleGuide("novel-sg", { rules: {} }, projectDir)
    const db = getDb(projectDir)
    const [row] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-sg")).all()
    expect(row!.rules).toEqual({})
  })
})

describe("saveBookMeta 写入边界", () => {
  async function seedNovel() {
    const db = getDb(projectDir)
    await db
      .insert(NovelTable)
      .values({ id: "novel-meta", title: "旧标题", genre: "玄幻", synopsis: "", status: "draft" })
      .run()
  }

  test("嵌套输入落库为扁平映射，且不再双重编码", async () => {
    await seedNovel()
    const result = await saveBookMeta(
      "novel-meta",
      { styleGuide: { tone: "热血", rules: { "异能体系": { "等级严格": "三级" } } } },
      projectDir,
    )
    expect(result.styleGuide).not.toBeNull()
    expect(typeof result.styleGuide!.rules).toBe("object")
    expect(result.styleGuide!.rules).toMatchObject({ "异能体系.等级严格": "三级" })

    // 原始存储列单次编码（旧实现 JSON.stringify 后再经 json 列序列化会双重编码）
    const sqlite = new Database(getDbPath(projectDir))
    const raw = sqlite.query("SELECT rules FROM style_guide WHERE novel_id = ?").get("novel-meta") as { rules: string }
    sqlite.close()
    const parsed = JSON.parse(raw.rules)
    expect(typeof parsed).toBe("object")
    expect(parsed).toMatchObject({ "异能体系.等级严格": "三级" })
  })

  test("非空无法归一化时抛错且事务整体回滚", async () => {
    await seedNovel()
    await saveBookMeta("novel-meta", { styleGuide: { tone: "旧基调", rules: { a: "b" } } }, projectDir)
    await expect(
      saveBookMeta("novel-meta", { title: "新标题", styleGuide: { rules: { x: null } } }, projectDir),
    ).rejects.toThrow("无法归一化")
    const db = getDb(projectDir)
    const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, "novel-meta")).all()
    expect(novel!.title).toBe("旧标题")
    const [row] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-meta")).all()
    expect(row!.tone).toBe("旧基调")
    expect(row!.rules).toMatchObject({ a: "b" })
  })
})
