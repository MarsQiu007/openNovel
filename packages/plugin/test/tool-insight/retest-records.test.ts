/**
 * 任务 5.5：复测运行记录、多次通过判定、崩溃对账与安全清理测试。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { toolInsightPaths } from "@opennovel-ai/novel-store"
import {
  appendManualRunResult,
  appendRunFinishedLocked,
  appendRunStarted,
  appendRunStartedLocked,
  loadRunRecords,
  reconcileRunRecords,
  runUnderRunLock,
  safeRemoveTempDir,
  summarizeRuns,
  type ToolInsightRunRecord,
} from "../../src/tool-insight/retest-records.js"

const fakeLocks = new Map<string, Promise<unknown>>()

const file = {
  // 与 core 宿主 fake 同款：进程内按键串行化，保持「同键互斥、跨键并行」语义
  withLock: (input: { key: string }, callback: () => Promise<unknown>) => {
    const chain = fakeLocks.get(input.key) ?? Promise.resolve()
    const run = chain.then(callback, callback)
    fakeLocks.set(
      input.key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  },
}

// 另一进程持有 run 锁的形态：对账侧拿锁超时
const busyFile = {
  withLock: () => Promise.reject(new Error("lock timed out")),
}

function newPaths() {
  const root = mkdtempSync(join(tmpdir(), "tool-insight-runs-"))
  const paths = toolInsightPaths(root)
  for (const dir of [paths.issuesDir, paths.runsDir, paths.casesDir, paths.recoveryDir, paths.locksDir]) {
    mkdirSync(dir, { recursive: true })
  }
  return { root, paths }
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

const DIGEST = `digest-${"a".repeat(64)}`
const BASE = { fingerprint: "fp_runs", case_digest: DIGEST, model: { providerID: "test", modelID: "test-model" }, fix_version: "0.1.24" }

function syntheticRecord(status: "passed" | "failed", runID: string, digest = DIGEST): ToolInsightRunRecord {
  return {
    run_id: runID,
    case_digest: digest,
    model: {},
    fix_version: "0.1.24",
    status,
    verified: status === "passed" ? "verified_success" : "verified_failure",
    detail: status,
    ts: 0,
  }
}

describe("运行记录逐次追加与读取", () => {
  test("started 先于终态追加（run 锁内编排），逐次结果可完整读回", async () => {
    const { root, paths } = newPaths()
    try {
      const outcome = await runUnderRunLock(file, paths, { fingerprint: BASE.fingerprint }, async () => {
        const first = appendRunStartedLocked(paths, BASE)
        expect(first.result.appended).toBe(true)
        appendRunFinishedLocked(paths, { ...BASE, runID: first.runID, status: "passed", verified: "verified_success", detail: "第 1 次通过" })
        const second = appendRunStartedLocked(paths, BASE)
        appendRunFinishedLocked(paths, { ...BASE, runID: second.runID, status: "failed", verified: "verified_failure", detail: "第 2 次失败" })
      })
      expect(outcome.ok).toBe(true)

      const records = loadRunRecords(paths, BASE.fingerprint)
      expect(records).toHaveLength(4)
      expect(records.map((record) => record.status)).toEqual(["started", "passed", "started", "failed"])
      expect(records[0]?.run_id).toBe(records[1]?.run_id)
      expect(records[1]?.verified).toBe("verified_success")
      expect(records[3]?.verified).toBe("verified_failure")
    } finally {
      cleanup(root)
    }
  })

  test("未执行终态（取消/授权失效/预检失败）强制未验证并计入未执行次数", async () => {
    const { root, paths } = newPaths()
    try {
      await runUnderRunLock(file, paths, { fingerprint: BASE.fingerprint }, async () => {
        const cancelled = appendRunStartedLocked(paths, BASE)
        appendRunFinishedLocked(paths, {
          ...BASE,
          runID: cancelled.runID,
          status: "cancelled",
          // 故意传非 unverified：记录层必须强制未验证
          verified: "verified_success",
          detail: "用户取消",
        })
        const preflight = appendRunStartedLocked(paths, BASE)
        appendRunFinishedLocked(paths, { ...BASE, runID: preflight.runID, status: "preflight_failed", verified: "unverified", detail: "预检失败" })
        const authz = appendRunStartedLocked(paths, BASE)
        appendRunFinishedLocked(paths, { ...BASE, runID: authz.runID, status: "authorization_invalid", verified: "unverified", detail: "授权失效" })
      })

      const records = loadRunRecords(paths, BASE.fingerprint)
      for (const record of records.filter((entry) => entry.status !== "started")) {
        expect(record.verified).toBe("unverified")
      }
      const summary = summarizeRuns(records, DIGEST)
      expect(summary.notExecuted).toBe(3)
      expect(summary.verdict).toBe("none")
    } finally {
      cleanup(root)
    }
  })
})

describe("多次通过判定", () => {
  test("全部实际通过才判 passed；结果不一致判 unstable（未稳定解决）", () => {
    expect(summarizeRuns([syntheticRecord("passed", "r1"), syntheticRecord("passed", "r2"), syntheticRecord("passed", "r3")], DIGEST).verdict).toBe("passed")
    const unstable = summarizeRuns([syntheticRecord("passed", "r1"), syntheticRecord("failed", "r2")], DIGEST)
    expect(unstable.verdict).toBe("unstable")
    expect(unstable.autoPassed).toBe(1)
    expect(unstable.autoFailed).toBe(1)
    expect(summarizeRuns([syntheticRecord("failed", "r1"), syntheticRecord("failed", "r2")], DIGEST).verdict).toBe("failed")
  })

  test("人工结果只留痕不计自动通过", async () => {
    const { root, paths } = newPaths()
    try {
      await appendManualRunResult(file, paths, { ...BASE, passed: true, detail: "人工确认通过" })
      await appendManualRunResult(file, paths, { ...BASE, passed: false, detail: "人工确认失败" })

      const records = loadRunRecords(paths, BASE.fingerprint)
      expect(records.filter((record) => record.manual)).toHaveLength(2)
      const summary = summarizeRuns(records, DIGEST)
      expect(summary.manualCount).toBe(2)
      expect(summary.autoPassed).toBe(0)
      expect(summary.autoFailed).toBe(0)
      // 人工结果不能把判定顶成 passed
      expect(summary.verdict).toBe("none")
    } finally {
      cleanup(root)
    }
  })

  test("案例摘要变化后旧批次不参与新批次判定", () => {
    const newDigest = `digest-${"b".repeat(64)}`
    const summary = summarizeRuns([syntheticRecord("failed", "r1"), syntheticRecord("failed", "r2")], newDigest)
    expect(summary.autoFailed).toBe(0)
    expect(summary.verdict).toBe("none")
  })
})

describe("崩溃对账", () => {
  test("无终态 started 标为 interrupted/未验证且不自动重跑；重复对账幂等", async () => {
    const { root, paths } = newPaths()
    try {
      const crashed = await appendRunStarted(file, paths, BASE)
      const done = await appendRunStarted(file, paths, BASE)
      await runUnderRunLock(file, paths, { fingerprint: BASE.fingerprint }, async () => {
        appendRunFinishedLocked(paths, { ...BASE, runID: done.runID, status: "passed", verified: "verified_success", detail: "已完成" })
      })

      expect(await reconcileRunRecords(file, paths, { fingerprint: BASE.fingerprint })).toEqual({ marked: 1 })

      const records = loadRunRecords(paths, BASE.fingerprint)
      const mark = records.find((record) => record.status === "interrupted")
      expect(mark?.target_run_id).toBe(crashed.runID)
      expect(mark?.verified).toBe("unverified")
      expect(mark?.case_digest).toBe(DIGEST)

      // 再次对账不再重复标记；带中断痕迹的批次判定为 incomplete
      expect(await reconcileRunRecords(file, paths, { fingerprint: BASE.fingerprint })).toEqual({ marked: 0 })
      const summary = summarizeRuns(loadRunRecords(paths, BASE.fingerprint), DIGEST)
      expect(summary.verdict).toBe("incomplete")
      expect(summary.interrupted).toBe(1)
    } finally {
      cleanup(root)
    }
  })

  test("另一进程活动运行持有 run 锁时对账拿锁失败，不误标", async () => {
    const { root, paths } = newPaths()
    try {
      await appendRunStarted(file, paths, BASE)
      expect(await reconcileRunRecords(busyFile, paths, { fingerprint: BASE.fingerprint })).toEqual({ marked: 0, reason: "lock-failed" })
      expect(loadRunRecords(paths, BASE.fingerprint).filter((record) => record.status === "interrupted")).toHaveLength(0)
    } finally {
      cleanup(root)
    }
  })

  test("run 锁覆盖整个运行：锁内 work 未完成前同键后续运行排队", async () => {
    const { root, paths } = newPaths()
    try {
      const order: string[] = []
      const first = runUnderRunLock(file, paths, { fingerprint: BASE.fingerprint }, async () => {
        order.push("first-start")
        appendRunStartedLocked(paths, BASE)
        order.push("first-end")
      })
      const second = runUnderRunLock(file, paths, { fingerprint: BASE.fingerprint }, async () => {
        order.push("second-start")
      })
      await Promise.all([first, second])
      expect(order).toEqual(["first-start", "first-end", "second-start"])
    } finally {
      cleanup(root)
    }
  })
})

describe("安全清理", () => {
  test("只清理本任务临时根之下的目录", async () => {
    const outside = mkdtempSync(join(tmpdir(), "tool-insight-outside-"))
    const root = mkdtempSync(join(tmpdir(), "tool-insight-clean-root-"))
    try {
      const child = join(root, "run-child")
      mkdirSync(child)
      writeFileSync(join(child, "marker.txt"), "x")
      expect(await safeRemoveTempDir({ root, target: child })).toEqual({ removed: true })
      expect(existsSync(child)).toBe(false)
      // 已不存在的目标视为已清理
      expect(await safeRemoveTempDir({ root, target: child })).toEqual({ removed: true })

      expect(await safeRemoveTempDir({ root, target: root })).toEqual({ removed: false, reason: "is-root" })
      expect(existsSync(root)).toBe(true)
      expect(await safeRemoveTempDir({ root, target: outside })).toEqual({ removed: false, reason: "outside-root" })
      expect(existsSync(outside)).toBe(true)
      // 真实存在但位于根之外的子路径同样拒绝（外部目录的缺失子项在归一化后仍在根外）
      expect(await safeRemoveTempDir({ root, target: join(root, "..", "tool-insight-outside-missing") })).toEqual({ removed: false, reason: "outside-root" })
    } finally {
      cleanup(root)
      cleanup(outside)
    }
  })

  test("符号链接逃逸与原项目路径清理拒绝", async () => {
    const original = mkdtempSync(join(tmpdir(), "tool-insight-original-"))
    writeFileSync(join(original, "novel.db"), "原书数据")
    const root = mkdtempSync(join(tmpdir(), "tool-insight-symlink-"))
    try {
      const link = join(root, "逃逸链接")
      let linked = true
      try {
        symlinkSync(original, link, "junction")
      } catch {
        linked = false
      }
      if (linked) {
        // 链接的 realpath 解析到原项目 → 落在临时根之外，拒绝删除
        expect(await safeRemoveTempDir({ root, target: link })).toEqual({ removed: false, reason: "outside-root" })
        expect(existsSync(link)).toBe(true)
        expect(existsSync(join(original, "novel.db"))).toBe(true)
      }
      // 直接把原项目路径当清理目标同样拒绝
      expect(await safeRemoveTempDir({ root, target: original })).toEqual({ removed: false, reason: "outside-root" })
      expect(existsSync(join(original, "novel.db"))).toBe(true)
    } finally {
      cleanup(original)
      cleanup(root)
    }
  })
})
