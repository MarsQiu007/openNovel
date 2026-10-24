import type { Page } from "@playwright/test"
import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import {
  buildInitialStreamEvent,
  buildStreamCloseEvents,
  buildStreamDeltaEvents,
  setupTimelineBenchmark,
  textPartID,
} from "./session-timeline-benchmark.fixture"
import { startTimelineProfile } from "./session-timeline-profile"
import { createReviewDiffs } from "./timeline-test-helpers"
import {
  collectTimelineStreamMetrics,
  installTimelineStreamProbe,
  startTimelineStreamProbe,
} from "./session-timeline-stream-probe"

type TimelineStreamOptions = {
  newLayoutDesigns?: boolean
  reviewDiffs?: boolean
  reviewPane?: boolean
}

type ReviewPaneSample = {
  observedAtMs: number
  panelVisible: boolean
  header: string
  diffViewers: number
  diffLines: number
  codeBlocks: number
  ready: boolean
}

type ReviewPaneProbe = {
  samples: ReviewPaneSample[]
  start: () => void
  stop: () => void
}

const reviewReadyStreak = 3

// 完成窗口单一来源（perf-benchmark-v2 D8）：四个流式场景的测试超时与完成等待共用
// 该默认值（测试超时 = 窗口 + 60s 收尾余量），避免两处默认值漂移导致窗口未到测试先死
const streamCompletionTimeoutMs = Number(process.env.TIMELINE_COMPLETION_TIMEOUT_MS ?? 900_000)

benchmark.describe("performance: session timeline streaming", () => {
  benchmark("streams assistant text without remounting or oscillating", async ({ page, report }) => {
    benchmark.setTimeout(streamCompletionTimeoutMs + 60_000)
    const result = await runTimelineStreamBenchmark(page, {})
    report(result.metrics, result.context)
  })

  benchmark("streams assistant text in v2 with review pane closed", async ({ page, report }) => {
    benchmark.setTimeout(streamCompletionTimeoutMs + 60_000)
    const result = await runTimelineStreamBenchmark(page, { newLayoutDesigns: true })
    report(result.metrics, result.context)
  })

  benchmark("streams assistant text in v2 with review diffs and pane closed", async ({ page, report }) => {
    benchmark.setTimeout(streamCompletionTimeoutMs + 60_000)
    const result = await runTimelineStreamBenchmark(page, { newLayoutDesigns: true, reviewDiffs: true })
    report(result.metrics, result.context)
  })

  benchmark("streams assistant text in v2 with review pane open", async ({ page, report }) => {
    benchmark.setTimeout(streamCompletionTimeoutMs + 60_000)
    const result = await runTimelineStreamBenchmark(page, { newLayoutDesigns: true, reviewPane: true })
    report(result.metrics, result.context)
  })
})

benchmark.describe("performance: review pane", () => {
  benchmark("loads v2 review diffs and switches active files", async ({ page, report }) => {
    benchmark.setTimeout(240_000)
    const historyTurns = Number(process.env.REVIEW_PANE_HISTORY_TURNS ?? 72)
    const diffs = createReviewDiffs()
    const fixture = await setupTimelineBenchmark(page, {
      historyTurns,
      eventBatch: 1,
      newLayoutDesigns: true,
      vcsDiff: diffs,
      // v2 检视预览的工具栏需要约 300px 才不折叠；默认视口下右栏被三区保底钳制，
      // 预览列会被压到 ~160px 导致"下一文件"按钮与分段控件重叠，故本场景使用更宽视口
      viewport: { width: 1920, height: 1080 },
      railWidth: 1400,
    })

    fixture.transport.enqueue(buildInitialStreamEvent(1))
    await expect(fixture.text).toBeVisible()
    await expect(fixture.text).toContainText("Implementation plan")
    await fixture.scrollToBottom()
    await fixture.waitForStableGeometry()

    const open = await measureReviewPaneLoad(page, diffs[0]!.file)
    const switches = []
    for (const diff of diffs.slice(1, 4)) switches.push(await measureReviewNextFile(page, diff.file))

    report(
      {
        open,
        switches,
      },
      {
        historyTurns,
        reviewDiffs: diffs.length,
      },
    )
  })
})

