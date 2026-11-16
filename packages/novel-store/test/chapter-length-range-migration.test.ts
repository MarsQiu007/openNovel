/**
 * 篇幅限制开关折算迁移测试（migrateChapterLengthRange）。
 *
 * 九条路径：开关 true 折算并删键（含双重编码防御）/ 非 "true" 仅删键补空串 /
 * 脏数据仅删键不折算 / 正数微值钳 1 / 浮点按 Number 口径折算 / 已有上限不覆盖 /
 * 无 style_guide 表跳过 / 二次执行零写入 / 单行损坏跳过并 warn 其余正常迁移。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { migrateChapterLengthRange } from "../src/migrate.js"

let dir: string
let dbPath: string

beforeEach(() => {
  dir = join(tmpdir(), `length-range-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  dbPath = join(dir, "test.db")
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

const SCHEMA = `CREATE TABLE style_guide (id text PRIMARY KEY, novel_id text NOT NULL, rules text DEFAULT '{}' NOT NULL, tone text DEFAULT '' NOT NULL, pov text DEFAULT '' NOT NULL, tense text DEFAULT '' NOT NULL);`

function seedRows(rows: Array<{ id: string; rules: string }>) {
  const seed = new Database(dbPath)
  seed.exec(SCHEMA)
  for (const row of rows) {
    seed
      .query("INSERT INTO style_guide (id, novel_id, rules, tone, pov, tense) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, "novel-1", row.rules, "", "", "")
  }
  seed.close()
}

function openWithUpdateCounting() {
  const sqlite = new Database(dbPath)
  let updates = 0
  const exec = (sql: string) => {
    if (sql.startsWith("UPDATE")) updates++
    return sqlite.exec(sql)
  }
  const query = (sql: string) => sqlite.query(sql).all()
  return { sqlite, exec, query, updateCount: () => updates }
}

function readRules(id: string): Record<string, string> {
  const db = new Database(dbPath)
  const row = db.query("SELECT rules FROM style_guide WHERE id = ?").get(id) as { rules: string }
  db.close()
  return JSON.parse(row.rules) as Record<string, string>
}

function captureWarns(): { warns: string[]; restore: () => void } {
  const warns: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(" "))
  return { warns, restore: () => (console.warn = original) }
}

describe("migrateChapterLengthRange 存量折算", () => {
  test("开关 true 折算并删键：双重编码 fixture 4000→3400/4600", () => {
    // 历史行可能把整份 rules 再包一层 JSON 字符串（双重编码），迁移须先解外层
    seedRows([{ id: "sg-1", rules: JSON.stringify(JSON.stringify({ chapter_length: "4000", chapter_length_limit: "true" })) }])
    const { exec, query, updateCount, sqlite } = openWithUpdateCounting()
    migrateChapterLengthRange(exec, query)
    expect(updateCount()).toBe(1)
    const rules = readRules("sg-1")
    expect(rules.chapter_length).toBe("3400")
    expect(rules.chapter_length_max).toBe("4600")
    expect("chapter_length_limit" in rules).toBe(false)
    sqlite.close()
  })

  test("开关非 true 仅删键不折算且补空串", () => {
    seedRows([{ id: "sg-1", rules: JSON.stringify({ chapter_length: "2500", chapter_length_limit: "false" }) }])
    const { exec, query, updateCount, sqlite } = openWithUpdateCounting()
    migrateChapterLengthRange(exec, query)
    expect(updateCount()).toBe(1)
    const rules = readRules("sg-1")
    expect(rules.chapter_length).toBe("2500")
    expect(rules.chapter_length_max).toBe("")
    expect("chapter_length_limit" in rules).toBe(false)
    sqlite.close()
  })

  test("开关 true 但原值脏（0/-3/abc）：不折算、原值不动、仅删键补空串", () => {
    seedRows([
      { id: "sg-zero", rules: JSON.stringify({ chapter_length: "0", chapter_length_limit: "true" }) },
      { id: "sg-neg", rules: JSON.stringify({ chapter_length: "-3", chapter_length_limit: "true" }) },
      { id: "sg-nan", rules: JSON.stringify({ chapter_length: "abc", chapter_length_limit: "true" }) },
    ])
    const { exec, query, sqlite } = openWithUpdateCounting()
    migrateChapterLengthRange(exec, query)
    expect(readRules("sg-zero")).toEqual({ chapter_length: "0", chapter_length_max: "" })
    expect(readRules("sg-neg")).toEqual({ chapter_length: "-3", chapter_length_max: "" })
    expect(readRules("sg-nan")).toEqual({ chapter_length: "abc", chapter_length_max: "" })
    sqlite.close()
  })

  test("正数微值 1：下限钳为 1、上限 2（存活微区间，非降级形态）", () => {
    seedRows([{ id: "sg-1", rules: JSON.stringify({ chapter_length: "1", chapter_length_limit: "true" }) }])
    const { exec, query, sqlite } = openWithUpdateCounting()
    migrateChapterLengthRange(exec, query)
    const rules = readRules("sg-1")
    expect(rules.chapter_length).toBe("1")
    expect(rules.chapter_length_max).toBe("2")
    sqlite.close()
  })

  test("浮点原值 2500.7：按 Number 口径折算为 2125/2876（锚死与 parseInt 的差一）", () => {
    seedRows([{ id: "sg-1", rules: JSON.stringify({ chapter_length: "2500.7", chapter_length_limit: "true" }) }])
    const { exec, query, sqlite } = openWithUpdateCounting()
    migrateChapterLengthRange(exec, query)
    const rules = readRules("sg-1")
    expect(rules.chapter_length).toBe("2125")
    expect(rules.chapter_length_max).toBe("2876")
    sqlite.close()
  })

  test("已有 chapter_length_max 不覆盖", () => {
    seedRows([{ id: "sg-1", rules: JSON.stringify({ chapter_length: "3000", chapter_length_limit: "true", chapter_length_max: "8000" }) }])
    const { exec, query, sqlite } = openWithUpdateCounting()
    migrateChapterLengthRange(exec, query)
    const rules = readRules("sg-1")
    expect(rules.chapter_length).toBe("2550")
    expect(rules.chapter_length_max).toBe("8000")
    expect("chapter_length_limit" in rules).toBe(false)
    sqlite.close()
  })

  test("无 style_guide 表整体跳过，不抛错", () => {
    const bare = new Database(dbPath)
    bare.exec("CREATE TABLE techniques (id text PRIMARY KEY)")
    let updates = 0
    const exec = (sql: string) => {
      if (sql.startsWith("UPDATE")) updates++
      return bare.exec(sql)
    }
    const query = (sql: string) => bare.query(sql).all()
    expect(() => migrateChapterLengthRange(exec, query)).not.toThrow()
    expect(updates).toBe(0)
    bare.close()
  })

  test("幂等：首次全量写入，二次执行零 UPDATE", () => {
    seedRows([
      { id: "sg-a", rules: JSON.stringify({ chapter_length: "4000", chapter_length_limit: "true" }) },
      { id: "sg-b", rules: JSON.stringify({ chapter_length: "2500", chapter_length_limit: "false" }) },
      { id: "sg-c", rules: JSON.stringify({ chapter_length: "2500", chapter_length_max: "5000" }) },
      { id: "sg-d", rules: JSON.stringify({ chapter_length: "2500" }) },
    ])
    const first = openWithUpdateCounting()
    migrateChapterLengthRange(first.exec, first.query)
    // sg-a/sg-b/sg-d 三行需写；sg-c 已是迁移后形态，按无键变更零写入契约不触碰
    expect(first.updateCount()).toBe(3)
    first.sqlite.close()

    const second = openWithUpdateCounting()
    migrateChapterLengthRange(second.exec, second.query)
    expect(second.updateCount()).toBe(0)
    expect(readRules("sg-a")).toEqual({ chapter_length: "3400", chapter_length_max: "4600" })
    expect(readRules("sg-b")).toEqual({ chapter_length: "2500", chapter_length_max: "" })
    expect(readRules("sg-c")).toEqual({ chapter_length: "2500", chapter_length_max: "5000" })
    expect(readRules("sg-d")).toEqual({ chapter_length: "2500", chapter_length_max: "" })
    second.sqlite.close()
  })

  test("单行 rules 损坏：该行跳过并 console.warn，其余行正常迁移", () => {
    seedRows([
      { id: "sg-broken", rules: "这不是 JSON{{{)" },
      { id: "sg-good", rules: JSON.stringify({ chapter_length: "4000", chapter_length_limit: "true" }) },
    ])
    const { warns, restore } = captureWarns()
    const { exec, query, updateCount, sqlite } = openWithUpdateCounting()
    try {
      migrateChapterLengthRange(exec, query)
    } finally {
      restore()
    }
    expect(warns.some((w) => w.includes("sg-broken"))).toBe(true)
    expect(updateCount()).toBe(1)
    // 损坏行原样保留
    const brokenDb = new Database(dbPath)
    const brokenRow = brokenDb.query("SELECT rules FROM style_guide WHERE id = ?").get("sg-broken") as { rules: string }
    brokenDb.close()
    expect(brokenRow.rules).toBe("这不是 JSON{{{)")
    expect(readRules("sg-good")).toEqual({ chapter_length: "3400", chapter_length_max: "4600" })
    sqlite.close()
  })
})
