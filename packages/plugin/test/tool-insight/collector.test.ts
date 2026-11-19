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
import { isInternalEvent } from "../../src/tool-insight/filter.js"
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

function makeState(
  configDir: string,
  logRoot: string,
  projectDir: string,
  options?: {
    session?: { get: (sessionID: string) => Promise<{ location: string; projectID?: string } | undefined> }
    ownership?: Parameters<typeof createCollectorState>[0]["ownership"]
  },
) {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 采集器只消费 file/paths.config/session 三个域，测试替身字段集故意不完整
  const ctx = { file, paths: { config: configDir }, event: {}, session: options?.session } as unknown as PluginContext
  return createCollectorState({ ctx, projectDirectory: projectDir, ownership: options?.ownership })
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

const failError = { type: "unknown", name: "not_found", message: "章节不存在 ch_x" }

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
      await state.onToolCalled({ sessionID: "sA", assistantMessageID: "msg_a", callID: "call_1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_a_call")
      await state.onToolFailed({ sessionID: "sA", assistantMessageID: "msg_a", callID: "call_1", error: failError }, "evt_a_fail")
      await state.onToolCalled({ sessionID: "sB", assistantMessageID: "msg_b", callID: "call_1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_b_call")
      await state.onToolFailed({ sessionID: "sB", assistantMessageID: "msg_b", callID: "call_1", error: failError }, "evt_b_fail")

      const first = readEvidence(logRoot, projectDir)
      const second = readEvidence(logRoot, otherProject)
      const firstFailures = first.entries.filter((entry) => entry.kind === "tool_failed")
      const secondFailures = second.entries.filter((entry) => entry.kind === "tool_failed")
      expect(firstFailures).toHaveLength(1)
      expect(secondFailures).toHaveLength(1)
      expect(firstFailures[0]?.projectID).toBe("proj_A")
      expect(secondFailures[0]?.projectID).toBe("proj_B")
      expect(firstFailures[0]?.occurrenceID).not.toBe(secondFailures[0]?.occurrenceID)
      expect(firstFailures[0]?.callID).toBe("call_1")
      expect(secondFailures[0]?.callID).toBe("call_1")
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
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_call")
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_fail")

      // 客观证据先行：turn 仍开放时 tool_failed 证据与 call 级文档已落盘
      const during = readEvidence(logRoot, projectDir)
      expect(during.entries.map((entry) => entry.kind)).toEqual(["tool_failed"])
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "tool_failure", errorCategory: "not_found" })
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

  test("乱序容忍：tool.* 先于同 turn 的 step.started 到达仍命中恢复失败归纳", async () => {
    const { configDir, logRoot, projectDir } = fixture("reorder")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      // 宿主分类型订阅流不保证先序：两次失败先于 step.started 到达（参数键不同，
      // 排除同键重复的 redundant_repeat，应命中 recovery_failed）
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_c1")
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_f1")
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c2", tool: "update_chapter", input: { chapter_id: "ch1", title: "x" } }, "evt_c2")
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c2", error: failError }, "evt_f2")
      // 迟到的 step.started 只补 agent/model，不覆盖已积累的调用序列
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")

      const { entries } = readEvidence(logRoot, projectDir)
      expect(entries.map((entry) => entry.kind)).toEqual(["tool_failed", "tool_failed", "trajectory", "trajectory", "trajectory"])
      const trajectories = entries.filter((entry) => entry.kind === "trajectory")
      expect(trajectories[0]?.fields.detection).toBe("recovery_failed")
      // 检测在第二次失败时刻落盘（早于迟到 step.started），补齐在 settle 时已回填 agent
      expect(trajectories[0]?.agent).toBeUndefined()
      expect(trajectories[2]?.agent).toBe("writer")
      // 指纹含 fact「retry-still-failed」（恢复失败检测的事实标记）
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "recovery_failed", errorCategory: "not_found", fact: "retry-still-failed" })
      const doc = readIssueMeta(logRoot, projectDir, fingerprint)
      expect(doc.meta.occurrence_count).toBe(1)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("乱序投递容忍不回归：下一 turn 的 step.started 先于上一 turn 迟到的 tool 事件处理，顺序重试的恢复失败归纳不丢", async () => {
    const { configDir, logRoot, projectDir } = fixture("interleave")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      // 复刻真实走查时序：called 流与 failed 流因落盘延迟被 step 流超越——step.ended(A)
      // 与 step.started(B) 都先于第二次调用的 tool 事件处理；重试是顺序发起（前一次
      // 失败结算后才发出，非 D6 批量在途形态），迟到的 called/failed 仍落回 turn A 窗口
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_a", agent: "writer", model: { id: "m/1" } })
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_a", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_c1")
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_a", callID: "c1", error: failError }, "evt_f1")
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_a" }, "evt_end_a")
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_b", agent: "writer", model: { id: "m/1" } })
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_a", callID: "c2", tool: "update_chapter", input: { chapter_id: "ch1", title: "x" } }, "evt_c2")
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_a", callID: "c2", error: failError }, "evt_f2")

      const { entries } = readEvidence(logRoot, projectDir)
      const detection = entries.find((entry) => entry.kind === "trajectory" && entry.fields.detection === "recovery_failed")
      expect(detection).toBeDefined()
      expect(detection?.turnID).toBe("msg_a")
      expect(detection?.fields.callsShape).toBe("update_chapter:called>update_chapter:failed>update_chapter:called>update_chapter:failed")
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "recovery_failed", errorCategory: "not_found", fact: "retry-still-failed" })
      const doc = readIssueMeta(logRoot, projectDir, fingerprint)
      expect(doc.meta.occurrence_count).toBe(1)
      // 两条失败证据都在（c1 先落、c2 迟到后落），互不覆盖
      expect(entries.filter((entry) => entry.kind === "tool_failed")).toHaveLength(2)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })


  test("批量先发后收零建档：同轮多调用全部先于结果发出后全部成功，零证据零文档", async () => {
    const { configDir, logRoot, projectDir } = fixture("batch-ok")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      // 批量并行：三个调用全部先于任何结果发出（无核验器工具，成功恒零落盘）
      for (const callID of ["c1", "c2", "c3"]) {
        await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID, tool: "restore_chapter_version", input: { chapter_id: "ch1" } }, `evt_${callID}`)
      }
      for (const callID of ["c1", "c2", "c3"]) {
        await state.onToolSuccess({ sessionID: "s1", assistantMessageID: "msg_1", callID, structured: {} }, `evt_ok_${callID}`)
      }
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")

      // 批量兄弟完成不计入 revisionStreak：不触发无意义重复，也不生成任何问题记录
      const paths = pathsFor(logRoot, projectDir)
      expect(existsSync(paths.evidence)).toBe(false)
      expect(existsSync(paths.issuesDir) ? readdirSync(paths.issuesDir).filter((name) => name.endsWith(".md")) : []).toEqual([])
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("批量门禁拦截不建档：同轮多调用同门禁全部失败，只有单次调用问题文档", async () => {
    const { configDir, logRoot, projectDir } = fixture("batch-gate")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      // 批量并行：全部先发出，随后同一前置拦截（同参数键、同类别）全部失败
      for (const callID of ["c1", "c2", "c3"]) {
        await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID, tool: "update_chapter", input: { chapter_id: "ch1" } }, `evt_${callID}`)
      }
      for (const callID of ["c1", "c2", "c3"]) {
        await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID, error: failError }, `evt_fail_${callID}`)
      }
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")

      const { entries } = readEvidence(logRoot, projectDir)
      // 客观证据先行恒落：三条 tool_failed + settle 补齐轨迹；无 detection 归纳记录
      expect(entries.filter((entry) => entry.kind === "tool_failed")).toHaveLength(3)
      expect(entries.some((entry) => typeof entry.fields.detection === "string")).toBe(false)
      // 只有 call 级 tool_failure 文档（三次发生），无重复/恢复失败/表面成功建档
      const docs = readdirSync(pathsFor(logRoot, projectDir).issuesDir).filter((name) => name.endsWith(".md"))
      expect(docs).toHaveLength(1)
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "tool_failure", errorCategory: "not_found" })
      expect(readIssueMeta(logRoot, projectDir, fingerprint).meta.occurrence_count).toBe(3)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("成功后同参重试记重复：顺序发起的同参成功达到阈值计入无意义重复", async () => {
    const { configDir, logRoot, projectDir } = fixture("retry-streak")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      // 顺序重试：每次调用都在前一次成功结算后才发起（非批量在途形态），连续计入
      for (const callID of ["c1", "c2", "c3"]) {
        await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID, tool: "restore_chapter_version", input: { chapter_id: "ch1" } }, `evt_${callID}`)
        await state.onToolSuccess({ sessionID: "s1", assistantMessageID: "msg_1", callID, structured: {} }, `evt_ok_${callID}`)
      }

      const { entries } = readEvidence(logRoot, projectDir)
      const detection = entries.find((entry) => entry.fields.detection === "redundant_repeat")
      expect(detection).toBeDefined()
      const fingerprint = String(detection?.fields.fingerprint)
      expect(readIssueMeta(logRoot, projectDir, fingerprint).meta.occurrence_count).toBe(1)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("失败证据携带脱敏标识符与参数键名：章节更新失败证据不含正文与完整参数值", async () => {
    const { configDir, logRoot, projectDir } = fixture("identifier")
    try {
      enable(configDir, logRoot)
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onStepStarted({ sessionID: "s1", assistantMessageID: "msg_1", agent: "writer", model: { id: "m/1" } })
      await state.onToolCalled(
        { sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch_target_0001", content: "第两千章 正文原文……" } },
        "evt_call",
      )
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_fail")

      const { entries } = readEvidence(logRoot, projectDir)
      const failure = entries.find((entry) => entry.kind === "tool_failed")
      // 参数键名与脱敏章节标识并存（短标识截断）
      expect(failure?.fields.paramKeys).toEqual(["chapter_id", "content"])
      expect(failure?.fields.paramIdentifiers).toEqual({ chapter_id: "ch_target_00" })
      const serialized = JSON.stringify(entries)
      expect(serialized).not.toContain("正文原文")
      expect(serialized).not.toContain("ch_target_0001")
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
      await first.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: {} }, "evt_run1_fail")
      await first.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_run1_fail")

      // 重启：新采集器状态、created 重新观察、同一 callID 再次失败（新信封 ID）
      const second = makeState(configDir, logRoot, projectDir)
      await second.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await second.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: {} }, "evt_run2_fail")
      await second.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_run2_fail")

      const { entries } = readEvidence(logRoot, projectDir)
      expect(entries).toHaveLength(2)
      const a = entries[0]
      const b = entries[1]
      const idOf = (value: unknown): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined)
      const occurrenceOf = (value: unknown): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, "occurrenceID") : undefined)
      expect(idOf(a)).not.toBe(idOf(b))
      expect(occurrenceOf(a)).toBe(occurrenceOf(b))
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "tool_failure", errorCategory: "not_found" })
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
        await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: `c${index}`, tool: `probe_${index}`, input: { key: index } }, `evt_c${index}`)
      }
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c32", tool: "probe_32", error: failError }, "evt_fail")
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
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "read_setting", input: {} }, "evt_call")
      await state.onToolSuccess({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", structured: { ok: true } }, "evt_success")
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
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: { chapter_id: chapterID, content: "新正文" } }, "evt_call")
      await state.onToolSuccess({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", structured: { chapter_id: chapterID } }, "evt_success")

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
      await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch_missing" } }, "evt_call")
      await state.onToolSuccess({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", structured: { chapter_id: "ch_missing" } }, "evt_success")

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

describe("会话归属与负反馈信号（任务 2/4）", () => {
  test("多 Location 同一事件只写一个项目根，重复证据不重复摄取", async () => {
    const { configDir, logRoot, projectDir } = fixture("multi-owner")
    const ownership = {
      observeCreated() {},
      resolve: async () => ({ projectID: "proj_same", directory: projectDir }),
    }
    try {
      enable(configDir, logRoot)
      const first = makeState(configDir, logRoot, projectDir, { ownership })
      const second = makeState(configDir, logRoot, projectDir, { ownership })
      for (const state of [first, second]) {
        await state.onToolCalled({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", tool: "update_chapter", input: { chapter_id: "ch1" } }, "evt_call")
        await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_fail")
      }
      const { entries } = readEvidence(logRoot, projectDir)
      expect(entries.filter((entry) => entry.kind === "tool_failed")).toHaveLength(1)
      const fingerprint = issueFingerprint({ tool: "update_chapter", scenario: "tool_failure", errorCategory: "not_found" })
      expect(readIssueMeta(logRoot, projectDir, fingerprint).meta.occurrence_count).toBe(1)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("重启后持久 Session 归属一致才兜底，不一致时不落盘", async () => {
    const { configDir, logRoot, projectDir } = fixture("persistent")
    const otherProject = join(projectDir, "..", "other-book")
    const consistent = makeState(configDir, logRoot, projectDir, {
      session: { get: async () => ({ location: projectDir, projectID: "proj_persistent" }) },
    })
    const mismatched = makeState(configDir, logRoot, projectDir, {
      session: { get: async () => ({ location: otherProject, projectID: "proj_other" }) },
    })
    try {
      enable(configDir, logRoot)
      await consistent.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_fail")
      await mismatched.onToolFailed({ sessionID: "s2", assistantMessageID: "msg_2", callID: "c2", error: failError }, "evt_other")
      const { entries } = readEvidence(logRoot, projectDir)
      expect(entries.filter((entry) => entry.kind === "tool_failed")).toHaveLength(1)
      expect(entries[0]?.projectID).toBe("proj_persistent")
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
      removeDir(otherProject)
    }
  })

  test("明确负反馈只保存稳定引用，同一提示跨事件信封只计一次", async () => {
    const { configDir, logRoot, projectDir } = fixture("signal")
    try {
      enable(configDir, logRoot)
      const secret = "sk-test-0123456789abcdef 第一千零二十四章 主角挺身而出。"
      const state = makeState(configDir, logRoot, projectDir, {
        ownership: { observeCreated() {}, resolve: async () => ({ projectID: "proj_signal", directory: projectDir }) },
      })
      const prompt = { sessionID: "s1", messageID: "msg_1", prompt: { text: `不对，${secret} {attachment:ch1.txt}` } }
      await state.onPromptAdmitted(prompt, "evt_first")
      await state.onPromptAdmitted(prompt, "evt_replayed")
      await state.onPromptAdmitted({ sessionID: "s1", messageID: "msg_2", prompt: { text: "你用错工具了" } }, "evt_tool")
      await state.onPromptAdmitted({ sessionID: "s1", messageID: "msg_3", prompt: { text: "流程步骤不合理" } }, "evt_flow")
      await state.onPromptAdmitted({ sessionID: "s1", messageID: "msg_4", prompt: { text: "可以再润色一下" } }, "evt_vague")

      const paths = pathsFor(logRoot, projectDir)
      const raw = readFileSync(paths.signals, "utf-8")
      const signals = readToolInsightJsonl(paths.signals).entries
      expect(signals).toHaveLength(3)
      expect(signals.filter((entry) => entry.occurrenceID?.startsWith("oci_"))).toHaveLength(3)
      expect(raw).not.toContain(secret)
      expect(raw).not.toContain("sk-test")
      expect(raw).not.toContain("attachment")
      expect(signals.map((entry) => entry.feedbackCategory)).toEqual(["result_rejected", "tool_misuse", "flow_issue"])
      expect(Object.keys(signals[0]!).sort()).toEqual([
        "feedbackCategory",
        "id",
        "occurrenceID",
        "projectID",
        "promptMessageID",
        "sessionID",
        "targetScope",
        "ts",
      ])
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })

  test("未启用时负反馈零落盘；内部事件被订阅过滤器拒绝", async () => {
    const { configDir, logRoot, projectDir } = fixture("signal-off")
    try {
      const state = makeState(configDir, logRoot, projectDir, {
        ownership: { observeCreated() {}, resolve: async () => ({ projectID: "proj_off", directory: projectDir }) },
      })
      await state.onPromptAdmitted({ sessionID: "s1", messageID: "msg_1", prompt: { text: "不对" } }, "evt_prompt")
      expect(existsSync(pathsFor(logRoot, projectDir).signals)).toBe(false)
      expect(
        isInternalEvent({ id: "evt_internal", purpose: "tool-insight", properties: { sessionID: "internal", messageID: "msg", prompt: { text: "不对" } } }),
      ).toBe(true)
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })
})
  test("开关关闭零落盘：未启用时全部事件静默", async () => {
    const { configDir, logRoot, projectDir } = fixture("off")
    try {
      // 不写任何配置文件
      const state = makeState(configDir, logRoot, projectDir)
      await state.onCreated({ sessionID: "s1", projectID: "proj_1", directory: projectDir })
      await state.onToolCalled({ sessionID: "s1", callID: "c1", tool: "update_chapter", input: {} }, "evt_call")
      await state.onToolFailed({ sessionID: "s1", assistantMessageID: "msg_1", callID: "c1", error: failError }, "evt_fail")
      await state.onStepSettled({ sessionID: "s1", assistantMessageID: "msg_1" }, "evt_end")
      expect(existsSync(logRoot) ? readdirSync(logRoot) : []).toEqual([])
    } finally {
      removeDir(configDir)
      removeDir(logRoot)
      removeDir(projectDir)
    }
  })
})
