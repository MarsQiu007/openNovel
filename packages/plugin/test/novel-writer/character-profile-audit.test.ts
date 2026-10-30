/**
 * 角色档案审计测试（character-profile-audit task 1.2）。
 *
 * 覆盖确定性审计升级：「外貌描述」档案矛盾比对（方位矛盾 FAIL、台词内
 * 提及不判矛盾、无档案角色行为不变）、「性格一致」语癖子检查（丢失 WARN、
 * 体现通过、无台词/空 speech 跳过）与动态情绪误报边界（mood 既有行为回归）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { closeDb, CharacterStateTable, CharacterTable, ChapterTable, getDb, NovelTable } from "@opennovel-ai/novel-store"
import { checkContinuity, type ContinuityResult } from "../../src/novel-writer/continuity-check.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `char-profile-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function seedBook(chapterContent: string, characters: Array<{ id: string; name: string; profile?: string; description?: string }>) {
  const db = getDb(dir)
  db.insert(NovelTable).values({ id: "novel-audit", title: "审计书", genre: "玄幻", synopsis: "" }).run()
  db
    .insert(ChapterTable)
    .values({ id: "ch-1", novel_id: "novel-audit", title: "第一章", order: 1, content: chapterContent })
    .run()
  db
    .insert(CharacterTable)
    .values(
      characters.map((c) => ({
        id: c.id,
        novel_id: "novel-audit",
        name: c.name,
        role: "protagonist",
        description: c.description ?? "",
        ...(c.profile !== undefined ? { profile: c.profile } : {}),
      })),
    )
    .run()
  return db
}

function seedState(db: ReturnType<typeof getDb>, characterId: string, chapterId: string, mood: string) {
  db.insert(CharacterStateTable)
    .values({ id: `st-${characterId}-${chapterId}`, character_id: characterId, chapter_id: chapterId, active: 1, mood })
    .run()
}

function dimOf(result: NonNullable<Awaited<ReturnType<typeof checkContinuity>>>, name: string): ContinuityResult {
  return result.dimensions.find((d) => d.dimension === name)!
}

describe("外貌描述档案矛盾比对", () => {
  test("正文叙述与档案方位矛盾记 FAIL 并附角色名证据", async () => {
    seedBook("林天按剑而立。他右脸的旧疤在火光下泛白。", [
      { id: "char-a", name: "林天", profile: JSON.stringify({ appearance: "左脸旧疤" }) },
    ])
    const result = await checkContinuity("novel-audit", 1, dir)
    const dim = dimOf(result!, "外貌描述")
    expect(dim.status).toBe("FAIL")
    expect(dim.detail).toContain("林天")
    expect(dim.detail).toContain("左脸旧疤")
    expect(dim.detail).toContain("右脸的旧疤")
  })

  test("矛盾仅出现在台词内不判矛盾，回落填充率检查", async () => {
    seedBook("「你右脸上的疤挺深。」对面刀客眯起眼。林天没有答话。", [
      {
        id: "char-a",
        name: "林天",
        profile: JSON.stringify({ appearance: "左脸旧疤" }),
        description: "左脸带疤的青年剑客。",
      },
    ])
    const result = await checkContinuity("novel-audit", 1, dir)
    const dim = dimOf(result!, "外貌描述")
    expect(dim.status).toBe("PASS")
    expect(dim.detail).toContain("均有外貌描述")
  })

  test("无档案角色行为与一期一致：description 填充率判定", async () => {
    seedBook("林天行走江湖。", [
      { id: "char-a", name: "林天", description: "青云门弟子。" },
      { id: "char-b", name: "苏瑶", description: "" },
    ])
    const result = await checkContinuity("novel-audit", 1, dir)
    const dim = dimOf(result!, "外貌描述")
    expect(dim.status).toBe("WARN")
    expect(dim.detail).toContain("1/2 个角色缺少外貌描述")
  })
})

describe("性格一致语癖子检查", () => {
  test("台词完全丢失语癖线索记 WARN 并列角色名", async () => {
    seedBook("「走吧。」林天转身出门，再没多说一个字。", [
      { id: "char-a", name: "林天", profile: JSON.stringify({ speech: "句尾总带『哼』" }) },
    ])
    const result = await checkContinuity("novel-audit", 1, dir)
    const dim = dimOf(result!, "性格一致")
    expect(dim.status).toBe("WARN")
    expect(dim.detail).toContain("林天")
    expect(dim.detail).toContain("语癖")
  })

  test("台词体现语癖则不产生语癖告警", async () => {
    seedBook("「哼，就这点本事。」林天冷笑着收剑。", [
      { id: "char-a", name: "林天", profile: JSON.stringify({ speech: "句尾总带『哼』" }) },
    ])
    const db = getDb(dir)
    seedState(db, "char-a", "ch-1", "平静")
    const result = await checkContinuity("novel-audit", 1, dir)
    const dim = dimOf(result!, "性格一致")
    expect(dim.status).toBe("PASS")
    expect(dim.detail).not.toContain("语癖")
  })

  test("本章无台词或 speech 为空的角色跳过且不产生噪音", async () => {
    // 有档案但无台词：语癖子检查静默；另一角色档案只有 appearance 无 speech：不参与语癖检查
    seedBook("林天沉默地擦拭长剑。苏瑶在旁煮茶。", [
      { id: "char-a", name: "林天", profile: JSON.stringify({ speech: "句尾总带『哼』" }) },
      { id: "char-b", name: "苏瑶", profile: JSON.stringify({ appearance: "银发" }) },
    ])
    const result = await checkContinuity("novel-audit", 1, dir)
    const dim = dimOf(result!, "性格一致")
    expect(dim.detail).not.toContain("语癖")
    expect(dim.detail).not.toContain("苏瑶")
  })

  test("动态情绪变化不判档案违规，mood 突变既有行为不变", async () => {
    const db = seedBook("林天暴怒挥拳。", [
      {
        id: "char-a",
        name: "林天",
        profile: JSON.stringify({ personality: "外冷内热", speech: "句尾总带『哼』" }),
      },
    ])
    db.insert(ChapterTable).values({ id: "ch-0", novel_id: "novel-audit", title: "序章", order: 0, content: "" }).run()
    seedState(db, "char-a", "ch-0", "平静")
    seedState(db, "char-a", "ch-1", "愤怒")
    const result = await checkContinuity("novel-audit", 1, dir)
    const dim = dimOf(result!, "性格一致")
    // 档案 personality/speech 都非空，但动态情绪归 character_states：WARN 是情绪突变，不是档案矛盾
    expect(dim.status).toBe("WARN")
    expect(dim.detail).toContain("情绪突变")
    expect(dim.detail).not.toContain("档案")
  })
})
