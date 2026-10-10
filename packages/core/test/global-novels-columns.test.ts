import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opennovel-ai/effect-drizzle-sqlite"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { DatabaseMigration } from "@opennovel-ai/core/database/migration"
import { migrations } from "@opennovel-ai/core/database/migration.gen"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

// 旧版全局库 novels 结构（20260721152252 迁移产出，无本提案三列）
const LEGACY_NOVELS = sql`
  CREATE TABLE \`novels\` (
    \`id\` text PRIMARY KEY,
    \`title\` text NOT NULL,
    \`genre\` text NOT NULL,
    \`synopsis\` text DEFAULT '' NOT NULL,
    \`created_at\` integer NOT NULL,
    \`updated_at\` integer NOT NULL,
    \`status\` text DEFAULT 'draft' NOT NULL
  )
`

const NEW_MIGRATION_ID = "20261010032350_global_novels_columns"

type ColumnInfo = { name: string; type: string; dflt: string | null; notnull: number }

// PRAGMA 原样返回建表文本（type 大小写、默认值引号），统一归一化后再断言
const normalize = (row: { name: string; type: string; dflt_value: string | null; notnull: number }): ColumnInfo => ({
  name: row.name,
  type: row.type.toLowerCase(),
  dflt: row.dflt_value === null ? null : /^'(.*)'$/.exec(row.dflt_value)?.[1] ?? row.dflt_value,
  notnull: row.notnull,
})

const columnInfo = (db: EffectDrizzleSqlite.EffectSQLiteDatabase) =>
  db
    .all<{ name: string; type: string; dflt_value: string | null; notnull: number }>(
      sql`SELECT name, type, dflt_value, "notnull" FROM pragma_table_info('novels')`,
    )
    .pipe(Effect.map((rows) => rows.map(normalize)))

// 建一颗只完成了历史迁移（不含本提案新迁移）的存量全局库
const seedLegacyGlobalDb = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
  yield* db.run(LEGACY_NOVELS)
  yield* db.run(sql`CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
  yield* Effect.forEach(
    migrations.filter((migration) => migration.id !== NEW_MIGRATION_ID),
    (migration) => db.run(sql`INSERT INTO migration (id, time_completed) VALUES (${migration.id}, 1)`),
  )
  yield* db.run(
    sql`INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, status) VALUES ('n1', '书一', '科幻', '', 1, 1, 'draft')`,
  )
  return db
})

describe("全局库 novels 表补列迁移", () => {
  test("存量库补齐三列且默认值正确", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* seedLegacyGlobalDb

        yield* DatabaseMigration.applyOnly(db, migrations)

        const byName = new Map((yield* columnInfo(db)).map((column) => [column.name, column]))
        expect(byName.get("master_outline")).toEqual({ name: "master_outline", type: "text", dflt: "", notnull: 1 })
        expect(byName.get("story_spine")).toEqual({ name: "story_spine", type: "text", dflt: null, notnull: 0 })
        expect(byName.get("content_nature")).toEqual({ name: "content_nature", type: "text", dflt: "general", notnull: 1 })
        // 存量行被补默认值，可空列保持 NULL
        const row = yield* db.get(sql`SELECT master_outline, story_spine, content_nature FROM novels WHERE id = 'n1'`)
        expect(row).toEqual({ master_outline: "", story_spine: null, content_nature: "general" })
        // 新写入行不带三列也能落库（走列默认值）
        yield* db.run(sql`INSERT INTO novels (id, title, genre, created_at, updated_at) VALUES ('n2', '书二', '奇幻', 2, 2)`)
        const inserted = yield* db.get(sql`SELECT master_outline, story_spine, content_nature FROM novels WHERE id = 'n2'`)
        expect(inserted).toEqual({ master_outline: "", story_spine: null, content_nature: "general" })
      }),
    )
  })

  test("迁移重复执行幂等：第二次不再改动列与数据", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* seedLegacyGlobalDb

        yield* DatabaseMigration.applyOnly(db, migrations)
        yield* DatabaseMigration.applyOnly(db, migrations)

        const record = yield* db.get(
          sql`SELECT count(*) as count FROM migration WHERE id = ${NEW_MIGRATION_ID}`,
        )
        expect(record).toEqual({ count: 1 })
        expect((yield* columnInfo(db)).length).toBe(10)
        const row = yield* db.get(sql`SELECT master_outline, story_spine, content_nature FROM novels WHERE id = 'n1'`)
        expect(row).toEqual({ master_outline: "", story_spine: null, content_nature: "general" })
      }),
    )
  })

  test("全新空库初始建表即含三列", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb

        yield* DatabaseMigration.apply(db)

        const byName = new Map((yield* columnInfo(db)).map((column) => [column.name, column]))
        expect(byName.get("master_outline")).toEqual({ name: "master_outline", type: "text", dflt: "", notnull: 1 })
        expect(byName.get("story_spine")).toEqual({ name: "story_spine", type: "text", dflt: null, notnull: 0 })
        expect(byName.get("content_nature")).toEqual({ name: "content_nature", type: "text", dflt: "general", notnull: 1 })
        const record = yield* db.get(sql`SELECT count(*) as count FROM migration`)
        expect(record).toEqual({ count: migrations.length })
      }),
    )
  })
})
