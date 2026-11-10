/**
 * 事件证据采集器测试（任务 3.1）。
 *
 * 覆盖 tasks.md 3.1 验证：跨项目同 callID 不串线、调用窗口有界淘汰、开放 turn
 * 先存证据且结束后补齐、同一发生多条证据只计一次、重启不重用证据 ID、正常成功
 * 无意见、真实状态核验只存证据（失败才建档）、开关关闭零落盘。
 * 事件时序由测试直接按序调用 handler 驱动；锁用进程内 fake，落盘用真实临时目录。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { closeDb, readToolInsightJsonl, toolInsightIssuePath, toolInsightPaths } from "@opennovel-ai/novel-store"
import { ChapterTable, ChapterVersionTable, NovelTable, getDb } from "../../src/novel-writer/session-store.js"
import { createCollectorState } from "../../src/tool-insight/collector.js"
import { issueFingerprint, parseIssueDoc } from "../../src/tool-insight/issue-doc.js"
import { toolInsightProjectSlug } from "../../src/tool-insight/settings.js"
import type { PluginContext } from "../../src/v2/effect/context.js"

const fakeLocks = new Map<string, Promise<unknown>>()

const file = {
  // 与 issue-store.test 同款：进程内按键串行化，保持「同键互斥、跨键并行」语义
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

function fixture(name: string) {
  const configDir = mkdtempSync(join(tmpdir(), `tool-insight-${name}-cfg-`))
  const logRoot = mkdtempSync(join(tmpdir(), `tool-insight-${name}-log-`))
  const projectDir = mkdtempSync(join(tmpdir(), `tool-insight-${name}-proj-`))
  return { configDir, logRoot, projectDir }
}

function enable(configDir: string, logRoot: string) {
  writeFileSync(join(configDir, "opennovel.json"), JSON.stringify({ toolInsight: { enabled: true, directory: logRoot } }))
}

function pathsFor(logRoot: string, projectDir: string) {
  return toolInsightPaths(join(logRoot, toolInsightProjectSlug(projectDir)))
}

function makeState(configDir: string, logRoot: string, projectDir: string) {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 采集器只消费 file/paths.config 两个域，测试替身字段集故意不完整
  const ctx = { file, paths: { config: configDir }, event: {} } as unknown as PluginContext
  return createCollectorState({ ctx, projectDirectory: projectDir })
}

function readEvidence(logRoot: string, projectDir: string) {
  const paths = pathsFor(logRoot, projectDir)
  return { paths, ...readToolInsightJsonl(paths.evidence) }
}

function readIssueMeta(logRoot: string, projectDir: string, fingerprint: string) {
  const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(pathsFor(logRoot, projectDir), fingerprint), "utf-8"))
  if (parsed.error) throw new Error("expected parseable issue doc")
  return parsed
}

const failError = { type: "unknown", name: "NotFoundError", message: "章节不存在 ch_x" }

function removeDir(dir: string) {
  // Windows 下句柄/DB 释放有短暂延迟：清理失败不影响断言
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
}

describe("事件证据采集器（任务 3.1）", () => {
  test("跨项目同 callID 不串线：证据按项目区分且发生实例不同", async () => {
    const { configDir, logRoot, projectDir } = fixture("cross")
    try {
      enable(configDir, logRoot)
      const otherProject = join(projectDir, "..", "other-book")
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "sA", projectID: "proj_A", directory: projectDir })
      await state.onCreated({ sessionID: "sB", projectID: "proj_B", directory: otherProject })
      await state.onToolCalled({ sessionID: "sA", callID: "call_1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_a_call")
      await state.onToolFailed({ sessionID: "sA", callID: "call_1", error: failError }, "evt_a_fail")
      await state.onToolCalled({ sessionID: "sB", callID: "call_1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_b_call")
      await state.onToolFailed({ sessionID: "sB", callID: "call_1", error: failError }, "evt_b_fail")

      const { entries } = readEvidence(logRoot, projectDir)
      const failures = entries.filter((entry) => entry.kind === "tool_failed")
      expect(failures).toHaveLength(2)
      const projects = new Set(failures.map((entry) => entry.projectID))
      expect(projects).toEqual(new Set(["proj_A", "proj_B"]))
      const [first, second] = failures
      expect(first?.occurrenceID).toBeDefined()
      expect(first?.occurrenceID).not.toBe(second?.occurrenceID)
      expect(first?.callID).toBe("call_1")
      expect(second?.callID).toBe("call_1")
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("开放 turn 先存证据，turn 结束补齐完整轨迹，同一发生只计一次", async () => {
    const { configDir, logRoot, projectDir } = fixture("turn")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      await state.onToolCalled({ sessionID: "s1", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_call")
      await state.onToolFailed({ sessionID: "s1", callID: "c1", error: failError }, "evt_fail")

      // 客观证据先行：turn 仍开放时 tool_failed 证据与 call 级文档已落盘
      const during = readEvidence(logRoot, projectDir)
      expect(during.entries.map((entry) => entry.kind)).toEqual(["tool_failed"])
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "tool_failure", errorCategory: "NotFoundError" })
      const duringDoc = readIssueMeta(logRoot, projectDir, fingerprint)
      expect(duringDoc.meta.occurrence_count).toBe(1)
      const occurrence = duringDoc.meta.occurrence_ids[0]

      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")

      // 补齐：trajectory 证据追加进同一 call 级文档，发生实例与次数不变
      const after = readEvidence(logRoot, projectDir)
      expect(after.corruptLines).toBe(0)
      expect(after.entries.map((entry) => entry.kind)).toEqual(["tool_failed", "trajectory"])
      const trajectory = after.entries[1]!
      expect(trajectory.callID).toBe("c1")
      expect(trajectory.occurrenceID).toBe(occurrence)
      expect(trajectory.fields.callsShape).toBe("update_chapter:called>update_chapter:failed")
      const doc = readIssueMeta(logRoot, projectDir, fingerprint)
      expect(doc.meta.occurrence_count).toBe(1)
      expect(doc.meta.evidence_ids).toHaveLength(2)
      // turn 窗口关闭
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end_again")
      const closed = readEvidence(logRoot, projectDir)
      expect(closed.entries).toHaveLength(2)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("重启不重用证据 ID：同一调用再失败是新证据、同发生只计一次", async () => {
    const { configDir, logRoot, projectDir } = fixture("restart")
    try {
      enable(configDir, logRoot)
      const first = makeState(configDir, logRoot, projectDir)
      await first.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await first.onToolCalled({ sessionID: "s1", callID: "c1", tool: "update_chapter", input: {} }, "evt_run1_fail")
      await first.onToolFailed({ sessionID: "s1", callID: "c1", error: failError }, "evt_run1_fail")

      // 重启：新采集器状态、created 重新观察、同一 callID 再次失败（新信封 ID）
      const second = makeState(configDir, logRoot, projectDir)
      await second.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await second.onToolCalled({ sessionID: "s1", callID: "c1", tool: "update_chapter", input: {} }, "evt_run2_fail")
      await second.onToolFailed({ sessionID: "s1", callID: "c1", error: failError }, "evt_run2_fail")

      const { entries } = readEvidence(logRoot, projectDir)
      expect(entries).toHaveLength(2)
      const a = entries[0]
      const b = entries[1]
      const idOf = (value: unknown): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined)
      const occurrenceOf = (value: unknown): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, "occurrenceID") : undefined)
      expect(idOf(a)).not.toBe(idOf(b))
      expect(occurrenceOf(a)).toBe(occurrenceOf(b))
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "tool_failure", errorCategory: "NotFoundError" })
      expect(readIssueMeta(logRoot, projectDir, fingerprint).meta.occurrence_count).toBe(1)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("调用窗口有界：超出上限后最早调用被淘汰", async () => {
    const { configDir, logRoot, projectDir } = fixture("window")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      for (let index = 0; index < 33; index++) {
        await state.onToolCalled({ sessionID: "s1", callID: `c${index}`, tool: `probe_${index}`, input: { key: index } }, `evt_c${index}`)
      }
      await state.onToolFailed({ sessionID: "s1", callID: "c32", tool: "probe_32", error: failError }, "evt_fail")
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")

      const { entries } = readEvidence(logRoot, projectDir)
      const trajectory = entries.filter((entry) => entry.kind === "trajectory")
      // 窗口 32：probe_0 已淘汰，补齐轨迹从 probe_1 开始
      expect(trajectory).toHaveLength(1)
      const shape = String(trajectory[0]?.fields.callsShape)
      expect(shape.startsWith("probe_1:called")).toBe(true)
      expect(shape).not.toContain("probe_0")
      expect(shape.endsWith("probe_32:failed")).toBe(true)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("正常成功无意见：无核验器的成功不落任何证据与文档", async () => {
    const { configDir, logRoot, projectDir } = fixture("silent")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      await state.onToolCalled({ sessionID: "s1", callID: "c1", tool: "read_setting", input: {} }, "evt_call")
      await state.onToolSuccess({ sessionID: "s1", callID: "c1", structured: { ok: true } }, "evt_success")
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")

      const paths = pathsFor(logRoot, projectDir)
      expect(existsSync(paths.evidence)).toBe(false)
      expect(existsSync(paths.issuesDir) ? readdirSync(paths.issuesDir).filter((name) => name.endsWith(".md")) : []).toEqual([])
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("核验成功只存证据：real_state 记录核验通过，不产生问题文档", async () => {
    let envBackup: string | undefined
    const projectDir = mkdtempSync(join(tmpdir(), "tool-insight-verify-ok-"))
    const configDir = mkdtempSync(join(tmpdir(), "tool-insight-verify-ok-cfg-"))
    const logRoot = mkdtempSync(join(tmpdir(), "tool-insight-verify-ok-log-"))
    try {
      envBackup = process.env.OPENNOVEL_DB
      delete process.env.OPENNOVEL_DB
      enable(configDir, logRoot)
      const db = getDb(projectDir)
      const novelID = crypto.randomUUID()
      const chapterID = crypto.randomUUID()
      db.insert(NovelTable).values({ id: novelID, title: "核验", genre: "玄幻", synopsis: "", created_at: 1, updated_at: 1, status: "draft" }).run()
      db.insert(ChapterTable).values({ id: chapterID, novel_id: novelID, volume_id: null, title: "第1章", content: "正文", word_count: 2, status: "drafting", order: 1, created_at: 1, updated_at: 1 }).run()
      db.insert(ChapterVersionTable).values({ id: crypto.randomUUID(), chapter_id: chapterID, version: 1, content: "正文", word_count: 2, created_at: 1, created_by: "writer" }).run()

      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onToolCalled({ sessionID: "s1", callID: "c1", tool: "update_chapter", input: { chapter_id: chapterID, content: "新正文" } }, "evt_call")
      await state.onToolSuccess({ sessionID: "s1", callID: "c1", structured: { chapter_id: chapterID } }, "evt_success")

      const { entries } = readEvidence(logRoot, projectDir)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.kind).toBe("real_state")
      expect(entries[0]?.fields.verifyStatus).toBe("verified_success")
      expect(existsSync(pathsFor(logRoot, projectDir).issuesDir) ? readdirSync(pathsFor(logRoot, projectDir).issuesDir).filter((name) => name.endsWith(".md")) : []).toEqual([])
    } finally {
      if (envBackup === undefined) delete process.env.OPENNOVEL_DB
      else process.env.OPENNOVEL_DB = envBackup
      closeDb(projectDir)
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("核验失败建档：表面成功落 real_state 失败证据并建 call 级与 turn 级文档", async () => {
    let envBackup: string | undefined
    const projectDir = mkdtempSync(join(tmpdir(), "tool-insight-verify-bad-"))
    const configDir = mkdtempSync(join(tmpdir(), "tool-insight-verify-bad-cfg-"))
    const logRoot = mkdtempSync(join(tmpdir(), "tool-insight-verify-bad-log-"))
    try {
      envBackup = process.env.OPENNOVEL_DB
      delete process.env.OPENNOVEL_DB
      enable(configDir, logRoot)
      getDb(projectDir)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      await state.onToolCalled({ sessionID: "s1", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch_missing" } }, "evt_call")
      await state.onToolSuccess({ sessionID: "s1", callID: "c1", structured: { chapter_id: "ch_missing" } }, "evt_success")

      const { entries } = readEvidence(logRoot, projectDir)
      const realState = entries.find((entry) => entry.kind === "real_state")
      expect(realState?.fields.verifyStatus).toBe("verified_failure")
      // call 级表面成功文档 + turn 级轨迹文档
      const callFingerprint = issueFingerprint({ tool: "update_chapter", scenario: "surface_success", errorCategory: "unknown" })
      const turnFingerprint = issueFingerprint({
        tool: "update_chapter",
        scenario: "surface_success",
        errorCategory: "unknown",
        fact: "verify-failed-after-success",
      })
      const callDoc = readIssueMeta(logRoot, projectDir, callFingerprint)
      const turnDoc = readIssueMeta(logRoot, projectDir, turnFingerprint)
      expect(callDoc.meta.occurrence_count).toBe(1)
      expect(turnDoc.meta.occurrence_count).toBe(1)
      expect(entries.filter((entry) => entry.kind === "trajectory")).toHaveLength(1)
    } finally {
      if (envBackup === undefined) delete process.env.OPENNOVEL_DB
      else process.env.OPENNOVEL_DB = envBackup
      closeDb(projectDir)
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("开关关闭零落盘：未启用时全部事件静默", async () => {
    const { configDir, logRoot, projectDir } = fixture("off")
    try {
      // 不写任何配置文件
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onToolCalled({ sessionID: "s1", callID: "c1", tool: "update_chapter", input: {} }, "evt_call")
      await state.onToolFailed({ sessionID: "s1", callID: "c1", error: failError }, "evt_fail")
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")
      expect(existsSync(logRoot) ? readdirSync(logRoot) : []).toEqual([])
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })
})
