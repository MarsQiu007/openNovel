/**
 * 自评价埋点 — 检查类判定点（1.3）
 *
 * 只断埋点键与计数，不断检查结论本身（结论回归由既有检查测试负责）：
 * - checkContinuity：continuity.checked + 37 维逐维结果键
 * - hook-rotation：hook.checked + 同型连打警告 hook.warning.<type>
 * - syncArcProgress：arc.beats_drafted / arc.started / arc.completed
 * - confirmTechniques：technique.confirmed / injected / p7.trimmed
 * - save_technique 工具：technique.learn.created / merged / rejected 回流漏斗
 */
import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  closeDb,
  getDb,
  NovelTable,
  ChapterTable,
  StoryArcTable,
  ArcBeatTable,
} from "../../src/novel-writer/session-store.js"
import { checkContinuity } from "../../src/novel-writer/continuity-check.js"
import { trackHook, getHookStats } from "../../src/novel-writer/hook-rotation.js"
import { syncArcProgress } from "../../src/novel-writer/arc-progress.js"
import { confirmTechniques } from "../../src/novel-writer/technique-learn.js"
import { upsertTechnique } from "../../src/novel-writer/technique-store.js"
import type { TechniqueEntry } from "../../src/novel-writer/technique.js"
import { readMetrics } from "../../src/novel-writer/evaluate/metrics.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `eval-checks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(projectDir, { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function seedNovelChapter(chapterId = "ch-1", order = 1) {
  const db = getDb(projectDir)
  const now = Date.now()
  db.insert(NovelTable)
    .values({ id: "novel-1", title: "埋点书", genre: "玄幻", synopsis: "", status: "draft", created_at: now, updated_at: now })
    .run()
  db.insert(ChapterTable)
    .values({ id: chapterId, novel_id: "novel-1", title: `第${order}章`, content: "", word_count: 0, status: "draft", order, created_at: now, updated_at: now })
    .run()
  return db
}

function domainEntries(domain: string) {
  return readMetrics(projectDir).entries.filter((e) => e.domain === domain)
}

function sumByKey(entries: Array<{ key: string; delta: number }>, prefix: string) {
  return entries.filter((e) => e.key.startsWith(prefix)).reduce((sum, e) => sum + e.delta, 0)
}

describe("checkContinuity 埋点", () => {
  test("checked 计 1，逐维结果键与评估维度一一对应", async () => {
    seedNovelChapter()
    const result = await checkContinuity("novel-1", 1, projectDir)
    expect(result).not.toBeNull()

    const c7 = domainEntries("c7-narrative")
    expect(sumByKey(c7, "continuity.checked")).toBe(1)
    const dimEntries = c7.filter((e) => e.key.startsWith("continuity.dim."))
    // 每个评估维度恰好一条 pass/warn/fail 结果
    expect(dimEntries.reduce((sum, e) => sum + e.delta, 0)).toBe(result!.dimensions.length)
    expect(dimEntries.every((e) => /\.(pass|warn|fail)$/.test(e.key))).toBe(true)
  })
})

describe("hook-rotation 埋点", () => {
  function seedHookNovel(novelId: string) {
    const db = getDb(projectDir)
    const now = Date.now()
    db.insert(NovelTable)
      .values({ id: novelId, title: "钩子书", genre: "玄幻", synopsis: "", status: "draft", created_at: now, updated_at: now })
      .run()
  }

  test("连续同型 4 次：checked + hook.warning.<type>", async () => {
    seedHookNovel("novel-1")
    for (let i = 0; i < 4; i++) {
      await trackHook("novel-1", "face_slap", undefined, projectDir)
    }
    const stats = await getHookStats("novel-1", 10, projectDir)
    expect(stats.warning).not.toBeNull()

    const c7 = domainEntries("c7-narrative")
    expect(sumByKey(c7, "hook.checked")).toBe(1)
    expect(sumByKey(c7, "hook.warning.face_slap")).toBe(1)
  })

  test("无警告时只计 checked", async () => {
    seedHookNovel("novel-2")
    await trackHook("novel-2", "power_up", undefined, projectDir)
    const stats = await getHookStats("novel-2", 10, projectDir)
    expect(stats.warning).toBeNull()

    const c7 = domainEntries("c7-narrative")
    expect(sumByKey(c7, "hook.checked")).toBe(1)
    expect(sumByKey(c7, "hook.warning.")).toBe(0)
  })
})

