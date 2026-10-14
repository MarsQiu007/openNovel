/**
 * exercise 重置管线。
 *
 * 共享库同时被 core 层、novel-store 连接缓存、同步 worker 与模块级 AppRuntime 持有。
 * 模块级 AppRuntime（ManagedRuntime 单例）首次构建后即永久持有数据库连接：删除文件在
 * Windows 上必然 EBUSY，且在 Linux 上也会让各连接停留在不同代的 inode 上（原始抖动根因）。
 * 这里先静默可静默的持有者，再原地清空全部表（不删文件），让所有持有者始终看到同一文件的
 * 同一代 schema，随后按 core 先行顺序确定性重建并断言。
 *
 * 详见 openspec/changes/httpapi-exercise-flake。
 */
const SESSION_GUARD_MESSAGE = "Database is not empty and has no session table"
const REQUIRED_TABLES = ["session", "tension_log", "annotations", "annotation_rounds", "world_maps"]
const REQUIRED_COLUMNS = [
  ["chapters", "outline"],
  ["characters", "status"],
  ["volumes", "outline"],
] as const

export async function resetExerciseDatabase() {
  await quiesceExerciseDatabase()
  try {
    await rebuildExerciseDatabase()
  } catch (error) {
    // 已停止 worker 的在途一轮仍可能在清空后先建库（无 session 表），触发守卫语义；
    // 驱逐可能残留的连接后重试一次，其余错误原样抛出。
    if (!String(error).includes(SESSION_GUARD_MESSAGE)) throw error
    const { closeDb } = await import("@opennovel-ai/novel-store")
    closeDb(null)
    await rebuildExerciseDatabase()
  }
}

export async function assertExerciseSchemaReady() {
  const { getDb } = await import("@opennovel-ai/novel-store")
  const db = getDb(null)
  const tables = new Set(
    (
      db.all(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map((name) => `'${name}'`).join(", ")})`,
      ) as Array<{ name: string }>
    ).map((row) => row.name),
  )
  const missing = [
    ...REQUIRED_TABLES.filter((name) => !tables.has(name)),
    ...REQUIRED_COLUMNS.flatMap(([table, column]) =>
      (db.all(`PRAGMA table_info(${table})`) as Array<{ name: string }>).some((row) => row.name === column)
        ? []
        : [`${table}.${column}`],
    ),
  ]
  if (missing.length > 0) throw new Error(`exercise database schema incomplete: missing ${missing.join(", ")}`)
}

async function quiesceExerciseDatabase() {
  const { stopSyncWorker } = await import("../../../src/novel/manual-edit-sync-worker")
  const { closeDb } = await import("@opennovel-ai/novel-store")
  const { disposeApps } = await import("./backend")
  stopSyncWorker()
  await disposeApps()
  closeDb(null)
}

async function rebuildExerciseDatabase() {
  const { disposeAllInstances } = await import("../../fixture/fixture")
  await clearExerciseDatabase()
  // disposeAllInstances 经模块级 AppRuntime 触达 core 层：首次构建会打开库文件并跑迁移，
  // 必须发生在清空之后，确保它在空库上完成全量重建，而不是撞上 NS 先建库的坏形态（否则守卫 die）
  await disposeAllInstances()
  await warmExerciseDatabase()
  await assertExerciseSchemaReady()
}

/**
 * 原地清空共享库的全部用户表与视图（不删文件）。
 *
 * 删除文件在 Windows 上会因模块级 AppRuntime 持有的连接而 EBUSY，且会造成跨代 inode；
 * 清空后库为空（无 `sqlite_%` 之外的任何表），core 守卫放行全量重建，语义等价于新库。
 */
export async function clearExerciseDatabase() {
  const { Database } = await import("bun:sqlite")
  const sqlite = new Database(await exerciseDbPath())
  try {
    sqlite.exec("PRAGMA foreign_keys = OFF")
    sqlite.exec("PRAGMA busy_timeout = 5000")
    const objects = sqlite
      .query("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string; type: string }>
    for (const object of objects) {
      sqlite.exec(`DROP ${object.type === "view" ? "VIEW" : "TABLE"} IF EXISTS "${object.name}"`)
    }
    // 清空后截断 WAL，避免跨次运行累积（忙时静默跳过，不影响正确性）
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    sqlite.close()
  }
}

/** exercise 共享库路径（core 侧解析：Flag.OPENNOVEL_DB 覆盖与渠道分流）。 */
async function exerciseDbPath() {
  const { Database } = await import("@opennovel-ai/core/database/database")
  return Database.path()
}

async function warmExerciseDatabase() {
  const { Effect, Layer } = await import("effect")
  const { Database } = await import("@opennovel-ai/core/database/database")
  const { getDb } = await import("@opennovel-ai/novel-store")
  // core 先行：不携带 memoMap 的全新构建，确保在清空后的库上重跑迁移（旧连接复用会跳过）
  await Effect.runPromise(Effect.scoped(Layer.build(Database.layerFromPath(Database.path()))))
  // novel-store 补齐剩余建表/补列，并把完成后的连接写入缓存供后续场景复用
  getDb(null)
}
