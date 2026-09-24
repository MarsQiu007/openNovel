/**
 * 端到端集成验收：手动编辑 → 同步 worker → 上下文门禁 → 写作放行。
 *
 * 场景 1：手动修改已摘要章节正文后，AI 写作先被门禁阻塞；
 *          同步 worker 处理后门禁放行，派生数据指纹已更新。
 * 场景 2：UI 修改角色名后，同步 worker 生成去重影响任务；
 *          AI 写作门禁检测到设定联动并提示目标对象。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq, and } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  ChapterSummaryTable,
  EntityRefTable,
  PendingUpdateTable,
  StorySpineEntryTable,
  enqueueManualEditSync,
  querySyncStatus,
  markDerivedStale,
  computeFingerprint,
  NovelTable,
} from "@opennovel-ai/novel-store"
import {
  updateSyncStatus,
  ManualEditSyncQueueTable,
} from "@opennovel-ai/novel-store"
import {
  checkContentSyncGate,
  checkSettingImpactGate,
  skipSyncEntries,
} from "../src/novel-writer/edit-sync-gate"


/** 模拟 worker：处理 pending 条目（与 opennovel worker 相同的状态转换逻辑） */
async function processPendingSyncs(directory: string | null | undefined): Promise<number> {
  const db = getDb(directory)
  const pending = await db
    .select()
    .from(ManualEditSyncQueueTable)
    .where(eq(ManualEditSyncQueueTable.status, "pending"))
    .limit(10)
  let processed = 0
  for (const entry of pending) {
    // 确定性标记摘要指纹
    if (entry.entity === "chapter" && entry.entity_id) {
      await db
        .update(ChapterSummaryTable)
        .set({ source_fingerprint: entry.source_fingerprint })
        .where(eq(ChapterSummaryTable.chapter_id, entry.entity_id))
        .run()
    } else if (entry.entity_id) {
      // 非章节实体：确定性引用扫描 + 影响任务
      const refs = await db
        .select()
        .from(EntityRefTable)
        .where(and(eq(EntityRefTable.novel_id, entry.novel_id), eq(EntityRefTable.target_id, entry.entity_id)))
        .all()
      for (const ref of refs) {
        const existing = await db
          .select()
          .from(PendingUpdateTable)
          .where(
            and(
              eq(PendingUpdateTable.novel_id, entry.novel_id),
              eq(PendingUpdateTable.trigger_id, entry.entity_id),
              eq(PendingUpdateTable.source_id, ref.source_id),
              eq(PendingUpdateTable.status, "pending"),
            ),
          )
          .get()
        if (!existing) {
          await db.insert(PendingUpdateTable).values({
            id: crypto.randomUUID(),
            novel_id: entry.novel_id,
            source_type: ref.source_type,
            source_id: ref.source_id,
            trigger_type: entry.entity,
            trigger_id: entry.entity_id,
            trigger_field: entry.field,
            reason: `手动修改 ${entry.entity} 触发引用更新`,
            status: "pending",
            priority: "medium",
          }).run()
        }
      }
    }
    await updateSyncStatus(entry.id, "synced", null, directory)
    processed++
  }
  return processed
}

let projectDir: string
let novelId: string