describe("syncArcProgress 埋点", () => {
  test("节点落地 + 弧启动 + 弧完结：三个键各计一次", async () => {
    const db = seedNovelChapter()
    const now = Date.now()
    db.insert(StoryArcTable)
      .values({ id: "arc-1", novel_id: "novel-1", arc_type: "rising", title: "成长弧", status: "planned", created_at: now, updated_at: now })
      .run()
    db.insert(ArcBeatTable)
      .values({ id: "beat-1", novel_id: "novel-1", arc_id: "arc-1", chapter_order: 1, label: "觉醒", kind: "rising", status: "planned", created_at: now, updated_at: now })
      .run()
    db.insert(ArcBeatTable)
      .values({ id: "beat-2", novel_id: "novel-1", arc_id: "arc-1", chapter_order: 1, label: "决战", kind: "resolution", status: "planned", created_at: now, updated_at: now })
      .run()

    const report = await syncArcProgress(projectDir, "novel-1", "ch-1")
    expect(report.beatsDrafted).toBe(2)
    expect(report.arcsStarted).toHaveLength(1)
    expect(report.arcsCompleted).toHaveLength(1)

    const c7 = domainEntries("c7-narrative")
    expect(sumByKey(c7, "arc.beats_drafted")).toBe(2)
    expect(sumByKey(c7, "arc.started")).toBe(1)
    expect(sumByKey(c7, "arc.completed")).toBe(1)
  })
})

function makeTechnique(overrides: Partial<TechniqueEntry>): TechniqueEntry {
  const now = Date.now()
  return {
    id: `tech_${now}_${Math.random().toString(36).slice(2, 6)}`,
    name: "环境外化情绪",
    principle: "用环境折射内心",
    instruction: "写情绪转折时用光线温度变化暗示角色内心",
    sceneTypes: ["dialogue"],
    level: "paragraph",
    evidence: [{ sourceTitle: "书B", sourceLocation: "第2章", excerpt: "光变窄了", annotation: "压迫感" }],
    commonMisuse: "描写与情绪脱节",
    confidence: 0.9,
    status: "verified",
    scope: "adult",
    embedding: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("confirmTechniques 埋点", () => {
  test("P7 超预算裁剪：confirmed=1、injected<候选数、p7.trimmed 记差额", async () => {
    const longInstruction = "写对话时每3句插入一个角色的微小动作来暗示态度变化，".repeat(20)
    for (let i = 0; i < 5; i++) {
      await upsertTechnique(
        makeTechnique({ name: `埋点技法${i}`, instruction: `${longInstruction}第${i}条变体` }),
        projectDir,
      )
    }
    const { listTechniques } = await import("../../src/novel-writer/technique-store.js")
    const ids = (await listTechniques(projectDir)).map((e) => e.id)

    const result = await confirmTechniques(ids, projectDir)
    expect(result.injected).toBeLessThan(5)

    const c6 = domainEntries("c6-technique")
    expect(sumByKey(c6, "technique.confirmed")).toBe(1)
    expect(sumByKey(c6, "technique.injected")).toBe(result.injected)
    expect(sumByKey(c6, "technique.p7.trimmed")).toBe(5 - result.injected)
  })
})

describe("save_technique 工具埋点", () => {
  const validArgs = {
    name: "埋点入库技法",
    principle: "停顿比直接回应更有张力",
    instruction: "写紧张对话时每3句插入一个角色的微小动作",
    scene_types: ["dialogue"],
    level: "dialogue" as const,
    evidence: [{ source_title: "书A", source_location: "第1章", excerpt: "他停下筷子", annotation: "停顿暗示拒绝" }],
    common_misuse: "停顿过多导致拖沓",
    scope: "adult" as const,
  }

  test("入库成功记 technique.learn.created", async () => {
    const result = await createWritingTools().save_technique.execute(validArgs, createToolContext(projectDir))
    expect(result.action).not.toBe("rejected")
    expect(sumByKey(domainEntries("c6-technique"), "technique.learn.created")).toBe(1)
  })

  test("模糊指令被拒记 technique.learn.rejected，且不产生 created", async () => {
    const result = await createWritingTools().save_technique.execute(
      { ...validArgs, name: "模糊技法", instruction: "要注意对话节奏" },
      createToolContext(projectDir),
    )
    expect(result.action).toBe("rejected")
    const c6 = domainEntries("c6-technique")
    expect(sumByKey(c6, "technique.learn.rejected")).toBe(1)
    expect(sumByKey(c6, "technique.learn.created")).toBe(0)
  })
})
