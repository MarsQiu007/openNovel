import { Database } from "bun:sqlite"

// 为 workrun-dock e2e 准备环境：建会话 + 播种 active 工作队列，打印 sessionID 供 spec 读取
const base = process.env.OPENNOVEL_TEST_SERVER ?? "http://127.0.0.1:4096"
const directory = process.env.OPENNOVEL_TEST_DIRECTORY ?? "D:\\AI\\Codes\\openNovel"
const dbPath = process.env.OPENNOVEL_TEST_DB
if (!dbPath) throw new Error("OPENNOVEL_TEST_DB is required")

const response = await fetch(`${base}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-opennovel-directory": directory },
  body: JSON.stringify({ agent: "build" }),
})
if (!response.ok) throw new Error(`session create failed: ${response.status}`)
const sessionID = ((await response.json()) as { data: { id: string } }).data.id

const db = new Database(dbPath)
const now = Date.now()
const runID = `wrun_e2e_${now}`

// 自由会话路由已下线：会话必须绑定书籍并经书籍工作台路由访问
const novelID = `novel_e2e_${now}`
db.run(
  `insert into novels (id, title, genre, synopsis, master_outline, created_at, updated_at, status, content_nature)
   values (?, '永夜之城', '玄幻', '', '', ?, ?, 'draft', 'general')`,
  [novelID, now, now],
)
db.run(`insert into session_novel (id, session_id, novel_id, created_at) values (?, ?, ?, ?)`, [
  `bind_${now}`,
  sessionID,
  novelID,
  now,
])

db.run(
  `insert into work_run (id, session_id, goal, status, progress_note, continuation_count, no_progress_count, time_created, time_updated)
   values (?, ?, ?, 'active', ?, 0, 0, ?, ?)`,
  [runID, sessionID, "逐章审查《永夜之城》第一卷，输出批注与修订建议", "已完成 2/5 章；第 3 章发现视角漂移问题待确认", now, now],
)

const items: Array<[number, string, string, string | null]> = [
  [0, "第 1 章《初雪》审查", "done", null],
  [1, "第 2 章《暗巷》审查", "done", null],
  [2, "第 3 章《回声》审查", "in_progress", "视角漂移：第 3 段起从林晚切到沈默未标记"],
  [3, "第 4 章《裂痕》审查", "pending", null],
  [4, "汇总批注并生成修订建议", "pending", null],
]
for (const [seq, title, status, note] of items) {
  db.run(
    `insert into work_run_item (id, run_id, seq, title, status, note, time_created, time_updated)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`${runID}_item_${seq}`, runID, seq, title, status, note, now, now],
  )
}
db.close()

console.log(JSON.stringify({ sessionID, novelID }))
