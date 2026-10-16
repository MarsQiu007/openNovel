/**
 * 事务纪律静态守卫 — 手写 BEGIN 模板字面量扫描（unified-transactions 提案 3.1）
 *
 * 背景：10-13 修复把 scanEntityReferences 包进 drizzle 事务后，
 * chapter-rebuild.ts 的手写 `db.run(sql`BEGIN`)` 在 node:sqlite 下嵌套 begin 报错
 * （"cannot start a transaction within a transaction"，bun:sqlite 静默放过形成 CI 盲区），
 * 真实用户库留下 failed 同步条目。此后所有多步写入必须走 novel-store 的
 * withTransaction 统一入口，禁止再手写 BEGIN。
 *
 * 守卫范围：packages/plugin/src、packages/novel-store/src、packages/opennovel/src。
 * 只拦 drizzle 模板字面量形态 `` sql`BEGIN` ``：migrate.ts 的 `exec("BEGIN")`
 * 字符串形态是 drizzle 迁移器的合法用法，不匹配本守卫；
 * 注释内出现模板字面量形态同样拦截（防止「先注释掉备用」绕过）。
 */
import { describe, test, expect } from "bun:test"
import { join } from "path"
import { readFileSync } from "fs"
import { globSync } from "glob"

// import.meta.dir = packages/plugin/test → 包根 = ..，monorepo 包目录 = ../..
const PLUGIN_ROOT = join(import.meta.dir, "..")
const PACKAGES_ROOT = join(import.meta.dir, "..", "..")

const SCAN_ROOTS = [
  join(PLUGIN_ROOT, "src"),
  join(PACKAGES_ROOT, "novel-store", "src"),
  join(PACKAGES_ROOT, "opennovel", "src"),
]

/** 匹配 sql`...BEGIN...`（大小写不敏感，BEGIN 为独立单词） */
const HANDWRITTEN_BEGIN = /\bsql\s*`[^`]*?\bBEGIN\b/i

function scanFiles(): Array<{ file: string; line: number; text: string }> {
  const violations: Array<{ file: string; line: number; text: string }> = []
  for (const root of SCAN_ROOTS) {
    for (const rel of globSync("**/*.{ts,tsx}", { cwd: root })) {
      const file = join(root, rel)
      const lines = readFileSync(file, "utf-8").split("\n")
      lines.forEach((text, index) => {
        if (HANDWRITTEN_BEGIN.test(text)) {
          violations.push({ file, line: index + 1, text: text.trim() })
        }
      })
    }
  }
  return violations
}

function countScannedFiles(): number {
  return SCAN_ROOTS.reduce((sum, root) => sum + globSync("**/*.{ts,tsx}", { cwd: root }).length, 0)
}

describe("静态守卫：*Tx 组合形态函数体内不得再开事务", () => {
  // D2 组合形态契约：*Tx 接收外层事务对象、只做直接写入；再开事务即嵌套，
  // 驱动层直接报错（node:sqlite）或被静默放过（bun:sqlite CI 盲区）。
  const TX_FUNCTIONS: Array<{ file: string; name: string }> = [
    { file: "approval.ts", name: "requestApprovalTx" },
    { file: "entity-refs.ts", name: "scanEntityReferencesTx" },
    { file: "manual-edit-sync.ts", name: "enqueueManualEditSyncTx" },
    { file: "manual-edit-sync.ts", name: "saveBookMetaTx" },
  ]

  const FORBIDDEN_IN_TX_BODY = [
    { regex: /\bwithTransaction\s*\(/, label: "withTransaction(" },
    { regex: /\.transaction\s*\(/, label: ".transaction(" },
    { regex: HANDWRITTEN_BEGIN, label: "sql`BEGIN`" },
  ]

  /** 从源码中提取函数体（首个 { 起，按花括号配平到闭合） */
  function extractFunctionBody(source: string, name: string): string {
    const start = source.indexOf(`function ${name}(`)
    if (start === -1) throw new Error(`未找到函数 ${name}`)
    const braceStart = source.indexOf("{", start)
    let depth = 0
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === "{") depth++
      else if (source[i] === "}") {
        depth--
        if (depth === 0) return source.slice(braceStart, i + 1)
      }
    }
    throw new Error(`函数 ${name} 花括号不配平`)
  }

  for (const { file, name } of TX_FUNCTIONS) {
    test(`${file} 的 ${name} 函数体不含再开事务调用`, () => {
      const source = readFileSync(join(PACKAGES_ROOT, "novel-store", "src", file), "utf-8")
      const body = extractFunctionBody(source, name)
      for (const { regex, label } of FORBIDDEN_IN_TX_BODY) {
        expect(regex.test(body), `${name} 函数体内出现 ${label}（组合形态禁止自开事务）`).toBe(false)
      }
    })
  }
})

describe("静态守卫：源码中不得出现手写 BEGIN 模板字面量", () => {
  test("扫描根目录存在且确实读到源文件（防空虚通过）", () => {
    for (const root of SCAN_ROOTS) {
      expect(globSync("**/*.{ts,tsx}", { cwd: root }).length).toBeGreaterThan(0)
    }
    expect(countScannedFiles()).toBeGreaterThan(100)
  })

  test("plugin/novel-store/opennovel 三个 src 目录扫描为零命中", () => {
    const violations = scanFiles()
    const detail = violations.map((v) => `${v.file}:${v.line} ${v.text}`).join("\n")
    expect(violations, detail).toEqual([])
  })

  test("守卫正则只拦模板字面量形态，不拦 exec(\"BEGIN\") 字符串形态", () => {
    expect(HANDWRITTEN_BEGIN.test('db.exec("BEGIN")')).toBe(false)
    expect(HANDWRITTEN_BEGIN.test('client.exec("BEGIN IMMEDIATE")')).toBe(false)
    expect(HANDWRITTEN_BEGIN.test("db.run(sql`BEGIN`)")).toBe(true)
    expect(HANDWRITTEN_BEGIN.test("db.run(sql`begin immediate`)")).toBe(true)
    // 注释内的模板字面量形态同样拦截（防止注释绕过）
    expect(HANDWRITTEN_BEGIN.test("// 旧代码 db.run(sql`BEGIN`)")).toBe(true)
  })
})