beforeEach(() => {
  projectDir = join(tmpdir(), `e2e-manual-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "E2E 集成测试",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用
  }
})

describe("场景 1：手动修改正文 → 门禁 → 同步 → 放行", () => {
  test("完整链路：阻塞 → worker 同步 → 指纹刷新 → 放行", async () => {
    // 1. 创建章节并已有摘要（指纹为旧值）
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    const db = getDb(projectDir)
    const oldFp = computeFingerprint("旧正文内容")
    db.insert(ChapterSummaryTable).values({
      id: crypto.randomUUID(),
      chapter_id: chapter.id,
      summary: "旧摘要",
      source_fingerprint: oldFp,
    }).run()

    // 2. 手动修改正文 → 标记派生数据过期并入队同步
    const newContent = "用户手动编辑的新正文"
    const newFp = computeFingerprint(newContent)
    await markDerivedStale(novelId, chapter.id, newFp, projectDir)

    // 3. 写作门禁此时应阻塞
    const gateBefore = checkContentSyncGate(novelId, undefined, projectDir)
    expect(gateBefore.allowed).toBe(false)
    expect(gateBefore.reason).toContain("同步未完成")

    // 4. 同步 worker 处理队列
    const processed = await processPendingSyncs(projectDir)
    expect(processed).toBeGreaterThanOrEqual(1)

    // 5. 摘要指纹已刷新为新值
    const summary = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapter.id)).get()
    expect(summary?.source_fingerprint).toBe(newFp)

    // 6. 门禁放行
    const gateAfter = checkContentSyncGate(novelId, undefined, projectDir)
    expect(gateAfter.allowed).toBe(true)
  })

  test("用户显式跳过后放行且状态可追溯", async () => {
    const chapter = await createChapter(novelId, "第二章", 2, null, projectDir)
    await markDerivedStale(novelId, chapter.id, computeFingerprint("跳过场景正文"), projectDir)

    // 门禁阻塞
    const gateBefore = checkContentSyncGate(novelId, undefined, projectDir)
    expect(gateBefore.allowed).toBe(false)

    // 用户跳过
    await skipSyncEntries([...gateBefore.blockingSyncIds], projectDir)

    // 门禁放行且跳过状态可追溯
    const gateAfter = checkContentSyncGate(novelId, undefined, projectDir)
    expect(gateAfter.allowed).toBe(true)
    const entries = await querySyncStatus(novelId, { includeSynced: true }, projectDir)
    const skipped = entries.filter((e) => e.status === "skipped")
    expect(skipped.length).toBeGreaterThanOrEqual(1)
  })

  test("同步 worker 失败后门禁提供重试入口", async () => {
    const chapter = await createChapter(novelId, "第三章", 3, null, projectDir)
    await markDerivedStale(novelId, chapter.id, computeFingerprint("失败场景"), projectDir)

    // 直接标记同步为 failed（模拟 observer 重建超时）
    const entries = await querySyncStatus(novelId, { status: "pending" }, projectDir)
    for (const entry of entries) {
      await updateSyncStatus(entry.id, "failed", "observer 重建超时", projectDir)
    }

    // 门禁应报告失败原因
    const gate = checkContentSyncGate(novelId, undefined, projectDir)
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain("observer 重建超时")
  })
})

describe("场景 2：UI 修改设定 → 影响任务 → 门禁提示", () => {
  test("角色名修改后生成去重影响任务且门禁包含目标对象", async () => {
    const db = getDb(projectDir)

    // 插入实体引用（角色被章节引用）
    db.insert(EntityRefTable).values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      source_type: "chapter",
      source_id: "ch-1",
      target_type: "character",
      target_id: "char-hero",
      ref_field: "name",
      ref_text: "主角",
    }).run()

    // 手动修改角色名 → 入队同步
    await enqueueManualEditSync(
      { novelId, entity: "character", entityId: "char-hero", field: "name", sourceFingerprint: "fp-1" },
      projectDir,
    )

    // 设定门禁阻塞且包含目标对象
    const gateBefore = checkSettingImpactGate(novelId, projectDir)
    expect(gateBefore.allowed).toBe(false)
    expect(gateBefore.reason).toContain("character")

    // worker 处理 → 生成影响任务
    await processPendingSyncs(projectDir)

    // 影响任务已创建
    const tasks = db.select().from(PendingUpdateTable).where(eq(PendingUpdateTable.novel_id, novelId)).all()
    expect(tasks.length).toBe(1)
    expect(tasks[0]?.trigger_id).toBe("char-hero")

    // 门禁放行
    const gateAfter = checkSettingImpactGate(novelId, projectDir)
    expect(gateAfter.allowed).toBe(true)
  })
})

describe("场景 3：旧数据库兼容", () => {
  test("缺指纹的历史摘要标记待校验且不阻塞阅读", async () => {
    const chapter = await createChapter(novelId, "旧章节", 1, null, projectDir)
    const db = getDb(projectDir)

    // 模拟历史摘要（无指纹）
    db.insert(ChapterSummaryTable).values({
      id: crypto.randomUUID(),
      chapter_id: chapter.id,
      summary: "历史摘要（无指纹）",
      source_fingerprint: null,
    }).run()

    // 旧数据不影响门禁（没有 pending 同步任务）
    const gate = checkContentSyncGate(novelId, undefined, projectDir)
    expect(gate.allowed).toBe(true)

    // 历史摘要可正常读取
    const summary = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapter.id)).get()
    expect(summary?.summary).toBe("历史摘要（无指纹）")
    expect(summary?.source_fingerprint).toBeNull()
  })
})
