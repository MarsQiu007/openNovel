/**
 * 自评价报告生成器（2.1）——确定性测试
 *
 * 主 fixture 用固定时钟断完整文本；窗口类用真实时钟 + 手工状态推进。
 * 覆盖：三分部结构、B 部规则命中与不编造、空数据报告、since-last 状态窗口、
 * 本卷范围过滤、最近 N 会话范围过滤。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeDb, getDb, NovelTable, ChapterTable, VolumeTable } from "../../src/novel-writer/session-store.js"
import { recordMetricsBatch, getMetricsDir, getMetricsPath } from "../../src/novel-writer/evaluate/metrics.js"
import { generateReport } from "../../src/novel-writer/evaluate/report.js"

let projectDir: string
const NOW = new Date(2026, 10, 6, 12, 0, 0).getTime()

beforeEach(() => {
  projectDir = join(tmpdir(), `eval-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

/** 造一条命中 B1/B3/B4/B6 与失败分类法的窗口内数据 */
function seedWindowEntries() {
  recordMetricsBatch(projectDir, [
    { domain: "c4-context", key: "budget.p2.trimmed", delta: 1200 },
    { domain: "c4-context", key: "budget.p4.occupied", delta: 800 },
    { domain: "c5-flow", key: "version.rollback", delta: 2 },
    { domain: "c2-prompt-control", key: "approval.requested", delta: 3 },
    { domain: "c2-prompt-control", key: "approval.rejected", delta: 2 },
    { domain: "c7-narrative", key: "hook.warning.face_slap", delta: 1 },
    { domain: "c7-narrative", key: "continuity.dim.姓名一致性.fail", delta: 1 },
    { domain: "c7-narrative", key: "structure.issue.arc_empty", delta: 1 },
    { domain: "c1-runtime", key: "tool.failed.write_chapter", delta: 4 },
  ])
}

