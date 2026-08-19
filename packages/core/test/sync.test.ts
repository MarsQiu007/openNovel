import { afterAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, readdir, rm, stat } from "fs/promises"
import os from "os"
import path from "path"
import { Sync } from "../src/sync"

/**
 * 根目录整库同步的端到端测试：
 * 两个（后增至三个）临时根目录模拟多台机器，file:// 适配器模拟云盘远端。
 * 覆盖 上传/下载/谁新谁赢仲裁/同名异源三选/收养配对/删除传播/远端删除自愈。
 */

const root = await mkdtemp(path.join(os.tmpdir(), "opennovel-sync-test-"))
const remote = path.join(root, "remote")

// 内容时间戳：步长 2 分钟，远大于 60s 的平局阈值
const T0 = 1_700_000_000_000
const T1 = T0 + 120_000
const T2 = T1 + 120_000
const T3 = T2 + 240_000
const T4 = T3 + 240_000
const T5 = T4 + 120_000
const T6 = T5 + 120_000
const T7 = T6 + 120_000
const T8 = T7 + 120_000

interface Machine {
  configDir: string
  stateDir: string
  rootDir: string
}

function machine(name: string): Machine {
  return {
    configDir: path.join(root, `${name}-config`),
    stateDir: path.join(root, `${name}-state`),
    rootDir: path.join(root, `${name}-root`),
  }
}

const A = machine("a")
const B = machine("b")

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function deps(m: Machine): Sync.SyncDeps {
  return { configDir: m.configDir, stateDir: m.stateDir }
}

async function connect(m: Machine) {
  await mkdir(m.rootDir, { recursive: true })
  await Sync.saveConnection(
    { configDir: m.configDir, setPassword: async () => {} },
    { url: `file://${remote.replaceAll("\\", "/")}`, username: "tester", password: "" },
  )
  await Sync.setRootDir(deps(m), m.rootDir)
}

/** 直接写库模拟用户写作；updated_at 由调用方控制以测试时间仲裁 */
async function writeChapter(m: Machine, project: string, chapterTitle: string, updatedAt: number) {
  const file = path.join(m.rootDir, project, ".novel", "novel.db")
  await mkdir(path.dirname(file), { recursive: true })
  const db = new Database(file, { create: true })
  db.exec(
    `CREATE TABLE IF NOT EXISTS novels (id text PRIMARY KEY, title text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)`,
  )
  db.exec(
    `CREATE TABLE IF NOT EXISTS chapters (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, updated_at integer NOT NULL)`,
  )
  db.query(`INSERT OR IGNORE INTO novels (id, title, created_at, updated_at) VALUES ('n1', '星海边境', 1, ?)`).run(
    updatedAt,
  )
  db.query(`INSERT INTO chapters (id, novel_id, title, content, updated_at) VALUES (?, 'n1', ?, '', ?)`).run(
    `c-${chapterTitle}`,
    chapterTitle,
    updatedAt,
  )
  db.close()
}

function chapterTitles(m: Machine, project: string): string[] {
  const db = new Database(path.join(m.rootDir, project, ".novel", "novel.db"), { readonly: true })
  const rows = db.query(`SELECT title FROM chapters ORDER BY rowid`).all() as Array<{ title: string }>
  db.close()
  return rows.map((row) => row.title)
}

function states(status: Sync.LibraryStatus) {
  return status.projects.map((p) => [p.name, p.state])
}

