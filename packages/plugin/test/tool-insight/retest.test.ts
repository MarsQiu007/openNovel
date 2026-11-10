/**
 * 隔离复测编排引擎测试（任务 5.2/5.3/5.4）。
 *
 * 覆盖 prepare_retest 的案例文档预览与无适配器转人工；run_retest 的参数校验、
 * 无模型失败关闭、未确认不执行（无运行记录/临时目录/发车）；确认后隔离执行：
 * startBackground 输入形状（mode/agent/白名单/requiredPlugins/临时目录隔离结构/
 * 合成夹具 seed/授权与摘要绑定）、真实结果核验（改夹具 DB 模拟 agent 行为）、
 * 核验失败继续后续运行与 unstable 判定、取消停止批次并显式计数未执行、宿主授权
 * 失败分类落盘（authorization_invalid/preflight_failed）、record_manual_result
 * 留痕不计自动通过、reconcileRunsOnce 崩溃对账每实例至多一次。
 * 锁用进程内 fake，落盘与夹具 DB 用真实临时目录。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { toolInsightCasePath } from "@opennovel-ai/novel-store"
import { issueFingerprint } from "../../src/tool-insight/issue-doc.js"
import { appendRunStarted, loadRunRecords, summarizeRuns } from "../../src/tool-insight/retest-records.js"
import {
  FACTS,
  FP,
  applyFixtureUpdate,
  cleanup,
  fakeSession,
  file,
  fixture,
  fixtureChapters,
  makeConfirm,
  makeRetest,
  pathsFor,
  seedIssue,
  tempRootFor,
} from "./retest-helpers.js"

describe("prepare_retest：案例文档预览", () => {
  test("写案例文档，不建临时目录、不写运行记录、不发车", async () => {
    const dirs = fixture("prepare")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session: { startBackground: async () => { throw new Error("不应发车") } } })

      const outcome = await retest.prepareRetest({ fingerprint: FP })
      expect(outcome.message).toContain("已生成复测案例")
      expect(outcome.message).toContain("update_chapter")
      expect(existsSync(toolInsightCasePath(paths, FP))).toBe(true)
      expect(existsSync(tempRootFor(dirs.projectDir))).toBe(false)
      expect(loadRunRecords(paths, FP)).toHaveLength(0)
    } finally {
      cleanup(dirs)
    }
  })

  test("无适配器工具转人工验证，不写案例文档", async () => {
    const dirs = fixture("prepare-no-adapter")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      const fp = issueFingerprint({ tool: "export_novel", scenario: "recovery_failed", errorCategory: "IOError" })
      await seedIssue(paths, fp, { tool: "export_novel", scenario: "recovery_failed", errorCategory: "IOError" })
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session: { startBackground: async () => { throw new Error("不应发车") } } })

      const outcome = await retest.prepareRetest({ fingerprint: fp })
      expect(outcome.message).toContain("转人工验证")
      expect(outcome.message).toContain("record_manual_result")
      expect(existsSync(toolInsightCasePath(paths, fp))).toBe(false)
    } finally {
      cleanup(dirs)
    }
  })
})

describe("run_retest：确认前的失败关闭", () => {
  test("参数校验：非法次数与非空版本要求，零副作用", async () => {
    const dirs = fixture("validate")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls, confirm } = makeConfirm()
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session: { startBackground: async () => { throw new Error("不应发车") } } })

      for (const runs of [0, 25, 1.5, undefined]) {
        const outcome = await retest.runRetest({ fingerprint: FP, runs, fixVersion: "0.1.24", confirm, sessionID: "ses_origin" })
        expect(outcome.message).toContain("1–20 的整数")
      }
      const emptyVersion = await retest.runRetest({ fingerprint: FP, runs: 2, fixVersion: "  ", confirm, sessionID: "ses_origin" })
      expect(emptyVersion.message).toContain("修复版本不能为空")

      expect(calls).toHaveLength(0)
      expect(loadRunRecords(paths, FP)).toHaveLength(0)
      expect(existsSync(tempRootFor(dirs.projectDir))).toBe(false)
    } finally {
      cleanup(dirs)
    }
  })

  test("无已配置模型：失败关闭，不确认不建案例", async () => {
    const dirs = fixture("no-model")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls, confirm } = makeConfirm()
      const retest = makeRetest({
        configDir: dirs.configDir,
        projectDir: dirs.projectDir,
        session: { startBackground: async () => { throw new Error("不应发车") } },
        defaultModel: async () => undefined,
      })

      const outcome = await retest.runRetest({ fingerprint: FP, runs: 2, fixVersion: "0.1.24", confirm, sessionID: "ses_origin" })
      expect(outcome.message).toContain("无已配置模型")
      const prepared = await retest.prepareRetest({ fingerprint: FP })
      expect(prepared.message).toContain("无已配置模型")

      expect(calls).toHaveLength(0)
      expect(loadRunRecords(paths, FP)).toHaveLength(0)
    } finally {
      cleanup(dirs)
    }
  })

  test("用户未确认：案例预览已写，但无运行记录、无临时目录、未发车", async () => {
    const dirs = fixture("unconfirmed")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls, confirm } = makeConfirm(() => undefined)
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session: { startBackground: async () => { throw new Error("不应发车") } } })

      const outcome = await retest.runRetest({ fingerprint: FP, runs: 2, fixVersion: "0.1.27", confirm, sessionID: "ses_origin" })
      expect(outcome.message).toContain("用户未确认执行")

      expect(calls).toHaveLength(1)
      const asked = calls[0]!
      expect(asked.question).toContain("update_chapter")
      expect(asked.runs).toBe(2)
      expect(asked.fixVersion).toBe("0.1.27")
      expect(asked.caseDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(asked.model).toEqual({ providerID: "test", modelID: "test-model" })
      expect(asked.expectedTools).toEqual(["update_chapter"])

      expect(existsSync(toolInsightCasePath(paths, FP))).toBe(true)
      expect(loadRunRecords(paths, FP)).toHaveLength(0)
      expect(existsSync(tempRootFor(dirs.projectDir))).toBe(false)
    } finally {
      cleanup(dirs)
    }
  })
})

describe("run_retest：确认后的隔离执行", () => {
  test("单次运行成功：发车输入形状、隔离项目结构、夹具 seed、真实核验通过", async () => {
    const dirs = fixture("single-run")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls: confirmCalls, confirm } = makeConfirm()
      let inflightError: unknown
      const { session, inputs } = fakeSession(async (input) => {
        try {
          expect(input.mode).toBe("retest")
          expect(input.agent).toBe("insight-retester")
          expect(input.expectedTools).toEqual(["update_chapter"])
          expect(input.requiredPlugins).toEqual(["config-plugin", "novel-writer"])
          expect(input.model).toEqual({ providerID: "test", modelID: "test-model" })
          expect(input.originSessionID).toBe("ses_origin")
          expect(input.authorization).toEqual({ id: "auth_retest_1", caseDigest: confirmCalls[0]?.caseDigest })
          expect(input.retestAgent?.id).toBe("insight-retester")
          expect(input.directory.startsWith(tempRootFor(dirs.projectDir))).toBe(true)
          expect(input.directory.split(/[\\/]/).at(-1)?.startsWith("run-")).toBe(true)
          expect(existsSync(join(input.directory, ".novel"))).toBe(true)
          expect(JSON.parse(readFileSync(join(input.directory, "opennovel.json"), "utf-8"))).toEqual({
            plugins: ["@opennovel-ai/plugin/novel-writer-v2"],
          })
          expect(fixtureChapters(input.directory)).toEqual([{ id: "case-ch-0001", title: "渡口" }])
        } catch (error) {
          inflightError = error
        }
        applyFixtureUpdate(input.directory)
        return { status: "success", text: "复测完成" }
      })
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session })

      const outcome = await retest.runRetest({ fingerprint: FP, runs: 1, fixVersion: "0.1.28", confirm, sessionID: "ses_origin" })
      if (inflightError !== undefined) throw inflightError
      expect(outcome.message).toContain("实际执行 1 次")
      expect(outcome.message).toContain("多次复测通过")

      const records = loadRunRecords(paths, FP)
      expect(records.map((record) => record.status)).toEqual(["started", "passed"])
      expect(records[1]?.verified).toBe("verified_success")
      expect(summarizeRuns(records, confirmCalls[0]?.caseDigest ?? "").verdict).toBe("passed")

      expect(inputs).toHaveLength(1)
      // 运行临时目录已在结果落盘后清理（根目录保留，run-* 已移除）
      const root = tempRootFor(dirs.projectDir)
      expect(existsSync(root)).toBe(true)
      expect(readdirSync(root)).toHaveLength(0)
    } finally {
      cleanup(dirs)
    }
  })

  test("核验失败继续后续运行：通过与失败并存判 unstable，每次运行唯一临时目录", async () => {
    const dirs = fixture("unstable")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls: confirmCalls, confirm } = makeConfirm()
      const { session, inputs } = fakeSession(async (input, index) => {
        // 第 1 次 agent 未完成更新 → 核验失败；第 2 次完成 → 通过
        if (index === 1) applyFixtureUpdate(input.directory)
        return { status: "success", text: "复测完成" }
      })
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session })

      const outcome = await retest.runRetest({ fingerprint: FP, runs: 2, fixVersion: "0.1.29", confirm, sessionID: "ses_origin" })
      expect(outcome.message).toContain("实际执行 2 次")
      expect(outcome.message).toContain("未稳定解决")
      expect(inputs).toHaveLength(2)
      expect(inputs[0]?.directory).not.toBe(inputs[1]?.directory)

      const records = loadRunRecords(paths, FP)
      expect(records.map((record) => record.status)).toEqual(["started", "failed", "started", "passed"])
      expect(records[1]?.verified).toBe("verified_failure")
      expect(summarizeRuns(records, confirmCalls[0]?.caseDigest ?? "").verdict).toBe("unstable")
      expect(readdirSync(tempRootFor(dirs.projectDir))).toHaveLength(0)
    } finally {
      cleanup(dirs)
    }
  })

  test("取消停止批次：剩余运行不发车，未执行次数显式记录", async () => {
    const dirs = fixture("cancelled")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const { calls: confirmCalls, confirm } = makeConfirm()
      const { session, inputs } = fakeSession(async () => ({ status: "cancelled" }))
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session })

      const outcome = await retest.runRetest({ fingerprint: FP, runs: 3, fixVersion: "0.1.30", confirm, sessionID: "ses_origin" })
      expect(outcome.message).toContain("实际执行 0 次，未执行 3 次")
      expect(outcome.message).toContain("中途停止：复测会话被取消")
      expect(inputs).toHaveLength(1)

      const records = loadRunRecords(paths, FP)
      expect(records.map((record) => record.status)).toEqual(["started", "cancelled"])
      expect(records[1]?.verified).toBe("unverified")
      expect(summarizeRuns(records, confirmCalls[0]?.caseDigest ?? "").notExecuted).toBe(1)
    } finally {
      cleanup(dirs)
    }
  })

  test("宿主失败分类落盘：授权失败与一般预检失败分别记录", async () => {
    const dirs = fixture("host-failure")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      const fpAuth = issueFingerprint({ ...FACTS, errorCategory: "AuthCase" })
      const fpPre = issueFingerprint({ ...FACTS, errorCategory: "PreCase" })
      await seedIssue(paths, fpAuth, FACTS)
      await seedIssue(paths, fpPre, FACTS)
      const { confirm } = makeConfirm()
      let thrown: Error | undefined
      const { session } = fakeSession(async () => {
        throw thrown ?? new Error("boom")
      })
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session })

      thrown = new Error("后台 retest 授权校验失败: 运行次数已用尽")
      const authOutcome = await retest.runRetest({ fingerprint: fpAuth, runs: 1, fixVersion: "0.1.31", confirm, sessionID: "ses_origin" })
      expect(authOutcome.message).toContain("宿主授权校验失败")
      const authRecords = loadRunRecords(paths, fpAuth)
      expect(authRecords.map((record) => record.status)).toEqual(["started", "authorization_invalid"])
      expect(authRecords[1]?.verified).toBe("unverified")

      thrown = new Error("后台会话 agent 不存在: insight-retester")
      const preOutcome = await retest.runRetest({ fingerprint: fpPre, runs: 1, fixVersion: "0.1.31", confirm, sessionID: "ses_origin" })
      expect(preOutcome.message).toContain("发车前预检失败，结果未验证")
      const preRecords = loadRunRecords(paths, fpPre)
      expect(preRecords.map((record) => record.status)).toEqual(["started", "preflight_failed"])
    } finally {
      cleanup(dirs)
    }
  })
})

describe("人工结果留痕与崩溃对账", () => {
  test("record_manual_result：留痕展示，不计自动通过", async () => {
    const dirs = fixture("manual")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      await seedIssue(paths, FP, FACTS)
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session: { startBackground: async () => { throw new Error("不应发车") } } })

      const rejected = await retest.recordManual({ fingerprint: FP, passed: true, fixVersion: "" })
      expect(rejected.message).toContain("人工结果需要非空修复版本")

      const outcome = await retest.recordManual({ fingerprint: FP, passed: true, fixVersion: "0.1.32", detail: "手动验证清单复核通过" })
      expect(outcome.message).toContain("人工结果已留痕")
      expect(outcome.message).toContain("不计入自动复测通过次数")

      const records = loadRunRecords(paths, FP)
      expect(records).toHaveLength(1)
      expect(records[0]?.manual).toBe(true)
      expect(records[0]?.status).toBe("passed")
      const summary = summarizeRuns(records, "")
      expect(summary.verdict).toBe("none")
      expect(summary.manualCount).toBe(1)
      expect(summary.autoPassed).toBe(0)
    } finally {
      cleanup(dirs)
    }
  })

  test("reconcileRunsOnce：无终态 started 标记 interrupted，每实例至多一次", async () => {
    const dirs = fixture("reconcile")
    try {
      const paths = pathsFor(dirs.logRoot, dirs.projectDir)
      const digest = "d".repeat(64)
      const started = await appendRunStarted(file, paths, {
        fingerprint: FP,
        case_digest: digest,
        model: { providerID: "test", modelID: "test-model" },
        fix_version: "0.1.0",
      })
      const retest = makeRetest({ configDir: dirs.configDir, projectDir: dirs.projectDir, session: { startBackground: async () => { throw new Error("不应发车") } } })

      await retest.reconcileRunsOnce()
      const records = loadRunRecords(paths, FP)
      expect(records.map((record) => record.status)).toEqual(["started", "interrupted"])
      const mark = records.find((record) => record.status === "interrupted")
      expect(mark?.target_run_id).toBe(started.runID)
      expect(summarizeRuns(records, digest).verdict).toBe("incomplete")

      // 再补一条孤儿 started：对账每实例至多一次，不重复标记
      await appendRunStarted(file, paths, {
        fingerprint: FP,
        case_digest: digest,
        model: { providerID: "test", modelID: "test-model" },
        fix_version: "0.1.0",
      })
      await retest.reconcileRunsOnce()
      expect(loadRunRecords(paths, FP).filter((record) => record.status === "interrupted")).toHaveLength(1)
    } finally {
      cleanup(dirs)
    }
  })
})
