/**
 * node-runtime 测试（node:test 风格）：统一事务入口 withTransaction 在真实 node:sqlite 下的行为。
 *
 * 覆盖（提案 3.3）：
 * 1. withTransaction 三错误形态/正常路径：正常提交、回调抛错回滚、异步回调拒绝、嵌套检测
 * 2. Phase 1 四步原子性：四步收进单事务，第三步注入失败时前两步一并回滚
 * 3. 嵌套 savepoint：驱动层事务嵌套（drizzle savepoint）内层回滚不影响外层提交
 *
 * 运行方式（须 Node ≥ 24，node:sqlite 才有 drizzle 依赖的 setReturnArrays/isTransaction）：
 *   bun build --target=node --outfile <bundle>.mjs test-node/with-transaction.node.ts
 *   node --test <bundle>.mjs
 *
 * 文件后缀用 .node.ts 而非 .test.ts：bun test 会按 *.test.* 拾取，
 * 而这些用例只在 node 运行时有效（不得混入 bun 套件）。
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const store = await import("../src/index.js")
const { sql } = await import("drizzle-orm")

/** 每个用例独立目录 + 独立 DB，避免连接缓存串扰 */
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "ns-tx-node-"))
  mkdirSync(join(dir, ".novel"), { recursive: true })
  const db = store.getDb(dir)
  return {
    dir,
    db,
    cleanup() {
      store.closeDb(dir)
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    },
  }
}

function seedNovel(db: store.Db, novelId: string) {
  db.insert(store.NovelTable)
    .values({ id: novelId, title: "node 事务验证", genre: "test", synopsis: "", status: "draft" })
    .run()
}

test("withTransaction：正常提交，写入可见", () => {
  const { dir, db, cleanup } = freshDb()
  try {
    seedNovel(db, "n1")
    store.withTransaction(db, (tx) => {
      tx.insert(store.ChapterTable)
        .values({
          id: "c1",
          novel_id: "n1",
          title: "第一章",
          content: "正文",
          word_count: 2,
          status: "drafted",
          order: 1,
        } as never)
        .run()
    })
    const rows = db.select().from(store.ChapterTable).all()
    assert.equal(rows.length, 1)
  } finally {
    cleanup()
  }
  void dir
})

test("withTransaction：回调抛错，写入整体回滚", () => {
  const { db, cleanup } = freshDb()
  try {
    seedNovel(db, "n1")
    assert.throws(() =>
      store.withTransaction(db, (tx) => {
        tx.insert(store.ChapterTable)
          .values({
            id: "c1",
            novel_id: "n1",
            title: "第一章",
            content: "正文",
            word_count: 2,
            status: "drafted",
            order: 1,
          } as never)
          .run()
        throw new Error("模拟第二步失败")
      }),
    )
    assert.equal(db.select().from(store.ChapterTable).all().length, 0)
  } finally {
    cleanup()
  }
})

test("withTransaction：异步回调被拒绝（thenable 检查兜底），写入回滚", () => {
  const { db, cleanup } = freshDb()
  try {
    seedNovel(db, "n1")
    const attempt = () =>
      store.withTransaction(db, async (tx) => {
        tx.insert(store.ChapterTable)
          .values({
            id: "c1",
            novel_id: "n1",
            title: "第一章",
            content: "正文",
            word_count: 2,
            status: "drafted",
            order: 1,
          } as never)
          .run()
      })
    assert.throws(attempt, /同步函数/)
    assert.equal(db.select().from(store.ChapterTable).all().length, 0)
  } finally {
    cleanup()
  }
})

test("withTransaction：嵌套检测报错（node:sqlite isTransaction），内层写入回滚", () => {
  const { db, cleanup } = freshDb()
  try {
    seedNovel(db, "n1")
    const attempt = () =>
      store.withTransaction(db, (tx) => {
        tx.insert(store.ChapterTable)
          .values({
            id: "c-outer",
            novel_id: "n1",
            title: "外层",
            content: "正文",
            word_count: 2,
            status: "drafted",
            order: 1,
          } as never)
          .run()
        store.withTransaction(db, (inner) => {
          inner.insert(store.ChapterTable)
            .values({
              id: "c-inner",
              novel_id: "n1",
              title: "内层",
              content: "正文",
              word_count: 2,
              status: "drafted",
              order: 2,
            } as never)
            .run()
        })
      })
    assert.throws(attempt, /嵌套事务/)
    assert.equal(db.select().from(store.ChapterTable).all().length, 0)
  } finally {
    cleanup()
  }
})

test("Phase 1 四步原子性：第三步实体引用扫描失败时，指纹与段摘要一并回滚", async () => {
  const { db, cleanup } = freshDb()
  try {
    seedNovel(db, "n1")
    for (let i = 1; i <= 3; i++) {
      db.insert(store.ChapterTable)
        .values({
          id: `c${i}`,
          novel_id: "n1",
          title: `第${i}章`,
          content: `第${i}章正文`,
          word_count: 5,
          status: "drafted",
          order: i,
        } as never)
        .run()
    }
    db.run(sql`DROP TABLE entity_refs`)
    await assert.rejects(() => store.runDeterministicUpgrade(db, "n1"))
    // 第一步指纹与第二步段摘要必须随事务回滚，不留半成品派生数据
    const chapters = db.select().from(store.ChapterTable).all()
    assert.ok(chapters.every((c) => !c.content_fingerprint))
    assert.equal(db.select().from(store.SegmentSummaryTable).all().length, 0)
  } finally {
    cleanup()
  }
})

test("嵌套 savepoint：驱动层事务嵌套内层回滚、外层提交，互不影响", () => {
  const { db, cleanup } = freshDb()
  try {
    seedNovel(db, "n1")
    db.transaction((outer) => {
      outer.insert(store.ChapterTable)
        .values({
          id: "c-outer",
          novel_id: "n1",
          title: "外层",
          content: "正文",
          word_count: 2,
          status: "drafted",
          order: 1,
        } as never)
        .run()
      assert.throws(() =>
        db.transaction((inner) => {
          inner.insert(store.ChapterTable)
            .values({
              id: "c-inner",
              novel_id: "n1",
              title: "内层",
              content: "正文",
              word_count: 2,
              status: "drafted",
              order: 2,
            } as never)
            .run()
          throw new Error("内层失败")
        }),
      )
    })
    const rows = db.select({ id: store.ChapterTable.id }).from(store.ChapterTable).all()
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      ["c-outer"],
    )
  } finally {
    cleanup()
  }
})
