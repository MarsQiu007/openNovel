import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { getTableColumns } from "drizzle-orm"
import { NovelTable } from "../src/index.js"

// 全局库 novels 表存在多份列定义（core 建表 SQL、core 迁移、core drizzle、novel-store drizzle），
// novel-store 不能反向 import core，这里以 novel-store drizzle 定义为唯一事实源，
// 直接读 core 源码文本解析做一致性校验，漂移即红。

const coreSrc = join(import.meta.dir, "../../core/src")

// core 产物在模板字符串中用反斜杠转义反引号，这里用字符码拼出同样的两字符形态
const BS = String.fromCharCode(92)
const BT = String.fromCharCode(96)
const BS_BT = BS + BT

// 正则源里反斜杠需二次转义（先转义 JS 字符串、再转义正则）
const BS_RE = "\\\\"

type Col = { name: string; type: string; dflt: string | null; notnull: boolean }

const sqlType = (dataType: string) => {
  if (dataType.startsWith("string")) return "text"
  if (dataType.startsWith("number")) return "integer"
  throw new Error(`未映射的 drizzle 数据类型: ${dataType}`)
}

// 以 novel-store NovelTable drizzle 定义为基准（当前 10 列）
const baseline: Col[] = Object.values(getTableColumns(NovelTable)).map((column) => ({
  name: column.name,
  type: sqlType(column.dataType),
  dflt: sqlDefault(column.default),
  notnull: column.notNull,
}))

// drizzle 列的 SQL 默认值只会是文本或数值，其余形态视为定义出错，直接报错
function sqlDefault(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  throw new Error(`未预期的 drizzle 默认值形态: ${typeof value}`)
}

const renderCol = (column: Col) =>
  `${column.name} ${column.type}${column.notnull ? " NOT NULL" : ""}${column.dflt !== null ? ` DEFAULT '${column.dflt}'` : ""}`

const toCol = (name: string, type: string, flags: string): Col => ({
  name,
  type,
  dflt: /DEFAULT '([^']*)'/.exec(flags)?.[1] ?? null,
  // SQLite 中 PRIMARY KEY 列隐含 NOT NULL
  notnull: /NOT NULL|PRIMARY KEY/i.test(flags),
})

// 解析建表语句的列定义行（生成产物中反引号带反斜杠前缀）
const columnLine = new RegExp("^[ \\t]*" + BS_RE + "?" + BT + "([a-z_]+)" + BS_RE + "?" + BT + " (text|integer|real|blob)(.*)$", "gm")

function parseCreateTable(source: string, table: string): Col[] {
  const start = source.indexOf(`CREATE TABLE ${BS_BT}${table}${BS_BT}`)
  if (start < 0) throw new Error(`未找到 ${table} 建表语句`)
  const end = source.indexOf(");", start)
  if (end < 0) throw new Error(`建表语句未闭合: ${table}`)
  const cols = [...source.slice(start, end).matchAll(columnLine)].map((match) => {
    const [, name, type, flags] = match
    if (name === undefined || type === undefined || flags === undefined) throw new Error("列定义解析失败")
    return toCol(name, type, flags)
  })
  if (cols.length === 0) throw new Error(`${table} 建表语句未解析到任何列`)
  return cols
}

// 解析 ALTER TABLE ... ADD 列语句（本提案的补列迁移）
const addColumn = new RegExp(`ADD ${BS_RE}${BT}([a-z_]+)${BS_RE}${BT} (text|integer|real|blob)([^;]*);`, "g")

function parseAddColumns(source: string): Col[] {
  const cols = [...source.matchAll(addColumn)].map((match) => {
    const [, name, type, flags] = match
    if (name === undefined || type === undefined || flags === undefined) throw new Error("ADD 列解析失败")
    return toCol(name, type, flags)
  })
  if (cols.length === 0) throw new Error("未解析到任何 ADD 列语句")
  return cols
}

// 解析 core drizzle 表定义块的列名（四个空格缩进的列声明行，如 id: text().primaryKey()）
const drizzleDecl = /    ([a-z_]+): (text|integer|real|blob)\(/g

function parseDrizzleTable(source: string, exportName: string): string[] {
  const start = source.indexOf(`export const ${exportName} = sqliteTable(`)
  if (start < 0) throw new Error(`未找到 ${exportName} drizzle 定义`)
  const end = source.indexOf("\n)", start)
  if (end < 0) throw new Error(`drizzle 定义未闭合: ${exportName}`)
  const names = [...source.slice(start, end).matchAll(drizzleDecl)].map((match) => {
    const name = match[1]
    if (name === undefined) throw new Error(`${exportName} 列名解析失败`)
    return name
  })
  if (names.length === 0) throw new Error(`${exportName} 未解析到任何列`)
  return names
}

const readCore = (relative: string) => readFileSync(join(coreSrc, relative), "utf8")

const describeMismatch = (label: string, expected: Col[], actual: Col[]) => {
  const expectedByName = new Map(expected.map((column) => [column.name, column]))
  const actualByName = new Map(actual.map((column) => [column.name, column]))
  const problems: string[] = []
  for (const column of expected) {
    const found = actualByName.get(column.name)
    if (found === undefined) {
      problems.push(`缺失列 ${renderCol(column)}`)
      continue
    }
    if (found.type !== column.type || found.dflt !== column.dflt || found.notnull !== column.notnull)
      problems.push(`列 ${column.name} 不一致: 实际 ${renderCol(found)} / 期望 ${renderCol(column)}`)
  }
  for (const column of actual) {
    if (!expectedByName.has(column.name)) problems.push(`多出列 ${renderCol(column)}`)
  }
  return problems.length === 0 ? null : `${label} 与 novel-store 基准漂移:\n  ${problems.join("\n  ")}`
}

describe("全局库 novels 表结构一致性", () => {
  test("core 初始建表与 novel-store 定义完全相等", () => {
    const created = parseCreateTable(readCore("database/schema.gen.ts"), "novels")
    expect(describeMismatch("core schema.gen.ts novels CREATE", baseline, created)).toBeNull()
  })

  test("新增迁移补列集合恰为旧建表缺失的三列且定义一致", () => {
    const added = parseAddColumns(readCore("database/migration/20261010032350_global_novels_columns.ts"))
    const oldNames = new Set(
      parseCreateTable(readCore("database/migration/20260721152252_novel_writing_tables.ts"), "novels").map(
        (column) => column.name,
      ),
    )
    const expectedNames = new Set(baseline.map((column) => column.name).filter((name) => !oldNames.has(name)))
    const addedNames = new Set(added.map((column) => column.name))
    expect(addedNames).toEqual(expectedNames)
    expect(addedNames).toEqual(new Set(["master_outline", "story_spine", "content_nature"]))
    expect(describeMismatch("补列迁移", baseline.filter((column) => addedNames.has(column.name)), added)).toBeNull()
  })

  test("core session/sql.ts 的 drizzle 定义列集合为 novel-store 定义的子集", () => {
    const outsiders = parseDrizzleTable(readCore("session/sql.ts"), "NovelTable").filter(
      (name) => !baseline.some((column) => column.name === name),
    )
    expect(outsiders).toEqual([])
  })
})
