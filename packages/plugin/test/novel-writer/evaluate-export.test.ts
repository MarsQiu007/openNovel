/**
 * 诊断包导出测试（4.1，design D5）
 *
 * 覆盖：L0/L1/L2 累积分级、敏感 fixture 脱敏（正文与题材值不进包）、
 * 错误样本上限截断标记、L2 题材提示经工具输出层明示、导出链路零网络静态检查。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeDb } from "../../src/novel-writer/session-store.js"
import { getMetricsDir, getMetricsPath } from "../../src/novel-writer/evaluate/metrics.js"
import { exportDiagnostics } from "../../src/novel-writer/evaluate/export.js"
import { evaluateTools } from "../../src/novel-writer/tools/evaluate.js"
import { createToolContext } from "./runtime-assembly-helpers.js"

const T0 = new Date(2026, 10, 6, 12, 0, 0).getTime()
const SECRET_TEXT = "月光洒在剑刃上——这是绝不该外泄的小说正文片段"
const GENRE_VALUE = "东方玄幻"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `eval-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function expectRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error(`期望对象，实际 ${typeof value}`)
}

function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("期望数组")
  return value
}

function expectNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error(`期望 number，实际 ${typeof value}`)
  return value
}

/** 直写 JSONL：带正文/题材夹带字段的失败条目 + 普通条目（白名单外字段应被脱敏丢弃） */
function seedSensitive() {
  mkdirSync(getMetricsDir(projectDir), { recursive: true })
  const lines = [
    { ts: T0, domain: "c1-runtime", key: "tool.failed.novel_write", delta: 1, sessionId: "s1", text: SECRET_TEXT, genre: GENRE_VALUE, note: "user draft" },
    { ts: T0 + 1000, domain: "c2-prompt-control", key: "approval.rejected", delta: 2, agent: "director", model: "test/model", scene: "初遇", text: SECRET_TEXT },
    { ts: T0 + 2000, domain: "c3-recall", key: "recall.route.entity", delta: 3, chapter: 7 },
  ]
  appendFileSync(getMetricsPath(projectDir), lines.map((e) => JSON.stringify(e)).join("\n") + "\n")
}

function readBundle(level: string): Record<string, unknown> {
  const file = readdirSync(getMetricsDir(projectDir)).find((f) => f.endsWith(`-${level}.json`))
  if (!file) throw new Error(`未找到 ${level} 诊断包文件`)
  const parsed: unknown = JSON.parse(readFileSync(join(getMetricsDir(projectDir), file), "utf8"))
  expectRecord(parsed)
  return parsed
}