describe("generateReport 三分部报告", () => {
  test("窗口内数据：A/B/C 分部齐全，命中规则逐条输出且全文确定性", () => {
    seedWindowEntries()
    // B5 需要窗口内模式切换审计。指标条目由 recordEvaluateMetrics 以真实时钟打戳，
    // mode 行时间戳必须取自同一真实时钟、落在指标之后且早于 now 参数；
    // 用固定 NOW 派生会在真实日期越过 NOW 后整段落窗外（2026-11-07 起必红）
    const modeBase = Date.now()
    mkdirSync(join(projectDir, ".novel", "audit"), { recursive: true })
    writeFileSync(
      join(projectDir, ".novel", "audit", "mode.jsonl"),
      [1, 2, 3, 4].map((i) => JSON.stringify({ ts: modeBase + 10 + i, before: {}, after: {}, patch: { writing_mode: `m${i}` } })).join("\n") + "\n",
    )

    const result = generateReport(projectDir, { kind: "all" }, modeBase + 1000)

    expect(result.entryCount).toBe(9)
    expect(result.path.endsWith("-all.md")).toBe(true)
    expect(readFileSync(result.path, "utf8")).toBe(result.markdown)

    // A 部：卡壳地图/结构风险/批注密度三小节，数据行可核
    expect(result.markdown).toContain("## A. 创作复盘")
    expect(result.markdown).toContain("- 版本回滚：2 次")
    expect(result.markdown).toContain("拒绝率 67%")
    expect(result.markdown).toContain("连续性 FAIL：姓名一致性 × 1")
    // B 部：六条规则全命中（含 mode.jsonl 的 4 次切换）
    expect(result.markdown).toContain("## B. 配置优化建议")
    expect(result.markdown).toContain("[B1] P2（近期章节摘要）发生 1200 token 裁剪")
    expect(result.markdown).toContain("[B3] 版本回滚出现 2 次")
    expect(result.markdown).toContain("[B4] 审批拒绝率 67% 偏高")
    expect(result.markdown).toContain("[B5] 写作模式窗口内切换 4 次")
    expect(result.markdown).toContain("[B6] 钩子类型连续单一触发 1 次警告")
    // C 部：七域表 + 失败分类法 + Top 复现
    expect(result.markdown).toContain("## C. 产品信号")
    expect(result.markdown).toContain("- C1 运行时：合计 4")
    expect(result.markdown).toContain("  - tool.failed.write_chapter × 4")
    expect(result.markdown).toContain("- 运行时失败：4")
    expect(result.markdown).toContain("- 叙事风险：3")
    expect(result.markdown).toContain("- tool.failed.write_chapter × 4（c1-runtime）")
  })

  test("空数据报告：三分部都说不编造，B 部无建议", () => {
    const result = generateReport(projectDir, { kind: "all" }, NOW)
    expect(result.entryCount).toBe(0)
    expect(result.markdown).toContain("暂无数据（窗口内无回滚/审批/版本对比记录）")
    expect(result.markdown).toContain("本轮无配置建议（规则均未命中或窗口内无数据）")
    expect(result.markdown).toContain("### 七域计数表\n- 暂无数据。")
    expect(result.markdown).toContain("窗口内无可归类失败信号。")
    // 不编造：不出现任何带数字的建议行
    expect(result.markdown).not.toContain("[B1]")
  })

  test("since-last：首报=全部，随后空窗，新数据只进新窗口", () => {
    seedWindowEntries()
    const first = generateReport(projectDir, { kind: "since-last" }, Date.now())
    expect(first.entryCount).toBe(9)

    // 同一时刻立即再报：窗口为空
    const second = generateReport(projectDir, { kind: "since-last" }, Date.now())
    expect(second.entryCount).toBe(0)
    expect(second.markdown).toContain("本轮无配置建议")

    // 手工推进状态到当前，再入一条新数据：只统计新条目。
    // 直接写 JSONL 并以 lastRunTs+1 作时间戳：Windows 时钟粒度粗（~15.6ms），
    // 真实 Date.now() 可能与状态时间戳同毫秒而被 `e.ts > lastRunTs` 排除（时序 flake）
    writeFileSync(
      join(getMetricsDir(projectDir), "last-report.json"),
      JSON.stringify({ lastRunTs: Date.now(), path: first.path }) + "\n",
    )
    const state: unknown = JSON.parse(
      readFileSync(join(getMetricsDir(projectDir), "last-report.json"), "utf8"),
    )
    if (typeof state !== "object" || state === null || !("lastRunTs" in state) || typeof state.lastRunTs !== "number") {
      throw new Error("报告状态文件格式异常")
    }
    const { lastRunTs } = state
    appendFileSync(
      getMetricsPath(projectDir),
      JSON.stringify({ ts: lastRunTs + 1, domain: "c5-flow", key: "version.rollback", delta: 1 }) + "\n",
    )
    const third = generateReport(projectDir, { kind: "since-last" }, Date.now())
    expect(third.entryCount).toBe(1)
    expect(third.markdown).toContain("- 版本回滚：1 次")
  })

  test("本卷范围：只统计当前卷章节条目与无章节全局条目", () => {
    const db = getDb(projectDir)
    const now = Date.now()
    db.insert(NovelTable).values({ id: "novel-1", title: "报告书", genre: "玄幻", synopsis: "", status: "draft", created_at: now, updated_at: now }).run()
    db.insert(VolumeTable).values({ id: "vol-1", novel_id: "novel-1", title: "第一卷", order: 1 }).run()
    db.insert(VolumeTable).values({ id: "vol-2", novel_id: "novel-1", title: "第二卷", order: 2 }).run()
    db.insert(ChapterTable).values({ id: "ch-1", novel_id: "novel-1", volume_id: "vol-1", title: "第一章", content: "", word_count: 0, status: "final", order: 1, created_at: now, updated_at: now }).run()
    db.insert(ChapterTable).values({ id: "ch-2", novel_id: "novel-1", volume_id: "vol-2", title: "第二章", content: "", word_count: 0, status: "draft", order: 2, created_at: now, updated_at: now }).run()

    recordMetricsBatch(projectDir, [
      { domain: "c5-flow", key: "version.rollback", delta: 1, chapter: 1 },
      { domain: "c5-flow", key: "version.rollback", delta: 5, chapter: 2 },
      { domain: "c1-runtime", key: "session.created", delta: 1 },
    ])

    const result = generateReport(projectDir, { kind: "volume" }, NOW)
    // 当前卷 = 第二卷（最新章 ch-2 所属）：章 2 的 5 次 + 无章节的全局条目 1 条
    expect(result.markdown).toContain("- 版本回滚：5 次")
    expect(result.markdown).not.toContain("- 版本回滚：6 次")
  })

  test("最近 N 会话范围：只统计最近 N 个会话的条目", () => {
    // 直接造 JSONL 以控制条目时间戳与会话归属
    const lines = [
      { ts: NOW - 3000, domain: "c1-runtime", key: "step.tokens.input", delta: 100, sessionId: "s-oldest" },
      { ts: NOW - 2000, domain: "c1-runtime", key: "step.tokens.input", delta: 200, sessionId: "s-mid" },
      { ts: NOW - 1000, domain: "c1-runtime", key: "step.tokens.input", delta: 400, sessionId: "s-new" },
    ].map((e) => JSON.stringify(e))
    mkdirSync(getMetricsDir(projectDir), { recursive: true })
    writeFileSync(getMetricsPath(projectDir), lines.join("\n") + "\n")

    const result = generateReport(projectDir, { kind: "sessions", count: 2 }, NOW)
    expect(result.markdown).toContain("step.tokens.input × 600")
    expect(result.markdown).not.toContain("× 700")
  })
})