async function runTimelineStreamBenchmark(page: Page, options: TimelineStreamOptions) {
  // V2 化默认值重调（perf-benchmark-v2 D8）：实测 V2 运行时下每个 delta 应用约 0.1s CPU
  // （320 turns 规模，CDP profile 热点在虚拟滚动器的行重测），30× 节流下典型 2-3s
  // 墙钟/事件，但机器状态差时同参数吞吐劣化可达 26 倍（实测 27s/事件）。160 deltas
  // 远超完成窗口；降为 20 并把完成窗口放宽到 900s，使典型（约 1 分钟）与劣化
  // （约 9 分钟）两种模式都收敛，测量形态（30× 节流 + 320 turns + 每 delta 应用
  // 延迟/rAF 间隙采集）不变。
  const completionTimeoutMs = streamCompletionTimeoutMs
  const cpuThrottle = Number(process.env.TIMELINE_CPU_THROTTLE ?? 30)
  const deltaCount = Number(process.env.TIMELINE_DELTA_COUNT ?? 20)
  const historyTurns = Number(process.env.TIMELINE_HISTORY_TURNS ?? 320)
  const eventBatch = Number(process.env.TIMELINE_EVENT_BATCH ?? 1)
  const minimal = process.env.TIMELINE_MINIMAL === "1"
  const profileCPU = process.env.TIMELINE_CPU_PROFILE === "1"
  const profileVisual = !minimal && profileCPU && process.env.TIMELINE_VISUAL_PROFILE !== "0"
  const diffs = options.reviewDiffs || options.reviewPane ? createReviewDiffs() : undefined
  const fixture = await setupTimelineBenchmark(page, {
    historyTurns,
    eventBatch,
    newLayoutDesigns: options.newLayoutDesigns,
    // V2 下 turn 级 summary.diffs 在 adapter 层已无通路；会话级 diff（/api/session/{id}/diff）
    // 是等价的数据成本通路。pane-open 场景走默认 git 模式（/vcs/diff）以跨检视实现通用。
    // FileDiff 契约为 {path, status, additions, deletions, patch}，createReviewDiffs 的 file 键在此映射
    v2Diff: options.reviewDiffs
      ? diffs.map((diff) => ({
          path: diff.file,
          status: diff.status,
          additions: diff.additions,
          deletions: diff.deletions,
          patch: diff.patch,
        }))
      : undefined,
    vcsDiff: options.reviewPane ? diffs : undefined,
  })

  fixture.transport.enqueue(buildInitialStreamEvent(deltaCount))
  const contentStart = performance.now()
  await expect(fixture.text).toBeVisible()
  await expect(fixture.text).toContainText("Implementation plan")
  const initialContentObservedMs = performance.now() - contentStart
  await fixture.scrollToBottom()
  await fixture.waitForStableGeometry()

  const reviewPane = options.reviewPane && diffs ? await measureReviewPaneLoad(page, diffs[0]!.file) : undefined
  if (reviewPane) await fixture.waitForStableGeometry()

  const profile = await startTimelineProfile(page, { cpuThrottle, profileCPU })
  await installTimelineStreamProbe(page, { textPartID, finalIndex: deltaCount, profileVisual, minimal })
  const deltas = buildStreamDeltaEvents(deltaCount)
  await startTimelineStreamProbe(page)
  fixture.transport.enqueue(deltas)

  await page.waitForFunction(
    (finalIndex) =>
      (
        window as Window & {
          __timelineStreamBenchmark?: { applied: { index: number }[] }
        }
      ).__timelineStreamBenchmark?.applied.some((value) => value.index === finalIndex),
    deltaCount,
    { timeout: completionTimeoutMs },
  )
  await expect(fixture.text).toContainText("benchmark-complete")
  await expect(fixture.text).toContainText("Streaming")
  await fixture.waitForStableGeometry()
  const metrics = await collectTimelineStreamMetrics(page, {
    textPartID,
    finalIndex: deltaCount,
    navigations: benchmarkDiagnostics(page).navigations,
  })
  const delivered = deltas.length - fixture.transport.pendingCount()
  // 收尾帧在指标采集后投递：结束在制回合（触发 diff 拉取），又不摊薄 deliveredDeltas 口径
  fixture.transport.enqueue(buildStreamCloseEvents(deltaCount))
  await profile.stop()

  const result = {
    metrics: {
      endToEndInitialContentObservedMs: initialContentObservedMs,
      ...metrics,
      deliveredDeltas: delivered,
      pendingDeltas: fixture.transport.pendingCount(),
      reviewPane: reviewPane ?? null,
    },
    context: {
      cpuThrottle,
      profileCPU,
      profileVisual,
      minimal,
      queuedDeltas: deltas.length,
      historyTurns,
      eventBatch,
      newLayoutDesigns: true,
      reviewPane: options.reviewPane === true ? "open" : "closed",
      reviewDiffs: diffs?.length ?? 0,
    },
  }

  await profile.reset()
  return result
}

