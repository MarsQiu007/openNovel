/**
 * 统一事务入口测试。
 *
 * 覆盖任务书 1.1 的五个场景：
 * 正常提交 / 回调抛错回滚 / 异步回调拒绝 / 嵌套检测报错 / 驱动无检测能力时降级。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb, getDb, NovelTable, type Db } from "../src/index.js"
import { withTransaction, detectInTransaction, type Tx } from "../src/tx.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function insertNovel(tx: Tx, id: string) {
  tx.insert(NovelTable)
    .values({ id, title: "事务测试", genre: "玄幻", synopsis: "", status: "draft", created_at: Date.now(), updated_at: Date.now() })
    .run()
}

function novelCount(db: Db) {
  return db.select({ id: NovelTable.id }).from(NovelTable).all().length
}

describe("detectInTransaction 特性探测", () => {
  test("bun 形态（inTransaction 布尔）", () => {
    expect(detectInTransaction({ inTransaction: true })).toBe(true)
    expect(detectInTransaction({ inTransaction: false })).toBe(false)
  })

  test("node 形态（isTransaction 布尔，Node ≥ 24）", () => {
    expect(detectInTransaction({ isTransaction: true })).toBe(true)
    expect(detectInTransaction({ isTransaction: false })).toBe(false)
  })

  test("两者皆无或形状不符时返回 undefined（降级）", () => {
    expect(detectInTransaction({})).toBeUndefined()
    expect(detectInTransaction(null)).toBeUndefined()
    expect(detectInTransaction("sqlite")).toBeUndefined()
    expect(detectInTransaction({ inTransaction: "yes" })).toBeUndefined()
  })
})

describe("withTransaction", () => {
  test("正常提交：回调写入在事务提交后可见", () => {
    const db = getDb(projectDir)
    const result = withTransaction(db, (tx) => {
      insertNovel(tx, "n-committed")
      return "done"
    })
    expect(result).toBe("done")
    expect(novelCount(db)).toBe(1)
  })

  test("回调抛错完整回滚：事务内已写入的行不留存", () => {
    const db = getDb(projectDir)
    expect(() =>
      withTransaction(db, (tx) => {
        insertNovel(tx, "n-rolled-back")
        throw new Error("模拟第 N 步失败")
      }),
    ).toThrow("模拟第 N 步失败")
    expect(novelCount(db)).toBe(0)
  })

  test("异步回调被拒绝：返回 Promise 即抛错，同步段写入回滚", () => {
    const db = getDb(projectDir)
    expect(() =>
      withTransaction(db, (tx) => {
        insertNovel(tx, "n-async")
        return Promise.resolve("异步续体不应落入事务")
      }),
    ).toThrow(/同步函数/)
    expect(novelCount(db)).toBe(0)
  })

  test("嵌套检测：事务内再开事务抛可读错误，外层写入一并回滚", () => {
    const db = getDb(projectDir)
    let innerError: Error | undefined
    try {
      withTransaction(db, (tx) => {
        insertNovel(tx, "n-outer")
        withTransaction(db, (innerTx) => {
          insertNovel(innerTx, "n-inner")
        })
      })
    } catch (error) {
      innerError = error as Error
    }
    expect(innerError).toBeDefined()
    expect(innerError!.message).toContain("嵌套事务")
    expect(innerError!.message).toContain("*Tx")
    // 内层抛错穿透外层回调 → 外层事务同样回滚
    expect(novelCount(db)).toBe(0)
  })

  test("驱动无检测能力时降级：不做检测，行为与调用前一致", () => {
    const calls: string[] = []
    const stubDb = {
      $client: {},
      transaction: (fn: (tx: string) => string) => fn("stub-tx"),
    } as unknown as Db
    const result = withTransaction(stubDb, (tx) => {
      calls.push(tx)
      return "ok"
    })
    expect(result).toBe("ok")
    expect(calls).toEqual(["stub-tx"])
  })
})
