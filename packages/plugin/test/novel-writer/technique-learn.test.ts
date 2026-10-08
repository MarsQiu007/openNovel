import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()
import { describe, test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { TechniqueEntry, TechniqueLevel, TechniqueStatus } from "../../src/novel-writer/technique.js"
import { saveTechnique, searchTechniques, confirmTechniques } from "../../src/novel-writer/technique-learn.js"
import { upsertTechnique, listTechniques } from "../../src/novel-writer/technique-store.js"
import { getGlobalDb, TechniqueTable } from "../../src/novel-writer/session-store.js"
import { eq } from "drizzle-orm"

const testDir = mkdtempSync(join(tmpdir(), "technique-learn-test-"))

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
  }
})

/** 重置全局库为全新空库（每个用例独立的跨书环境） */
function resetGlobalLibrary() {
  installFreshGlobalDb()
  return process.env.OPENNOVEL_TECHNIQUE_DB
}

async function globalNames(): Promise<string[]> {
  const db = getGlobalDb()
  const rows = await db.select({ name: TechniqueTable.name }).from(TechniqueTable).all()
  return rows.map((r) => r.name)
}

function makeInput(overrides?: Partial<Parameters<typeof saveTechnique>[0]>) {
  return {
    name: "对话停顿制造张力",
    principle: "停顿比直接回应更有张力",
    instruction: "写紧张对话时每3句插入一个角色的微小动作",
    sceneTypes: ["dialogue"],
    level: "paragraph" as TechniqueLevel,
    evidence: [{ sourceTitle: "书A", sourceLocation: "第1章", excerpt: "他停下筷子", annotation: "停顿暗示拒绝" }],
    commonMisuse: "停顿过多导致拖沓",
    scope: "adult" as const,
    ...overrides,
  }
}

function makeTechnique(overrides?: Partial<TechniqueEntry>): TechniqueEntry {
  const now = Date.now()
  return {
    id: `tech_${now}_${Math.random().toString(36).slice(2, 6)}`,
    name: "环境外化情绪",
    principle: "用环境折射内心",
    instruction: "写情绪转折时用光线温度变化暗示角色内心",
    sceneTypes: ["emotion_shift"],
    level: "paragraph",
    evidence: [{ sourceTitle: "书B", sourceLocation: "第2章", excerpt: "光变窄了", annotation: "压迫感" }],
    commonMisuse: "描写与情绪脱节",
    confidence: 0.5,
    status: "unverified" as TechniqueStatus,
    scope: "general" as const,
    embedding: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("saveTechnique 性质路由", () => {
  test("scope=adult 落本书库（unverified/0.5）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-adult-"))
    const result = await saveTechnique(makeInput({ name: "成人技法甲" }), undefined, dir)
    expect(result.action).toBe("created")
    const [entry] = await listTechniques(dir)
    expect(entry.name).toBe("成人技法甲")
    expect(entry.scope).toBe("adult")
    expect(entry.status).toBe("unverified")
    expect(entry.confidence).toBe(0.5)
    expect(await globalNames()).not.toContain("成人技法甲")
  })

  test("scope=general 落全局通用库，本书库不出现", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-general-"))
    const result = await saveTechnique(
      makeInput({ name: "通用写法技法", sceneTypes: ["dialogue"], scope: "general" }),
      undefined,
      dir,
    )
    expect(result.action).toBe("created")
    expect(await globalNames()).toContain("通用写法技法")
    expect((await listTechniques(dir)).length).toBe(0)
  })

  test("缺少必填 scope 被拒绝", async () => {
    const broken = { ...makeInput({ name: "无性质技法" }) } as Record<string, unknown>
    delete broken.scope
    const result = await saveTechnique(broken as Parameters<typeof saveTechnique>[0], undefined, testDir)
    expect(result.action).toBe("rejected")
    expect(result.reason).toContain("scope")
  })

  test("同名候选只在本库内合并：本书同名不吞并全局条目", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-cross-merge-"))
    const globalOne = await saveTechnique(
      makeInput({ name: "跨库同名技法", scope: "general", evidence: [{ sourceTitle: "书G", sourceLocation: "第1章", excerpt: "g1", annotation: "全局证据" }] }),
      undefined,
      dir,
    )
    expect(globalOne.action).toBe("created")
    const bookOne = await saveTechnique(
      makeInput({
        name: "跨库同名技法",
        scope: "adult",
        evidence: [{ sourceTitle: "书B", sourceLocation: "第2章", excerpt: "b1", annotation: "本书证据" }],
      }),
      undefined,
      dir,
    )
    // 同名但跨库：不合并，各自独立建条目
    expect(bookOne.action).toBe("created")
    expect(await globalNames()).toContain("跨库同名技法")
    expect((await listTechniques(dir)).some((e) => e.name === "跨库同名技法")).toBe(true)
  })
})