async function measureReviewPaneLoad(page: Page, file: string) {
  // Default git mode reads the mocked /vcs/diff data, so opening the pane is enough
  // and the flow works across review pane implementations.
  await installReviewPaneProbe(page, { file })
  await startReviewPaneProbe(page)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(page.locator("#review-panel")).toBeVisible()
  return collectReviewPaneProbe(page)
}

async function measureReviewNextFile(page: Page, file: string) {
  await installReviewPaneProbe(page, { file })
  await startReviewPaneProbe(page)
  await page.getByRole("button", { name: "Next file" }).click()
  return collectReviewPaneProbe(page)
}

async function installReviewPaneProbe(page: Page, input: { file: string }) {
  await page.evaluate((input) => {
    const samples: ReviewPaneSample[] = []
    const basename = input.file.split(/[\\/]/).at(-1) ?? input.file
    let started: number | undefined
    let running = true

    const paneState = () => {
      const panel = document.querySelector<HTMLElement>("#review-panel")
      const review = panel?.querySelector<HTMLElement>('[data-component="session-review-v2"]')
      const rect = (review ?? panel)?.getBoundingClientRect()
      const text = panel?.textContent ?? ""
      const previewHeader = panel?.querySelector<HTMLElement>(
        '[data-slot="session-review-v2-file-header"]',
      )?.textContent
      const header = previewHeader ?? text
      const viewers = panel ? [...panel.querySelectorAll<HTMLElement>('[data-component="file"][data-mode="diff"]')] : []
      const codeBlocks = panel?.querySelectorAll("code").length ?? 0
      const diffLines = viewers.reduce(
        (sum, viewer) =>
          sum +
          (viewer.shadowRoot?.querySelectorAll("[data-line]").length ?? viewer.querySelectorAll("[data-line]").length),
        0,
      )
      const panelVisible =
        !!panel && panel.getAttribute("aria-hidden") !== "true" && !!rect && rect.width > 0 && rect.height > 0
      return {
        panelVisible,
        header: header.slice(0, 500),
        diffViewers: viewers.length,
        diffLines,
        codeBlocks,
        ready:
          panelVisible &&
          header.includes(basename) &&
          (viewers.length > 0 || text.includes("+3") || diffLines > 0 || codeBlocks > 0),
      }
    }

    const sample = () => {
      if (!running || started === undefined) return
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!running || started === undefined) return
          samples.push({ observedAtMs: performance.now() - started, ...paneState() })
          if (performance.now() - started < 10_000) sample()
        }, 0)
      })
    }

    ;(window as Window & { __reviewPaneProbe?: ReviewPaneProbe }).__reviewPaneProbe = {
      samples,
      start: () => {
        started = performance.now()
        performance.mark("opennovel.review-pane.click")
        sample()
      },
      stop: () => {
        running = false
      },
    }
  }, input)
}

async function startReviewPaneProbe(page: Page) {
  await page.evaluate(() => {
    ;(window as Window & { __reviewPaneProbe?: ReviewPaneProbe }).__reviewPaneProbe!.start()
  })
}

async function collectReviewPaneProbe(page: Page) {
  await page.waitForFunction((streak) => {
    const samples = (window as Window & { __reviewPaneProbe?: ReviewPaneProbe }).__reviewPaneProbe?.samples
    if (!samples) return false
    return samples.some((_, index) => {
      const stable = samples.slice(index, index + streak)
      return stable.length === streak && stable.every((sample) => sample.ready)
    })
  }, reviewReadyStreak)

  const samples = await page.evaluate(() => {
    const probe = (window as Window & { __reviewPaneProbe?: ReviewPaneProbe }).__reviewPaneProbe!
    probe.stop()
    return probe.samples
  })
  return { summary: summarizeReviewPaneSamples(samples), samples }
}

function summarizeReviewPaneSamples(samples: ReviewPaneSample[]) {
  const firstReady = samples.find((sample) => sample.ready)
  const stableIndex = samples.findIndex((_, index) => {
    const stable = samples.slice(index, index + reviewReadyStreak)
    return stable.length === reviewReadyStreak && stable.every((sample) => sample.ready)
  })
  return {
    samples: samples.length,
    firstReadyObservedMs: firstReady?.observedAtMs ?? null,
    stableReadyObservedMs: stableIndex === -1 ? null : samples[stableIndex + reviewReadyStreak - 1]!.observedAtMs,
    notReadySamples: samples.filter((sample) => !sample.ready).length,
    maxDiffViewers: Math.max(0, ...samples.map((sample) => sample.diffViewers)),
    maxDiffLines: Math.max(0, ...samples.map((sample) => sample.diffLines)),
    maxCodeBlocks: Math.max(0, ...samples.map((sample) => sample.codeBlocks)),
  }
}