describe("library sync", () => {
  test("机器 A 配置连接与根目录后，本地项目自动上传", async () => {
    await connect(A)
    await writeChapter(A, "xinghai", "第一章", T0)

    const before = await Sync.getStatus(deps(A))
    expect(before.rootDir).toBe(A.rootDir)
    expect(states(before)).toEqual([["xinghai", "new_local"]])

    const run = await Sync.syncAll(deps(A))
    expect(run.decisions).toEqual([])
    expect(run.results).toEqual([{ name: "xinghai", action: "uploaded" }])

    const after = await Sync.getStatus(deps(A))
    expect(states(after)).toEqual([["xinghai", "in_sync"]])
    expect(after.projects[0].novels).toEqual(["星海边境"])
  })

  test("无变更时一键同步为空跑", async () => {
    const run = await Sync.syncAll(deps(A))
    expect(run.results).toEqual([])
    expect(run.decisions).toEqual([])
  })

  test("机器 B 连接同一远端后自动下载，内容一致", async () => {
    await connect(B)
    expect(states(await Sync.getStatus(deps(B)))).toEqual([["xinghai", "new_remote"]])

    const run = await Sync.syncAll(deps(B))
    expect(run.results).toEqual([{ name: "xinghai", action: "downloaded" }])
    expect(chapterTitles(B, "xinghai")).toEqual(["第一章"])
    expect(states(await Sync.getStatus(deps(B)))).toEqual([["xinghai", "in_sync"]])
  })

  test("A 推新章节，B 检测 remote_ahead 并拉取", async () => {
    await writeChapter(A, "xinghai", "第二章", T1)
    expect(states(await Sync.getStatus(deps(A)))).toEqual([["xinghai", "local_ahead"]])
    await Sync.syncAll(deps(A))

    expect(states(await Sync.getStatus(deps(B)))).toEqual([["xinghai", "remote_ahead"]])
    await Sync.syncAll(deps(B))
    expect(chapterTitles(B, "xinghai")).toEqual(["第一章", "第二章"])
  })

  test("双向都改时谁新谁赢：本地较新则覆盖远端", async () => {
    await writeChapter(B, "xinghai", "第三章-B", T2) // B 先改（旧）
    await writeChapter(A, "xinghai", "第三章-A", T2 + 120_000) // A 后改（新）
    await Sync.syncAll(deps(B)) // B 单向推送
    const run = await Sync.syncAll(deps(A)) // A 与远端都变，A 更新 → 覆盖远端
    expect(run.decisions).toEqual([])
    expect(run.results).toEqual([{ name: "xinghai", action: "uploaded" }])

    await Sync.syncAll(deps(B)) // B 拉回 A 的内容，本地 B 版被覆盖前有备份
    expect(chapterTitles(B, "xinghai")).toEqual(["第一章", "第二章", "第三章-A"])
    const backups = await readdir(path.join(B.rootDir, "xinghai", ".novel", "backups"))
    expect(backups.filter((name) => name.endsWith(".db")).length).toBeGreaterThan(0)
  })

  test("双向都改时谁新谁赢：远端较新则覆盖本地", async () => {
    await writeChapter(B, "xinghai", "第四章-B", T3) // B 改（旧）
    await writeChapter(A, "xinghai", "第四章-A", T3 + 120_000) // A 改（新）并推送
    await Sync.syncAll(deps(A))
    const run = await Sync.syncAll(deps(B)) // B 与远端都变，远端更新 → 覆盖本地
    expect(run.decisions).toEqual([])
    expect(run.results).toEqual([{ name: "xinghai", action: "downloaded" }])
    expect(chapterTitles(B, "xinghai")).toEqual(["第一章", "第二章", "第三章-A", "第四章-A"])
  })

  test("双方改动时间过近时转人工决策，keep_local 后另一台机器正常拉取", async () => {
    await writeChapter(A, "xinghai", "第五章-A", T4)
    await writeChapter(B, "xinghai", "第五章-B", T4 + 5_000) // 5s < 60s 阈值
    await Sync.syncAll(deps(A)) // A 单向推送

    const run = await Sync.syncAll(deps(B))
    expect(run.results).toEqual([])
    expect(run.decisions).toEqual([
      { kind: "tie_conflict", name: "xinghai", localTime: T4 + 5_000, remoteTime: T4 },
    ])

    const resolved = await Sync.resolve(deps(B), { name: "xinghai", action: "keep_local" })
    expect(resolved.projects[0].state).toBe("in_sync")
    expect(chapterTitles(B, "xinghai")).toContain("第五章-B")

    // 同源冲突沿用配对身份，A 直接拉取而不是再次弹窗
    const runA = await Sync.syncAll(deps(A))
    expect(runA.decisions).toEqual([])
    expect(runA.results).toEqual([{ name: "xinghai", action: "downloaded" }])
    expect(chapterTitles(A, "xinghai")).toEqual(["第一章", "第二章", "第三章-A", "第四章-A", "第五章-B"])
  })

  test("同名异源项目转人工决策：keep_remote / keep_local / keep_both", async () => {
    await writeChapter(A, "alpha", "远端第一章", T5)
    await writeChapter(A, "beta", "远端第一章", T5)
    await writeChapter(A, "gamma", "远端第一章", T5)
    await Sync.syncAll(deps(A))

    // B 在未同步前创建了同名但内容不同的项目
    await writeChapter(B, "alpha", "本地第一章", T5)
    await writeChapter(B, "beta", "本地第一章", T5)
    await writeChapter(B, "gamma", "本地第一章", T5)

    const run = await Sync.syncAll(deps(B))
    expect(run.results).toEqual([])
    expect(run.decisions.map((d) => [d.kind, "name" in d ? d.name : ""])).toEqual([
      ["pair_conflict", "alpha"],
      ["pair_conflict", "beta"],
      ["pair_conflict", "gamma"],
    ])

    // keep_remote：本地被远端覆盖
    await Sync.resolve(deps(B), { name: "alpha", action: "keep_remote" })
    expect(chapterTitles(B, "alpha")).toEqual(["远端第一章"])

    // keep_local：本地占领远端
    await Sync.resolve(deps(B), { name: "beta", action: "keep_local" })
    expect(chapterTitles(B, "beta")).toEqual(["本地第一章"])

    // keep_both：远端内容落地为 gamma-2，本地保留原名并占领远端
    await Sync.resolve(deps(B), { name: "gamma", action: "keep_both" })
    expect(chapterTitles(B, "gamma")).toEqual(["本地第一章"])
    expect(chapterTitles(B, "gamma-2")).toEqual(["远端第一章"])

    // gamma-2 不登记，下一轮作为新项目上传
    const run2 = await Sync.syncAll(deps(B))
    expect(run2.decisions).toEqual([])
    expect(run2.results).toEqual([{ name: "gamma-2", action: "uploaded" }])
  })

  test("异源占领远端后，另一侧机器收到配对决策", async () => {
    const run = await Sync.syncAll(deps(A))
    expect(run.results).toEqual([{ name: "gamma-2", action: "downloaded" }])
    expect(run.decisions.map((d) => [d.kind, "name" in d ? d.name : ""])).toEqual([
      ["pair_conflict", "beta"],
      ["pair_conflict", "gamma"],
    ])

    // A 接受远端（B 的内容），双方达成一致
    await Sync.resolve(deps(A), { name: "beta", action: "keep_remote" })
    await Sync.resolve(deps(A), { name: "gamma", action: "keep_remote" })
    expect(chapterTitles(A, "beta")).toEqual(["本地第一章"])
    const run2 = await Sync.syncAll(deps(A))
    expect(run2.decisions).toEqual([])
    expect(run2.results).toEqual([])
  })

  test("同名同内容的未配对项目直接收养，之后正常走增量", async () => {
    const C = machine("c")
    await connect(C)
    // 手工复刻远端 xinghai 的当前内容（与 A/B 逐行一致）
    await writeChapter(C, "xinghai", "第一章", T0)
    await writeChapter(C, "xinghai", "第二章", T1)
    await writeChapter(C, "xinghai", "第三章-A", T2 + 120_000)
    await writeChapter(C, "xinghai", "第四章-A", T3 + 120_000)
    await writeChapter(C, "xinghai", "第五章-B", T4 + 5_000)

    const run = await Sync.syncAll(deps(C))
    expect(run.decisions).toEqual([])
    // xinghai 收养配对（无结果项），其余远端项目作为新项目下载
    expect(run.results).toEqual([
      { name: "alpha", action: "downloaded" },
      { name: "beta", action: "downloaded" },
      { name: "gamma", action: "downloaded" },
      { name: "gamma-2", action: "downloaded" },
    ])
    expect(states(await Sync.getStatus(deps(C)))).toContainEqual(["xinghai", "in_sync"])

    // 收养后正常走增量：远端变更 → 拉取而不是配对冲突
    await writeChapter(A, "xinghai", "第六章", T6)
    await Sync.syncAll(deps(A))
    const run2 = await Sync.syncAll(deps(C))
    expect(run2.decisions).toEqual([])
    expect(run2.results).toEqual([{ name: "xinghai", action: "downloaded" }])
    expect(chapterTitles(C, "xinghai")).toContain("第六章")

    // B 也拉齐，为下一步自愈测试做准备
    await Sync.syncAll(deps(B))
  })

  test("远端被应用外删除后，本地项目自动重新上传（自愈）", async () => {
    await rm(path.join(remote, "opennovel", "xinghai"), { recursive: true })
    const run = await Sync.syncAll(deps(A))
    expect(run.decisions).toEqual([])
    expect(run.results).toEqual([{ name: "xinghai", action: "uploaded" }])

    // B/C 内容与重传一致 → 收养新身份，不弹冲突
    for (const m of [B, machine("c")]) {
      const runM = await Sync.syncAll(deps(m))
      expect(runM.decisions).toEqual([])
      expect(runM.results).toEqual([])
    }
  })

  test("单个已配对项目的本地删除自动传播到远端", async () => {
    await writeChapter(B, "draft", "草稿第一章", T7)
    await Sync.syncAll(deps(B)) // 上传
    await rm(path.join(B.rootDir, "draft"), { recursive: true })

    const run = await Sync.syncAll(deps(B))
    expect(run.decisions).toEqual([])
    expect(run.results).toEqual([{ name: "draft", action: "deleted_remote" }])
    expect(await stat(path.join(remote, "opennovel", "draft")).catch(() => undefined)).toBeUndefined()
  })

  test("一次删除多个项目时转批量确认决策，确认后才执行", async () => {
    await writeChapter(B, "draft-a", "草稿", T8)
    await writeChapter(B, "draft-b", "草稿", T8)
    await Sync.syncAll(deps(B)) // 上传两个
    await rm(path.join(B.rootDir, "draft-a"), { recursive: true })
    await rm(path.join(B.rootDir, "draft-b"), { recursive: true })

    const run = await Sync.syncAll(deps(B))
    expect(run.results).toEqual([])
    expect(run.decisions).toEqual([{ kind: "delete_confirm", names: ["draft-a", "draft-b"] }])
    // 未确认前远端还在
    expect(await stat(path.join(remote, "opennovel", "draft-a")).catch(() => undefined)).toBeDefined()

    await Sync.resolve(deps(B), { action: "confirm_delete", names: ["draft-a", "draft-b"] })
    expect(await stat(path.join(remote, "opennovel", "draft-a")).catch(() => undefined)).toBeUndefined()
    expect(await stat(path.join(remote, "opennovel", "draft-b")).catch(() => undefined)).toBeUndefined()
  })

  test("最终收敛：所有机器一键同步后无决策且全部 in_sync", async () => {
    for (const m of [A, B, machine("c")]) {
      const run = await Sync.syncAll(deps(m))
      expect(run.decisions).toEqual([])
      expect(run.results).toEqual([])
      for (const p of (await Sync.getStatus(deps(m))).projects) expect(p.state).toBe("in_sync")
    }
    expect(chapterTitles(B, "xinghai")).toEqual(chapterTitles(A, "xinghai"))
    expect(chapterTitles(machine("c"), "xinghai")).toEqual(chapterTitles(A, "xinghai"))
  })
})