describe("saveTechnique 合并与过滤", () => {
  test("同名候选自动合并证据（同库内）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-merge-"))
    const first = await saveTechnique(makeInput({ name: "同名合并技法" }), undefined, dir)
    expect(first.action).toBe("created")
    const second = await saveTechnique(
      makeInput({
        name: "同名合并技法",
        evidence: [{ sourceTitle: "书C", sourceLocation: "第3章", excerpt: "她别过脸", annotation: "回避" }],
      }),
      undefined,
      dir,
    )
    expect(second.action).toBe("merged")
    const all = await listTechniques(dir)
    const merged = all.filter((e) => e.name === "同名合并技法")
    expect(merged.length).toBe(1)
    expect(merged[0].evidence.length).toBe(2)
  })

  test("显式 merge_target_id 合并到近似技法", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-explicit-"))
    const target = makeTechnique({ name: "近似技法目标", scope: "adult" })
    await upsertTechnique(target, dir)
    const result = await saveTechnique(makeInput({ name: "换个名字的近似技法" }), target.id, dir)
    expect(result.action).toBe("merged")
    expect(result.technique_id).toBe(target.id)
    const [after] = (await listTechniques(dir)).filter((e) => e.id === target.id)
    expect(after.evidence.length).toBe(2)
  })

  test("模糊指令被黑名单拒绝", async () => {
    const result = await saveTechnique(makeInput({ instruction: "要注意对话节奏" }), undefined, testDir)
    expect(result.action).toBe("rejected")
    expect(result.reason).toBe("模糊指令或无证据")
  })

  test("无证据候选被拒绝", async () => {
    const result = await saveTechnique(makeInput({ name: "无证据技法", evidence: [] }), undefined, testDir)
    expect(result.action).toBe("rejected")
  })
})

describe("searchTechniques 双源检索", () => {
  test("空库返回空（双库皆空）", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-search-empty-"))
    const { count } = await searchTechniques({}, dir)
    expect(count).toBe(0)
  })

  test("关键词命中并标注来源库", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-search-kw-"))
    await saveTechnique(makeInput({ name: "本书停顿技法" }), undefined, dir)
    await saveTechnique(makeInput({ name: "全局停顿技法", scope: "general" }), undefined, dir)
    const { lines, count } = await searchTechniques({ keyword: "停顿" }, dir)
    expect(count).toBe(2)
    expect(lines.some((l) => l.includes("[本书]") && l.includes("本书停顿技法"))).toBe(true)
    expect(lines.some((l) => l.includes("[通用库]") && l.includes("全局停顿技法"))).toBe(true)
  })

  test("场景过滤跨双库计数", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-search-scene-"))
    await saveTechnique(makeInput({ name: "本书对话技法" }), undefined, dir)
    await saveTechnique(makeInput({ name: "全局对话技法", scope: "general" }), undefined, dir)
    await upsertTechnique(makeTechnique({ name: "本书情绪技法", sceneTypes: ["emotion_shift"], scope: "adult" }), dir)
    const { count } = await searchTechniques({ sceneType: "dialogue" }, dir)
    expect(count).toBe(2)
  })

  test("状态过滤跨双库生效", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-search-status-"))
    await upsertTechnique(makeTechnique({ name: "本书已验证", status: "verified", scope: "adult" }), dir)
    await upsertTechnique(
      makeTechnique({ name: "全局已验证", status: "verified", sceneTypes: ["dialogue"] }),
      dir,
      "global",
    )
    const { count } = await searchTechniques({ status: "verified" }, dir)
    expect(count).toBe(2)
  })
})

