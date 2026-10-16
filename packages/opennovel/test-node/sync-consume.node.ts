/**
 * node-runtime 测试（node:test 风格）：手动编辑同步 worker 消费链 + 真实章节重建 handler。
 *
 * 覆盖（提案 3.3）：同步队列消费 + 真实章节重建 handler 链——
 * 注册调用真实 rebuildChapterDerivedData 的 handler（LLM 以固定输出桩掉），
 * enqueue 章节正文任务后跑 processSyncQueue，断言队列条目 synced 且
 * 摘要/主轴/实体引用全部落库。这正是 10-13 事故链在 node:sqlite 下的真实形态：
 * 升级任务消费 → handler 重建（内部 withTransaction）→ 状态回写事务。
 *
 * 运行方式（须 Node ≥ 24）：
 *   bun build --target=node --outfile <bundle>.mjs test-node/sync-consume.node.ts
 *   node --test <bundle>.mjs
 *
 * 文件后缀用 .node.ts 而非 .test.ts：bun test 会按 *.test.* 拾取，
 * 而这些用例只在 node 运行时有效（不得混入 bun 套件）。
 */
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const store = await import("@opennovel-ai/novel-store")
const worker = await import("../src/novel/manual-edit-sync-worker.js")
const { rebuildChapterDerivedData } = await import("../../plugin/src/novel-writer/chapter-rebuild.js")

let dir: string
let db: store.Db

const llm = async () =>
  JSON.stringify({
    summary: "林天于青云宗修炼。",
    key_events: ["林天修炼"],
    char_changes: ["林天修为进步"],
    spine: [{ content: "开篇立人物", kind: "chapter" }],
  })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opennovel-sync-node-"))
  mkdirSync(join(dir, ".novel"), { recursive: true })
  db = store.getDb(dir)
  db.insert(store.NovelTable)
    .values({ id: "n1", title: "node 同步验证", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  db.insert(store.ChapterTable)
    .values({
      id: "c1",
      novel_id: "n1",
      title: "第一章",
      content: "林天在青云宗修炼，苏婉儿走来。",
      word_count: 16,
      status: "drafted",
      order: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    } as never)
    .run()
  for (const name of ["林天", "苏婉儿"]) {
    db.insert(store.CharacterTable)
      .values({ id: `char-${name}`, novel_id: "n1", name, role: "main", description: "" } as never)
      .run()
  }
  worker.registerSyncHandler({
    handleChapterContent: (_directory, novelId, chapterId, fingerprint) =>
      rebuildChapterDerivedData(db, novelId, chapterId, fingerprint, llm),
  })
})

afterEach(() => {
  worker.clearSyncHandlers()
  store.closeDb(dir)
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

test("章节正文任务消费：真实重建 handler 跑通 + 状态回写事务 synced", async () => {
  await store.enqueueManualEditSync(
    { novelId: "n1", entity: "chapter", entityId: "c1", field: "content", sourceFingerprint: "fp-1" },
    dir,
  )

  const processed = await worker.processSyncQueue(dir)
  assert.equal(processed, 1)

  // 状态回写事务：队列条目 synced 且无失败原因
  const [row] = db.select().from(store.ManualEditSyncQueueTable).all()
  assert.equal(row!.status, "synced")
  assert.equal(row!.failure_reason, null)

  // 真实重建 handler 的落库：摘要 + 主轴 + 实体引用
  const summaries = db.select().from(store.ChapterSummaryTable).all()
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0]!.source_fingerprint, "fp-1")
  const spine = db.select().from(store.StorySpineEntryTable).all()
  assert.equal(spine.length, 1)
  assert.equal(spine[0]!.status, "synced")
  const refs = db.select().from(store.EntityRefTable).all()
  assert.ok(refs.length >= 2, `实体引用应至少 2 条，实际 ${refs.length}`)
})

test("handler 抛错时条目 failed 并保留原因，重跑成功后可再消费", async () => {
  worker.clearSyncHandlers()
  let calls = 0
  worker.registerSyncHandler({
    handleChapterContent: () => {
      calls++
      if (calls === 1) return Promise.reject(new Error("模拟 observer 调用失败"))
      return rebuildChapterDerivedData(db, "n1", "c1", "fp-1", llm)
    },
  })
  await store.enqueueManualEditSync(
    { novelId: "n1", entity: "chapter", entityId: "c1", field: "content", sourceFingerprint: "fp-1" },
    dir,
  )

  assert.equal(await worker.processSyncQueue(dir), 0)
  const [failed] = db.select().from(store.ManualEditSyncQueueTable).all()
  assert.equal(failed!.status, "failed")
  assert.match(failed!.failure_reason ?? "", /observer 调用失败/)

  // 失败条目不阻塞下一批：升级视图重试（failed → pending）后消费成功并落库
  const retried = await store.retryManualEditSync("n1", [failed!.id], dir)
  assert.equal(retried.retried, 1)
  assert.equal(await worker.processSyncQueue(dir), 1)
  const [synced] = db.select().from(store.ManualEditSyncQueueTable).all()
  assert.equal(synced!.status, "synced")
  assert.equal(db.select().from(store.ChapterSummaryTable).all().length, 1)
})