describe("exportDiagnostics 分级导出", () => {
  test("L0 纯计数：只有七域聚合，无错误样本与复现序列，夹带字段不落盘", () => {
    seedSensitive()
    const result = exportDiagnostics(projectDir, "L0", T0)
    expect(result.level).toBe("L0")
    expect(result.sampleCount).toBe(0)
    expect(result.reproCount).toBe(0)

    const bundle = readBundle("L0")
    expect(bundle.level).toBe("L0")
    expect(bundle.error_samples).toBeUndefined()
    expect(bundle.repro_sequence).toBeUndefined()
    const counts: unknown = bundle.counts
    expectRecord(counts)
    const recall: unknown = counts["c3-recall"]
    expectRecord(recall)
    expect(expectNumber(recall["recall.route.entity"])).toBe(3)

    const raw = JSON.stringify(bundle)
    expect(raw).not.toContain(SECRET_TEXT)
    expect(raw).not.toContain(GENRE_VALUE)
  })

  test("L1 +脱敏错误分类样本：样本带类别、字符串截断、正文与题材值不落盘", () => {
    seedSensitive()
    const result = exportDiagnostics(projectDir, "L1", T0)
    expect(result.sampleCount).toBe(2)
    expect(result.reproCount).toBe(0)

    const bundle = readBundle("L1")
    const samples = expectArray(bundle.error_samples)
    expect(samples).toHaveLength(2)
    const s0: unknown = samples[0]
    expectRecord(s0)
    expect(s0.category).toBe("运行时失败")
    expect(s0.sessionId).toBe("s1")
    // 白名单外字段（text/genre/note/scene）整条丢弃
    expect(s0.text).toBeUndefined()
    const s1: unknown = samples[1]
    expectRecord(s1)
    expect(s1.category).toBe("提示词控制")
    expect(s1.agent).toBe("director")

    const raw = JSON.stringify(bundle)
    expect(raw).not.toContain(SECRET_TEXT)
    expect(raw).not.toContain(GENRE_VALUE)
    expect(bundle.repro_sequence).toBeUndefined()
  })

  test("L2 +复现事件序列：按时间排序、同走脱敏管道（红线：仍无正文），题材值仍不落盘", () => {
    seedSensitive()
    const result = exportDiagnostics(projectDir, "L2", T0)
    expect(result.reproCount).toBe(3)

    const bundle = readBundle("L2")
    const repro = expectArray(bundle.repro_sequence)
    expect(repro).toHaveLength(3)
    const tsValues = repro.map((e) => {
      expectRecord(e)
      return expectNumber(e.ts)
    })
    expect(tsValues).toEqual([T0, T0 + 1000, T0 + 2000])
    expect(bundle.error_samples).toBeDefined()

    const raw = JSON.stringify(bundle)
    expect(raw).not.toContain(SECRET_TEXT)
    expect(raw).not.toContain(GENRE_VALUE)
  })

  test("错误样本超 50 条截断并标记 truncated.samples", () => {
    mkdirSync(getMetricsDir(projectDir), { recursive: true })
    const lines = Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({ ts: T0 + i, domain: "c1-runtime", key: "tool.failed.novel_write", delta: 1 }),
    )
    appendFileSync(getMetricsPath(projectDir), lines.join("\n") + "\n")

    const result = exportDiagnostics(projectDir, "L1", T0)
    expect(result.sampleCount).toBe(50)
    expect(result.truncated.samples).toBe(true)
    const bundle = readBundle("L1")
    const truncated: unknown = bundle.truncated
    expectRecord(truncated)
    expect(truncated.samples).toBe(true)
  })
})

describe("evaluate 工具 export 子命令", () => {
  test("缺省 level=L1：输出分级说明且明示不含正文与题材值，metadata 带路径", async () => {
    seedSensitive()
    const result = await evaluateTools.evaluate.execute({ action: "export" }, createToolContext(projectDir))
    expect(result.title).toBe("evaluate export")
    expect(result.output).toContain("诊断包（L1）已落盘")
    expect(result.output).toContain("不含小说正文与题材值")
    expect(result.output).not.toContain("复现事件序列")
    if (typeof result === "string" || result.metadata === undefined) throw new Error("evaluate 工具应返回 metadata")
    expect(result.metadata.level).toBe("L1")
    expect(typeof result.metadata.path).toBe("string")
  })

  test("L2 输出必须含题材风险提示", async () => {
    seedSensitive()
    const result = await evaluateTools.evaluate.execute({ action: "export", level: "L2" }, createToolContext(projectDir))
    expect(result.output).toContain("可能含题材相关信息")
    expect(result.output).toContain("复现事件序列 3 条")
  })
})

describe("导出链路零网络静态检查", () => {
  test("evaluate 链路与工具源码无任何网络调用", () => {
    const evaluateDir = join(import.meta.dir, "../../src/novel-writer/evaluate")
    const files = [...readdirSync(evaluateDir).filter((f) => f.endsWith(".ts")), "../tools/evaluate.ts"]
    const pattern = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|https?\.request|new Request\s*\(/
    const offenders = files.filter((f) => pattern.test(readFileSync(join(evaluateDir, f), "utf8")))
    expect(offenders).toEqual([])
  })
})
