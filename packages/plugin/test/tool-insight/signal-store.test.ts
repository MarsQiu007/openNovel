/**
 * 负反馈信号层测试（任务 4.1/2.2）。
 *
 * 覆盖本地确定性分类、稳定 ID/发生实例、JSONL 白名单解析、最小工件落盘、
 * 同一提示发生实例去重、撕裂尾部修复和 evidence 字段升级账本。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { toolInsightPaths } from "@opennovel-ai/novel-store"
import { appendEvidenceUnderLock, appendSignalUnderLock } from "../../src/tool-insight/evidence-store.js"
import {
  classifyNegativePrompt,
  deriveSignalID,
  deriveSignalOccurrenceID,
  parseSignal,
  signalAggregateKey,
  toUpgradedEvidenceFields,
  upgradedSignalIDs,
} from "../../src/tool-insight/signal-store.js"

const fakeLocks = new Map<string, Promise<unknown>>()
const file = {
  withLock: (input: { key: string; dir?: string }, callback: () => Promise<unknown>) => {
    if (input.dir !== undefined) mkdirSync(input.dir, { recursive: true })
    const chain = fakeLocks.get(input.key) ?? Promise.resolve()
    const run = chain.then(callback, callback)
    fakeLocks.set(input.key, run.then(() => undefined, () => undefined))
    return run
  },
}

function fixture(name: string) {
  const configDir = mkdtempSync(join(tmpdir(), `tool-insight-signal-${name}-cfg-`))
  const logRoot = mkdtempSync(join(tmpdir(), `tool-insight-signal-${name}-log-`))
  return { configDir, logRoot }
}

function cleanup(input: { configDir: string; logRoot: string }) {
  for (const dir of [input.configDir, input.logRoot]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {}
  }
}

const signal = (id: string, occurrenceID: string) => ({
  id,
  ts: 1,
  projectID: "proj",
  sessionID: "ses",
  promptMessageID: "msg",
  targetScope: "writing",
  feedbackCategory: "result_rejected",
  occurrenceID,
})

describe("负反馈信号层", () => {
  test("本地确定性分类：明确负反馈固定枚举，模糊表达不记录", () => {
    expect(classifyNegativePrompt("不对，这一章错了")).toEqual({ targetScope: "writing", feedbackCategory: "result_rejected" })
    expect(classifyNegativePrompt("  又错了  ")).toEqual({ targetScope: "writing", feedbackCategory: "result_rejected" })
    expect(classifyNegativePrompt("你用错工具了")).toEqual({ targetScope: "tool", feedbackCategory: "tool_misuse" })
    expect(classifyNegativePrompt("这个流程步骤不合理")).toEqual({ targetScope: "process", feedbackCategory: "flow_issue" })
    expect(classifyNegativePrompt("可以再润色一下")).toBeUndefined()
  })

  test("稳定 ID 与发生实例规则：同提示唯一，不同类别不误并", () => {
    const firstID = deriveSignalID({ projectID: "proj", eventID: "oci_1" })
    expect(deriveSignalID({ projectID: "proj", eventID: "oci_1" })).toBe(firstID)
    const base = { projectID: "proj", sessionID: "ses", promptMessageID: "msg_1" }
    expect(deriveSignalOccurrenceID({ ...base, targetScope: "writing", feedbackCategory: "result_rejected" })).toBe(
      deriveSignalOccurrenceID({ ...base, targetScope: "writing", feedbackCategory: "result_rejected" }),
    )
    expect(
      deriveSignalOccurrenceID({ ...base, targetScope: "tool", feedbackCategory: "tool_misuse" }),
    ).not.toBe(deriveSignalOccurrenceID({ ...base, targetScope: "writing", feedbackCategory: "result_rejected" }))
    expect(signalAggregateKey({ targetScope: "tool", feedbackCategory: "tool_misuse" })).toBe("tool:tool_misuse")
  })

  test("解析只接受固定枚举与完整引用；升级账本从 evidence 字段推导", async () => {
    const valid = signal("sig_1", "oci_1")
    expect(parseSignal(valid)).toEqual(valid)
    expect(parseSignal({ ...valid, targetScope: "secret" })).toBeUndefined()
    expect(parseSignal({ ...valid, promptMessageID: 1 })).toBeUndefined()
    const { configDir, logRoot } = fixture("ledger")
    try {
      const paths = toolInsightPaths(logRoot)
      await appendEvidenceUnderLock(file, paths, [
        {
          id: "evi_upgrade",
          ts: 2,
          kind: "user_report",
          projectID: "proj",
          sessionID: "ses",
          trigger: "user",
          occurrenceID: "oci_1",
          fields: toUpgradedEvidenceFields(valid),
        },
      ])
      expect(upgradedSignalIDs(paths)).toEqual(new Set(["sig_1"]))
    } finally {
      cleanup({ configDir, logRoot })
    }
  })

  test("首条信号只创建最小工件；同发生实例和撕裂尾部都唯一或可恢复", async () => {
    const { configDir, logRoot } = fixture("minimum")
    try {
      const paths = toolInsightPaths(logRoot)
      const first = signal("sig_1", "oci_1")
      const appended = await appendSignalUnderLock(file, paths, [first])
      expect(appended).toEqual({ appended: true })
      expect(readdirSync(logRoot).sort()).toEqual(["locks", "signals.jsonl"])
      expect(existsSync(paths.evidence)).toBe(false)
      expect(existsSync(paths.index)).toBe(false)
      expect(existsSync(paths.issuesDir)).toBe(false)
      expect(existsSync(paths.runsDir)).toBe(false)

      // 同一提示即使因重放派生新信号 ID，也按发生实例去重
      await appendSignalUnderLock(file, paths, [signal("sig_replayed", "oci_1")])
      const torn = signal("sig_2", "oci_2")
      await appendSignalUnderLock(file, paths, [torn])
      writeFileSync(paths.signals, readFileSync(paths.signals, "utf-8") + '{"id":"sig_torn"', "utf-8")
      const third = signal("sig_3", "oci_3")
      await appendSignalUnderLock(file, paths, [third])
      const raw = readFileSync(paths.signals, "utf-8")
      expect(raw.split("\n").filter((line) => line.trim() !== "")).toHaveLength(3)
      expect(raw).toContain(torn.occurrenceID)
      expect(raw).toContain(third.occurrenceID)
    } finally {
      cleanup({ configDir, logRoot })
    }
  })
})