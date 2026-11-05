/**
 * 自动触发（3.1，design D4）测试
 *
 * 覆盖：24h 冷却与再触发、四类信号前置条件（反复修改窗跨键合计 ≥5/6h、
 * 会话里程碑自上次自动报告以来 +10）、手动报告绕过冷却且不重置自动节奏。
 * 时间全部经 now 注入，桶条目直写 JSONL 固定时间戳（Windows 时钟 flake 族）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { appendFileSync, mkdirSync, readdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeDb } from "../../src/novel-writer/session-store.js"
import { getMetricsDir, getMetricsPath } from "../../src/novel-writer/evaluate/metrics.js"
import { generateReport, readLastAutoRunTs } from "../../src/novel-writer/evaluate/report.js"
import { maybeAutoReport } from "../../src/novel-writer/evaluate/trigger.js"

const T0 = new Date(2026, 10, 6, 12, 0, 0).getTime()
const HOUR = 3_600_000

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `eval-trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(projectDir, { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function seedEntries(entries: Array<Record<string, unknown>>) {
  mkdirSync(getMetricsDir(projectDir), { recursive: true })
  appendFileSync(getMetricsPath(projectDir), entries.map((e) => JSON.stringify(e)).join("\n") + "\n")
}

function reportFiles() {
  return readdirSync(getMetricsDir(projectDir)).filter((f) => f.endsWith(".md"))
}

describe("maybeAutoReport 冷却与信号", () => {
  test("冷却：首次信号触发并标定水位，24h 内全信号抑制，24h 后再触发", () => {
    expect(maybeAutoReport(projectDir, "compaction", T0)).toBe(true)
    expect(readLastAutoRunTs(projectDir)).toBe(T0)
    expect(reportFiles()).toHaveLength(1)
    expect(reportFiles()[0].endsWith("-since-last.md")).toBe(true)

    expect(maybeAutoReport(projectDir, "compaction", T0 + 23 * HOUR)).toBe(false)
    expect(maybeAutoReport(projectDir, "volume-complete", T0 + 23 * HOUR)).toBe(false)

    expect(maybeAutoReport(projectDir, "compaction", T0 + 24 * HOUR + 1)).toBe(true)
    expect(readLastAutoRunTs(projectDir)).toBe(T0 + 24 * HOUR + 1)
  })

  test("手动报告绕过冷却且不重置自动节奏", () => {
    expect(maybeAutoReport(projectDir, "compaction", T0)).toBe(true)

    // 手动 /evaluate：推进 since-last 窗口，但不动 lastAutoRunTs
    generateReport(projectDir, { kind: "since-last" }, T0 + HOUR)
    expect(maybeAutoReport(projectDir, "compaction", T0 + 2 * HOUR)).toBe(false)
    expect(readLastAutoRunTs(projectDir)).toBe(T0)

    expect(maybeAutoReport(projectDir, "compaction", T0 + 25 * HOUR)).toBe(true)
  })

  test("反复修改窗：6h 窗内跨键合计 ≥5 才触发，窗外条目不计", () => {
    // 窗外 5 条回滚（7h 前）不计入
    seedEntries([{ ts: T0 - 7 * HOUR, domain: "c5-flow", key: "version.rollback", delta: 5 }])
    expect(maybeAutoReport(projectDir, "revision-window", T0)).toBe(false)

    // 窗内补齐：回滚 3 + 审批拒绝 1 + 大改对比 1 = 5 → 触发
    seedEntries([
      { ts: T0 - HOUR, domain: "c5-flow", key: "version.rollback", delta: 3 },
      { ts: T0 - HOUR, domain: "c2-prompt-control", key: "approval.rejected", delta: 1 },
      { ts: T0 - 2 * HOUR, domain: "c2-prompt-control", key: "paragraph.diff.checked", delta: 1 },
    ])
    expect(maybeAutoReport(projectDir, "revision-window", T0)).toBe(true)
  })

  test("反复修改窗：窗内 4 条未达阈值，抑制", () => {
    seedEntries([
      { ts: T0 - HOUR, domain: "c5-flow", key: "version.rollback", delta: 2 },
      { ts: T0 - 2 * HOUR, domain: "c2-prompt-control", key: "approval.rejected", delta: 2 },
    ])
    expect(maybeAutoReport(projectDir, "revision-window", T0)).toBe(false)
  })

  test("会话里程碑：自上次自动报告以来 +10 会话才触发，触发后重新累计", () => {
    seedEntries(
      Array.from({ length: 9 }, (_, i) => ({
        ts: T0 - (10 - i) * HOUR,
        domain: "c5-flow",
        key: "session.created",
        delta: 1,
      })),
    )
    expect(maybeAutoReport(projectDir, "session-milestone", T0)).toBe(false)

    seedEntries([{ ts: T0 - HOUR, domain: "c5-flow", key: "session.created", delta: 1 }])
    expect(maybeAutoReport(projectDir, "session-milestone", T0)).toBe(true)

    // 触发后新增 9 个会话：不满 +10，冷却解除后仍抑制
    seedEntries(
      Array.from({ length: 9 }, (_, i) => ({
        ts: T0 + i * 1000,
        domain: "c5-flow",
        key: "session.created",
        delta: 1,
      })),
    )
    expect(maybeAutoReport(projectDir, "session-milestone", T0 + 25 * HOUR)).toBe(false)
  })

  test("volume-complete 与 compaction 仅冷却门，无条件触发", () => {
    expect(maybeAutoReport(projectDir, "volume-complete", T0)).toBe(true)
  })
})
