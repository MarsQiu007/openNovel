
import { describe, test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { TechniqueEntry, TechniqueLevel, TechniqueStatus } from "../../src/novel-writer/technique.js"
import { saveTechnique, searchTechniques, confirmTechniques } from "../../src/novel-writer/technique-learn.js"
import { upsertTechnique, listTechniques } from "../../src/novel-writer/technique-store.js"
import { getDb, TechniqueTable } from "../../src/novel-writer/session-store.js"
import { eq } from "drizzle-orm"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

const testDir = mkdtempSync(join(tmpdir(), "technique-learn-test-"))

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
  }
})

function toolCtx(directory: string) {
  return createToolContext(directory, { sessionID: "ses-search-tool-test" })
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

function runtimeInput(patch: Record<string, unknown>): Parameters<typeof saveTechnique>[0] {
  return JSON.parse(JSON.stringify({ ...makeInput(), ...patch }))
}

describe("saveTechnique 本书单源", () => {
  test("scope=adult 落本书库（unverified/0.5）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-adult-"))
    const result = await saveTechnique(makeInput({ name: "成人技法甲" }), undefined, dir)
    expect(result.action).toBe("created")
    const [entry] = await listTechniques(dir)
    expect(entry.name).toBe("成人技法甲")
    expect(entry.scope).toBe("adult")
    expect(entry.status).toBe("unverified")
    expect(entry.confidence).toBe(0.5)
  })

  test("scope=general 仍落本书库", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-general-"))
    const result = await saveTechnique(
      makeInput({ name: "通用写法技法", sceneTypes: ["dialogue"], scope: "general" }),
      undefined,
      dir,
    )
    expect(result.action).toBe("created")
    expect((await listTechniques(dir)).some((entry) => entry.name === "通用写法技法")).toBe(true)
  })

  test("缺少必填 scope 被拒绝", async () => {
    const broken = { ...makeInput({ name: "无性质技法" }) } as Record<string, unknown>
    delete broken.scope
    const result = await saveTechnique(broken as Parameters<typeof saveTechnique>[0], undefined, testDir)
    expect(result.action).toBe("rejected")
    expect(result.reason).toContain("scope")
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

describe("searchTechniques 本书检索", () => {
  test("空库返回空", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-search-empty-"))
    const { count } = await searchTechniques({}, dir)
    expect(count).toBe(0)
  })

  test("关键词命中且不标注来源库", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-search-keyword-"))
    try {
      await saveTechnique(makeInput({ name: "本书停顿技法" }), undefined, dir)
      const result = await searchTechniques({ keyword: "停顿" }, dir)
      expect(result.count).toBe(1)
      expect(result.lines[0]).toContain("本书停顿技法")
      expect(result.lines[0]).not.toContain("[通用库]")
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
      }
    }
  })

  test("返回过滤前计数 total/unverified", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-search-counts-"))
    await upsertTechnique(makeTechnique({ name: "本书已验证", status: "verified", scope: "adult" }), dir)
    await upsertTechnique(makeTechnique({ name: "本书未验证", sceneTypes: ["dialogue"] }), dir)
    const filtered = await searchTechniques({ status: "verified" }, dir)
    expect(filtered.count).toBe(1)
    expect(filtered.total).toBe(2)
    expect(filtered.unverified).toBe(1)
  })
})

describe("search_techniques 空结果反馈（工具层）", () => {
  test("本书库为空时明确反馈技法库为空", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-tool-empty-"))
    const result = await createWritingTools().search_techniques.execute({}, toolCtx(dir))
    expect(result.output).toContain("技法库为空")
  })

  test("库非空但过滤后无匹配时包含总数与未验证数，不表述为库为空", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-tool-nomatch-"))
    await upsertTechnique(makeTechnique({ name: "未验证技法A", sceneTypes: ["dialogue"] }), dir)
    await upsertTechnique(makeTechnique({ name: "未验证技法B", sceneTypes: ["dialogue"] }), dir)
    const result = await createWritingTools().search_techniques.execute({ status: "verified" }, toolCtx(dir))
    expect(result.output).toContain("库内共 2 条")
    expect(result.output).toContain("未验证 2 条")
    expect(result.output).not.toContain("技法库为空")
  })
})

describe("confirmTechniques 本书确认", () => {
  test("空 ids 返回空段落", async () => {
    const result = await confirmTechniques([], testDir)
    expect(result.section).toBe("")
    expect(result.injected).toBe(0)
  })

  test("确认后递增本书使用计数", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-confirm-"))
    const entry = makeTechnique({ name: "本书确认技法", scope: "adult" })
    await upsertTechnique(entry, dir)

    const result = await confirmTechniques([entry.id], dir)
    expect(result.injected).toBe(1)
    expect(result.section).toContain("写作技法指导")
    expect(result.section).not.toContain("通用库")
    const [after] = (await listTechniques(dir)).filter((item) => item.id === entry.id)
    expect(after.usageCount).toBe(1)
  })

  test("超预算时按匹配分裁剪", async () => {
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
      const ids = all.map((entry) => entry.id)
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

// agent-memory-system Wave 8：晋升/固化通道（技巧经验 → 分层规范文件后 retired + promoted_from 留痕）
describe("promoteTechniqueToSpec 固化通道", () => {
  test("verified 技法固化进 book.md：追加规范段落、retired + promoted_from 留痕、重复固化幂等", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-promote-"))
    const entry = makeTechnique({ name: "固化技法甲", status: "verified", confidence: 0.9 })
    await upsertTechnique(entry, dir)

    const { promoteTechniqueToSpec } = await import("../../src/novel-writer/technique-learn.js")
    const first = await promoteTechniqueToSpec(entry.id, dir)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.spec_path).toBe(".novel/instructions/book.md")

    const spec = await Bun.file(join(dir, ".novel", "instructions", "book.md")).text()
    expect(spec).toContain("## 技法：固化技法甲")
    expect(spec).toContain(`- 指令：${entry.instruction}`)
    expect(spec).toContain(`源技法 id=${entry.id}`)

    const db = (await import("../../src/novel-writer/session-store.js")).getDb(dir)
    const [row] = await db.select().from(TechniqueTable).where(eq(TechniqueTable.id, entry.id)).all()
    expect(row.status).toBe("retired")
    expect(row.promoted_from).toBe(".novel/instructions/book.md")

    // 重复固化：规范段落不重复追加，但 retired 行不可再次流转（状态门槛拒绝）
    const second = await promoteTechniqueToSpec(entry.id, dir)
    expect(second.ok).toBe(false)
    const specAgain = await Bun.file(join(dir, ".novel", "instructions", "book.md")).text()
    expect(specAgain.split("## 技法：固化技法甲").length).toBe(2)
  })

  test("unverified 技法不可固化（先过作者确认门槛），卷层落 volume-<n>.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-promote-gate-"))
    const pending = makeTechnique({ name: "未转正技法" })
    await upsertTechnique(pending, dir)
    const { promoteTechniqueToSpec } = await import("../../src/novel-writer/technique-learn.js")
    const blocked = await promoteTechniqueToSpec(pending.id, dir)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain("verified")

    const verifiedEntry = makeTechnique({ name: "卷二固化技法", status: "verified", confidence: 0.8 })
    await upsertTechnique(verifiedEntry, dir)
    const promoted = await promoteTechniqueToSpec(verifiedEntry.id, dir, "volume-2")
    expect(promoted.ok).toBe(true)
    const spec = await Bun.file(join(dir, ".novel", "instructions", "volume-2.md")).text()
    expect(spec).toContain("## 技法：卷二固化技法")
  })
})
