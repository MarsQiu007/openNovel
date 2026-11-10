/**
 * 任务 5.6 真实隔离端到端验收：真实临时 Location（OS 临时根 + 合成夹具 DB）下
 * 跑通确认 → 多次隔离复测 → 确定性核验 → 批次汇总全链，并对原书项目做前后摘要
 * 比对、检查模型请求与工具轨迹不含未授权正文或真实外部副作用、验证临时 Location
 * 配置仅含临时文件且祖先链无 opennovel 配置并入；另覆盖隔离建立失败「未验证」
 * 与关闭开关真实中断活动复测。宿主侧授权校验与 deny-first 物化由 core 真栈测试
 * （session-retest.test.ts）覆盖，本文件的 session 边界按 core 契约回放。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { dirname, join, relative } from "path"
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { FIXTURE_UPDATED_TITLE } from "../../src/tool-insight/case-adapter.js"
import { ChapterTable, NovelTable, closeDb, getDb } from "../../src/novel-writer/session-store.js"
import { loadRunRecords, summarizeRuns } from "../../src/tool-insight/retest-records.js"
import type { BackgroundSessionHandle, BackgroundSessionInput, BackgroundSessionResult, SessionDomain } from "../../src/v2/effect/session.js"
import {
  FACTS,
  FP,
  applyFixtureUpdate,
  cleanup,
  fixture,
  makeConfirm,
  makeRetest,
  pathsFor,
  seedIssue,
  tempRootFor,
} from "./retest-helpers.js"

// ─── 原书项目（与合成夹具完全无关的真数据） ───

const ORIGINAL_NOVEL_ID = "novel-original-9001"
const ORIGINAL_CHAPTER_ID = "chapter-original-4471"
const ORIGINAL_CHAPTER_TITLE = "原书孤本章节-赤水寒潭"
const ORIGINAL_CHAPTER_CONTENT = "原书独有正文：赤水寒潭的夜航船载着不为人知的货物，只在无月之夜离岸。"
const ORIGINAL_OUTLINE = "原书独有大纲：赤水寒潭卷共三十六章，按夜航、暗仓、对账三线推进。"

/** 在原书项目里写入真实书籍 DB 与项目文件（普通写作数据，非夹具） */
function seedOriginalProject(projectDir: string) {
  const db = getDb(projectDir)
  const now = Date.now()
  db.insert(NovelTable)
    .values({ id: ORIGINAL_NOVEL_ID, title: "原书真迹", genre: "悬疑", synopsis: "端到端验收用原书项目，不属于合成夹具。", status: "draft", created_at: now, updated_at: now })
    .run()
  db.insert(ChapterTable)
    .values({ id: ORIGINAL_CHAPTER_ID, novel_id: ORIGINAL_NOVEL_ID, title: ORIGINAL_CHAPTER_TITLE, content: ORIGINAL_CHAPTER_CONTENT, word_count: ORIGINAL_CHAPTER_CONTENT.length, status: "draft", order: 1, created_at: now, updated_at: now })
    .run()
  writeFileSync(join(projectDir, "大纲.md"), ORIGINAL_OUTLINE)
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

/** 原书项目前后摘要：文件相对路径 + 内容 sha256 的规范化拼接（数据库与文件一并覆盖） */
function projectDigest(directory: string): string {
  const hash = createHash("sha256")
  for (const file of walkFiles(directory).sort()) {
    hash.update(relative(directory, file).replaceAll("\\", "/"))
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
  }
  return hash.digest("hex")
}

/** 临时根祖先链（含根）不得有任何 opennovel 配置文件，否则配置发现会并入上级配置 */
function assertAncestorsClean(startDir: string) {
  let current = startDir
  for (let depth = 0; depth < 32; depth++) {
    for (const name of ["opennovel.json", "opennovel.jsonc"]) {
      expect(existsSync(join(current, name)), `祖先链 ${current} 不应包含 ${name}`).toBe(false)
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

describe("隔离复测端到端验收（任务 5.6）", () => {
  test("确认后多次复测全链：原书前后不变、请求与轨迹无未授权正文、祖先链无配置并入", async () => {
    const dirs = fixture("e2e")
    try {
      seedOriginalProject(dirs.projectDir)
      const digestBefore = projectDigest(dirs.projectDir)
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls: confirmCalls, confirm } = makeConfirm()

      // 工具轨迹与隔离探针：只调白名单工具、只引用合成 ID；原书数据在临时项目不可达
      const trajectory: Array<{ name: string; args: Record<string, unknown> }> = []
      let originalReadHits = 0
      let inflightError: unknown
      const { session, inputs } = fakeSessionWith(async (input) => {
        try {
          trajectory.push({ name: "update_chapter", args: { chapter_id: "case-ch-0001", title: FIXTURE_UPDATED_TITLE } })
          // 尝试读取原书章节：临时项目只含合成夹具，原书数据不可达
          const hits = getDb(input.directory)
            .select({ id: ChapterTable.id })
            .from(ChapterTable)
            .where(eq(ChapterTable.id, ORIGINAL_CHAPTER_ID))
            .all()
          originalReadHits += hits.length
          // 临时项目恰好一本合成书籍，无原书数据并入
          const novels = getDb(input.directory).select({ id: NovelTable.id }).from(NovelTable).all()
          expect(novels.map((novel) => novel.id)).toEqual(["case-novel-0001"])
          // 复测会话不继承原书位置：目录在 OS 临时根下、不在原书项目内
          expect(input.directory.startsWith(tempRootFor(dirs.projectDir))).toBe(true)
          expect(input.directory.startsWith(dirs.projectDir)).toBe(false)
          // 模型请求不含未授权正文：prompt 只引用合成夹具，无原书内容与原项目路径
          expect(input.prompt).toContain("update_chapter")
          expect(input.prompt).toContain(`chapter_id="case-ch-0001"`)
          expect(input.prompt).toContain(FIXTURE_UPDATED_TITLE)
          for (const secret of [ORIGINAL_CHAPTER_TITLE, ORIGINAL_CHAPTER_CONTENT, ORIGINAL_OUTLINE, ORIGINAL_NOVEL_ID, ORIGINAL_CHAPTER_ID, dirs.projectDir]) {
            expect(input.prompt).not.toContain(secret)
          }
          // 外部副作用拒绝面：专用 agent 声明与白名单精确约束（运行时由 core 物化预检强制）
          expect(input.retestAgent?.system).toContain("不得读取或引用任何原书数据")
          expect(input.retestAgent?.system).toContain("不得调用白名单之外的任何能力")
          expect(input.retestAgent?.system).toContain("不得产生任何真实外部副作用")
          expect(input.expectedTools).toEqual(["update_chapter"])
          expect(input.requiredPlugins).toEqual(["config-plugin", "novel-writer"])
          expect(input.model).toEqual({ providerID: "test", modelID: "test-model" })
          expect(input.originSessionID).toBe("ses_origin")
          expect(input.authorization).toEqual({ id: "auth_retest_1", caseDigest: confirmCalls[0]?.caseDigest })
          expect(existsSync(join(input.directory, ".novel"))).toBe(true)
          expect(readFileSync(join(input.directory, "opennovel.json"), "utf-8")).toBe(
            JSON.stringify({ plugins: ["@opennovel-ai/plugin/novel-writer-v2"] }, null, 2),
          )
        } catch (error) {
          inflightError = error
        }
        applyFixtureUpdate(input.directory)
        return { status: "success", text: "复测完成" }
      })
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session })

      const outcome = await retest.runRetest({ fingerprint: FP, runs: 3, fixVersion: "0.6.0", confirm, sessionID: "ses_origin" })
      if (inflightError !== undefined) throw inflightError
      expect(outcome.message).toContain("请求 3 次，实际执行 3 次")
      expect(outcome.message).toContain("多次复测通过")

      expect(inputs).toHaveLength(3)
      expect(new Set(inputs.map((input) => input.directory)).size).toBe(3)
      expect(trajectory).toHaveLength(3)
      expect(new Set(trajectory.map((call) => call.name))).toEqual(new Set(["update_chapter"]))
      expect(originalReadHits).toBe(0)

      const records = loadRunRecords(paths, FP)
      expect(records.map((record) => record.status)).toEqual(["started", "passed", "started", "passed", "started", "passed"])
      const summary = summarizeRuns(records, confirmCalls[0]?.caseDigest ?? "")
      expect(summary.verdict).toBe("passed")
      expect(summary.autoPassed).toBe(3)

      // 原书数据库与文件前后摘要一致
      expect(projectDigest(dirs.projectDir)).toBe(digestBefore)
      // 每次运行的临时目录已清理，祖先链无 opennovel 配置并入
      const root = tempRootFor(dirs.projectDir)
      expect(readdirSync(root)).toHaveLength(0)
      assertAncestorsClean(root)
      // 确认一次授权整批
      expect(confirmCalls).toHaveLength(1)
    } finally {
      closeDb(dirs.projectDir)
      cleanup(dirs)
    }
  })

  test("隔离建立失败：按预检失败落盘「未验证」并停止批次，不动用户占位文件", async () => {
    const dirs = fixture("e2e-iso-fail")
    let placeholder: string | undefined
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls: confirmCalls, confirm } = makeConfirm()
      const { session, inputs } = fakeSessionWith(async () => {
        throw new Error("隔离建立失败时不应发车")
      })
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session })

      // 占位文件与编排层临时根同路径：隔离目录建立必然失败
      placeholder = tempRootFor(dirs.projectDir)
      mkdirSync(dirname(placeholder), { recursive: true })
      writeFileSync(placeholder, "not a directory")

      const outcome = await retest.runRetest({ fingerprint: FP, runs: 2, fixVersion: "0.6.1", confirm, sessionID: "ses_origin" })
      expect(outcome.message).toContain("隔离目录建立失败")
      expect(outcome.message).toContain("实际执行 0 次，未执行 2 次")
      expect(outcome.message).toContain("结果未验证")
      expect(inputs).toHaveLength(0)

      const records = loadRunRecords(paths, FP)
      expect(records.map((record) => record.status)).toEqual(["started", "preflight_failed"])
      expect(records[1]?.verified).toBe("unverified")
      const summary = summarizeRuns(records, confirmCalls[0]?.caseDigest ?? "")
      expect(summary.verdict).toBe("none")
      // 未执行总数（2）是批次口径，落在 outcome 消息；落盘记录只有 1 条预检失败
      expect(summary.notExecuted).toBe(1)
      // 编排层不得删除不属于自己的用户文件
      expect(readFileSync(placeholder, "utf-8")).toBe("not a directory")
    } finally {
      if (placeholder !== undefined) {
        try {
          rmSync(placeholder, { force: true })
        } catch {}
      }
      cleanup(dirs)
    }
  })

  test("关闭开关真实中断活动复测：活动运行取消落盘、剩余不发车、关闭后请求被拒", async () => {
    const dirs = fixture("e2e-switch-off")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls: confirmCalls, confirm } = makeConfirm()

      // 可控后台会话：done 挂起直到外部中断；cancel 等价宿主作用域 finalizer 的
      // 真实中断入口（core 侧 §2.3 已覆盖 interrupt 链路）
      const inputs: BackgroundSessionInput[] = []
      let settle: ((result: BackgroundSessionResult) => void) | undefined
      let latestHandle: BackgroundSessionHandle | undefined
      let signalDispatch: () => void = () => {}
      const dispatched = new Promise<void>((resolve) => {
        signalDispatch = resolve
      })
      const session: Pick<SessionDomain, "startBackground"> = {
        startBackground: async (input) => {
          inputs.push(input)
          const done = new Promise<BackgroundSessionResult>((resolve) => {
            settle = resolve
          })
          const handle: BackgroundSessionHandle = {
            id: `ses_bg_${inputs.length}`,
            done,
            cancel: async () => settle?.({ status: "cancelled" }),
          }
          latestHandle = handle
          signalDispatch()
          return handle
        },
      }
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session })

      const batch = retest.runRetest({ fingerprint: FP, runs: 3, fixVersion: "0.6.2", confirm, sessionID: "ses_origin" })
      await dispatched
      // 用户关闭开关（真实写回全局配置）→ 宿主取消插件活动后台会话
      writeFileSync(join(dirs.configDir, "opennovel.json"), JSON.stringify({ toolInsight: { enabled: false, directory: dirs.logRoot } }))
      await latestHandle?.cancel()
      const outcome = await batch

      expect(outcome.message).toContain("实际执行 0 次，未执行 3 次")
      expect(outcome.message).toContain("复测会话被取消")
      expect(inputs).toHaveLength(1)

      const records = loadRunRecords(paths, FP)
      expect(records.map((record) => record.status)).toEqual(["started", "cancelled"])
      expect(records[1]?.verified).toBe("unverified")
      // 落盘记录只有被取消的 1 条；未发车的 2 次是批次口径（outcome 消息已断言）
      expect(summarizeRuns(records, confirmCalls[0]?.caseDigest ?? "").notExecuted).toBe(1)
      // 被取消运行的临时目录已清理
      expect(readdirSync(tempRootFor(dirs.projectDir))).toHaveLength(0)

      // 关闭后再次请求：开关已关，不确认、不发车
      const after = await retest.runRetest({ fingerprint: FP, runs: 1, fixVersion: "0.6.2", confirm, sessionID: "ses_origin" })
      expect(after.message).toContain("工具改进日志未启用")
      expect(inputs).toHaveLength(1)
      expect(confirmCalls).toHaveLength(1)
    } finally {
      cleanup(dirs)
    }
  })
})

// 局部辅助：带 cancel 控制的会话假体（helpers 的 fakeSession 无法从外部中断）
function fakeSessionWith(behavior: (input: BackgroundSessionInput, index: number) => Promise<BackgroundSessionResult>) {
  const inputs: BackgroundSessionInput[] = []
  const session: Pick<SessionDomain, "startBackground"> = {
    startBackground: async (input) => {
      const index = inputs.length
      inputs.push(input)
      const handle: BackgroundSessionHandle = { id: `ses_bg_${index}`, done: behavior(input, index), cancel: async () => {} }
      return handle
    },
  }
  return { session, inputs }
}
