import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  aggregateMetrics,
  getMetricsPath,
  METRICS_SOFT_LIMIT_BYTES,
  readMetrics,
  recordMetrics,
} from "../../src/novel-writer/evaluate/metrics"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "evaluate-metrics-"))
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) }
}

describe("evaluate metrics", () => {
  test("recordMetrics 追加落盘且 readMetrics 原样读回", () => {
    using f = fixture()
    recordMetrics(f.dir, { domain: "c4-context", key: "budget.p2.trimmed", delta: 1 })
    recordMetrics(f.dir, { domain: "c4-context", key: "budget.p2.trimmed", delta: 2, sessionId: "s1", chapter: 3 })
    recordMetrics(f.dir, { domain: "c3-recall", key: "recall.entity.hits", delta: 5 })

    const { entries, corruptLines } = readMetrics(f.dir)
    expect(corruptLines).toBe(0)
    expect(entries).toHaveLength(3)
    expect(entries[0].ts).toBeTypeOf("number")
    expect(entries[1]).toMatchObject({ domain: "c4-context", key: "budget.p2.trimmed", delta: 2, sessionId: "s1", chapter: 3 })
  })

  test("aggregateMetrics 按域聚合且支持 fromTs 范围过滤", () => {
    using f = fixture()
    recordMetrics(f.dir, { domain: "c3-recall", key: "recall.entity.hits", delta: 5 })
    recordMetrics(f.dir, { domain: "c3-recall", key: "recall.fts.hits", delta: 3 })
    recordMetrics(f.dir, { domain: "c3-recall", key: "recall.entity.hits", delta: 1 })

    const { entries } = readMetrics(f.dir)
    const all = aggregateMetrics(entries)
    expect(all["c3-recall"]).toEqual({ "recall.entity.hits": 6, "recall.fts.hits": 3 })

    const cutoff = entries[1].ts + 1
    const ranged = aggregateMetrics(entries, cutoff)
    expect(ranged["c3-recall"]).toEqual({ "recall.entity.hits": 1 })
  })

  test("坏行被跳过并计数，不抛错", () => {
    using f = fixture()
    recordMetrics(f.dir, { domain: "c1-runtime", key: "tool.fail", delta: 1 })
    writeFileSync(getMetricsPath(f.dir), "not-json\n{\"ts\":\"x\"}\n", { flag: "a" })

    const { entries, corruptLines } = readMetrics(f.dir)
    expect(entries).toHaveLength(1)
    expect(corruptLines).toBe(2)
  })

  test("文件不存在时返回空结果", () => {
    using f = fixture()
    const { entries, corruptLines, overSoftLimit } = readMetrics(f.dir)
    expect(entries).toEqual([])
    expect(corruptLines).toBe(0)
    expect(overSoftLimit).toBe(false)
  })

  test("超过软上限时置 overSoftLimit", () => {
    using f = fixture()
    recordMetrics(f.dir, { domain: "c1-runtime", key: "tool.fail", delta: 1 })
    // 直接伪造大文件尺寸检查阈值逻辑：写入超限字节
    const path = getMetricsPath(f.dir)
    writeFileSync(path, " ".repeat(METRICS_SOFT_LIMIT_BYTES + 1), { flag: "a" })
    expect(readMetrics(f.dir).overSoftLimit).toBe(true)
  })

  test("埋点 IO 失败只 warn 不抛（目录不可写时）", () => {
    // Windows 上使目录不可写不可靠（ACL 语义不同），改为给一个文件路径当目录
    using f = fixture()
    writeFileSync(join(f.dir, "occupied"), "x")
    // occupied 是普通文件，mkdir 其子路径会 ENOTDIR——recordMetrics 应只 warn
    expect(() =>
      recordMetrics(join(f.dir, "occupied"), { domain: "c1-runtime", key: "tool.fail", delta: 1 }),
    ).not.toThrow()
  })
})