describe("confirmTechniques 双源确认", () => {
  test("空 ids 返回空段落", async () => {
    const result = await confirmTechniques([], testDir)
    expect(result.section).toBe("")
    expect(result.injected).toBe(0)
  })

  test("确认后按来源库分别递增使用计数", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-confirm-"))
    const bookEntry = makeTechnique({ name: "本书确认技法", scope: "adult" })
    await upsertTechnique(bookEntry, dir)
    const globalEntry = makeTechnique({ name: "全局确认技法", sceneTypes: ["dialogue"] })
    await upsertTechnique(globalEntry, dir, "global")

    const result = await confirmTechniques([bookEntry.id, globalEntry.id], dir)
    expect(result.injected).toBe(2)
    expect(result.section).toContain("写作技法指导")
    expect(result.section).toContain("（通用库）")

    const [bookAfter] = (await listTechniques(dir)).filter((e) => e.id === bookEntry.id)
    expect(bookAfter.usageCount).toBe(1)
    const globalDb = getGlobalDb()
    const [globalAfter] = await globalDb
      .select()
      .from(TechniqueTable)
      .where(eq(TechniqueTable.id, globalEntry.id))
      .all()
    expect(globalAfter.usage_count).toBe(1)
  })

  test("超预算时按匹配分裁剪", async () => {
    resetGlobalLibrary()
    const dir = mkdtempSync(join(tmpdir(), "learn-confirm-budget-"))
    try {
      const longInstruction = "写对话时每3句插入一个角色的微小动作来暗示态度变化，".repeat(20)
      for (let i = 0; i < 5; i++) {
        await upsertTechnique(
          makeTechnique({
            name: `预算技法${i}`,
            sceneTypes: ["dialogue"],
            instruction: `${longInstruction}第${i}条变体`,
            confidence: 0.9 - i * 0.1,
            status: "verified",
            scope: "adult",
          }),
          dir,
        )
      }
      const all = await listTechniques(dir)
      const ids = all.map((e) => e.id)
      const result = await confirmTechniques(ids, dir)
      expect(result.injected).toBeLessThan(5)
      expect(result.injected_ids[0]).toBe(all[0].id)
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
      }
    }
  })
})

/** 构造运行时脏输入：等效 LLM 传入的 JSON 负载，绕开编译期形状校验 */
function runtimeInput(patch: Record<string, unknown>): Parameters<typeof saveTechnique>[0] {
  return JSON.parse(JSON.stringify({ ...makeInput(), ...patch }))
}

describe("saveTechnique 证据规范化", () => {
  test("缺 sourceTitle（有 sourceLocation）的证据补全后入库", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-evidence-fill-"))
    const result = await saveTechnique(
      runtimeInput({
        name: "证据补全技法",
        evidence: [{ sourceLocation: "第3章", excerpt: "他停下筷子", annotation: "停顿暗示拒绝" }],
      }),
      undefined,
      dir,
    )
    expect(result.action).toBe("created")
    const [entry] = await listTechniques(dir)
    expect(entry.evidence).toEqual([
      { sourceTitle: "第3章", sourceLocation: "第3章", excerpt: "他停下筷子", annotation: "停顿暗示拒绝" },
    ])
  })

  test("非对象证据元素被拒绝且技法库无变更", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-evidence-reject-"))
    const result = await saveTechnique(
      runtimeInput({ name: "坏证据技法", evidence: ["坏元素"] }),
      undefined,
      dir,
    )
    expect(result.action).toBe("rejected")
    expect(result.reason).toContain("证据")
    expect(await listTechniques(dir)).toHaveLength(0)
  })
})
