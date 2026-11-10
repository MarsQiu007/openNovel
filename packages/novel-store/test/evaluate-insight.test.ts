/**
 * 工具改进日志文件底座测试：JSONL 追加/读取、撕裂尾部隔离修复、IO 降级。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import {
  appendToolInsightJsonl,
  readToolInsightJsonl,
  repairToolInsightTail,
  toolInsightIssuePath,
  toolInsightPaths,
} from "../src/evaluate-insight"

let logRoot: string

beforeEach(() => {
  logRoot = join(tmpdir(), `tool-insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(logRoot, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(logRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 文件占用由进程退出回收
  }
})

describe("toolInsightPaths", () => {
  test("固定布局路径解析", () => {
    const paths = toolInsightPaths(logRoot)
    expect(paths.evidence).toBe(join(logRoot, "evidence.jsonl"))
    expect(toolInsightIssuePath(paths, "fp123")).toBe(join(logRoot, "issues", "fp123.md"))
    expect(paths.index).toBe(join(logRoot, "index.md"))
    expect(paths.recoveryDir).toBe(join(logRoot, "recovery"))
    expect(paths.locksDir).toBe(join(logRoot, "locks"))
  })
})

describe("appendToolInsightJsonl", () => {
  test("追加写与整读回原", () => {
    const paths = toolInsightPaths(logRoot)
    appendToolInsightJsonl(paths.evidence, [{ id: "evi_a", kind: "tool_failed" }])
    appendToolInsightJsonl(paths.evidence, [{ id: "evi_b", kind: "user_report" }])
    const read = readToolInsightJsonl(paths.evidence)
    expect(read.entries).toEqual([
      { id: "evi_a", kind: "tool_failed" },
      { id: "evi_b", kind: "user_report" },
    ])
    expect(read.corruptLines).toBe(0)
    expect(read.tailIncomplete).toBe(false)
  })

  test("空记录不触碰文件系统", () => {
    const paths = toolInsightPaths(logRoot)
    appendToolInsightJsonl(paths.evidence, [])
    expect(readToolInsightJsonl(paths.evidence).fileSize).toBe(0)
  })

  test("目录不可写时降级为警告，不抛出", () => {
    // 以文件路径当父目录：mkdir 必然失败
    const blocker = join(logRoot, "blocker")
    writeFileSync(blocker, "x")
    const badPath = join(blocker, "evidence.jsonl")
    expect(() => appendToolInsightJsonl(badPath, [{ id: "evi_c" }])).not.toThrow()
  })
})

describe("readToolInsightJsonl 损坏判定", () => {
  test("缺失文件视为空日志", () => {
    const read = readToolInsightJsonl(join(logRoot, "missing.jsonl"))
    expect(read.entries).toEqual([])
    expect(read.corruptLines).toBe(0)
    expect(read.tailIncomplete).toBe(false)
  })

  test("仅最后一行撕裂：tailIncomplete 为真，完好历史不丢", () => {
    const paths = toolInsightPaths(logRoot)
    writeFileSync(paths.evidence, '{"id":"evi_a"}\n{"id":"evi_b"')
    const read = readToolInsightJsonl(paths.evidence)
    expect(read.entries).toEqual([{ id: "evi_a" }])
    expect(read.corruptLines).toBe(0)
    expect(read.tailIncomplete).toBe(true)
  })

  test("中部损坏：corruptLines 为真且不当作尾部", () => {
    const paths = toolInsightPaths(logRoot)
    writeFileSync(paths.evidence, '{"id":"evi_a"}\n{{{broken\n{"id":"evi_c"}\n')
    const read = readToolInsightJsonl(paths.evidence)
    expect(read.entries).toEqual([{ id: "evi_a" }, { id: "evi_c" }])
    expect(read.corruptLines).toBe(1)
    expect(read.tailIncomplete).toBe(false)
  })
})

describe("repairToolInsightTail", () => {
  test("撕裂尾部先隔离再截断，恢复后可正常追加", () => {
    const paths = toolInsightPaths(logRoot)
    writeFileSync(paths.evidence, '{"id":"evi_a"}\n{"id":"evi_b"')
    expect(repairToolInsightTail(paths, paths.evidence)).toBe(true)

    const read = readToolInsightJsonl(paths.evidence)
    expect(read.entries).toEqual([{ id: "evi_a" }])
    expect(read.tailIncomplete).toBe(false)

    // 撕裂字节进入 recovery 目录，不作为分享材料，也不丢历史
    expect(readdirSync(paths.recoveryDir)).toHaveLength(1)

    appendToolInsightJsonl(paths.evidence, [{ id: "evi_c" }])
    expect(
      readToolInsightJsonl(paths.evidence).entries.map((entry) =>
        typeof entry === "object" && entry !== null ? Reflect.get(entry, "id") : undefined,
      ),
    ).toEqual(["evi_a", "evi_c"])
  })

  test("无撕裂时修复为幂等 no-op", () => {
    const paths = toolInsightPaths(logRoot)
    writeFileSync(paths.evidence, '{"id":"evi_a"}\n')
    expect(repairToolInsightTail(paths, paths.evidence)).toBe(true)
    expect(readToolInsightJsonl(paths.evidence).entries).toEqual([{ id: "evi_a" }])
  })
})
