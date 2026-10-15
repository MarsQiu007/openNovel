import type { Page } from "@playwright/test"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../../utils/novel-workspace"
import { benchmark, expect } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import { createReviewDiffs, installTimelineSettings, mockStressTimeline } from "./timeline-test-helpers"

type StagingTransition = { t: number; content: boolean; review: boolean }
type StagingSnapshot = {
  transitions: StagingTransition[]
  firstContentMs: number | null
  firstReviewMs: number | null
  completed: boolean
  stopped: boolean
}
type StagingResult = StagingSnapshot & { contentBeforeReview: boolean }

benchmark.describe("performance: session open staging", () => {
  benchmark("stages the review body after cold session content", async ({ page, report }) => {
    benchmark.setTimeout(120_000)
    await setup(page)
    const result = await collectStagingProbe(page)
    report(result)
    expect(result.contentBeforeReview).toBe(true)
    await expect(page.locator('[data-component="session-review-v2"]')).toBeVisible()
  })
})

// 冷会话打开：书内工作台冷加载目标会话，检视栏预置为打开，
// 采样"内容先于 review 正文渲染"的过渡（旧 home / 标签入口退役后的等价场景）。
async function setup(page: Page) {
  await mockStressTimeline(page, { vcsDiff: createReviewDiffs() })
  await installTimelineSettings(page)
  await mockNovelWorkspaceAPIs(page, {
    directory: fixture.directory,
    novelID: fixture.novelID,
    boundSessionIDs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })
  await page.addInitScript(() => {
    // 检视栏（review 面板）默认收起，需预置为打开才有 review 正文可被分阶段渲染
    localStorage.setItem(
      "opennovel.global.dat:layout",
      JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
    )
  })
  await page.addInitScript(
    ({ contentSelector }: { contentSelector: string }) => {
      const transitions: StagingTransition[] = []
      let firstContentMs: number | null = null
      let firstReviewMs: number | null = null
      let completed = false
      let stopped = false
      const started = performance.now()
      const read = () => ({
        content: !!document.querySelector(contentSelector),
        review: !!document.querySelector('[data-component="session-review"], [data-component="session-review-v2"]'),
      })
      const record = () => {
        if (stopped) return
        const state = read()
        const last = transitions.at(-1)
        if (last && last.content === state.content && last.review === state.review) return
        const t = performance.now() - started
        transitions.push({ t, ...state })
        if (state.content && firstContentMs === null) firstContentMs = t
        if (state.review && firstReviewMs === null) firstReviewMs = t
        if (state.content && state.review) {
          completed = true
          stopped = true
        }
      }
      // DOM 变更与帧双通道采样：单帧采样可能漏掉"仅内容"的过渡窗口
      new MutationObserver(record).observe(document, { childList: true, subtree: true })
      const tick = () => {
        if (stopped) return
        record()
        if (performance.now() - started > 30_000) {
          stopped = true
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      ;(window as Window & { __stagingProbe?: unknown }).__stagingProbe = {
        snapshot: () => ({ transitions, firstContentMs, firstReviewMs, completed, stopped }),
      }
    },
    { contentSelector: `[data-message-id="${fixture.expected.targetMessageIDs.at(-1)!}"]` },
  )
  await page.goto(novelWorkspaceURL(fixture.directory, fixture.novelID, fixture.targetID))
}

async function collectStagingProbe(page: Page): Promise<StagingResult> {
  await page.waitForFunction(
    () => {
      const probe = (
        window as Window & { __stagingProbe?: { snapshot: () => { completed: boolean; stopped: boolean } } }
      ).__stagingProbe
      const snapshot = probe?.snapshot()
      return !!snapshot && (snapshot.completed || snapshot.stopped)
    },
    undefined,
    { timeout: 35_000 },
  )
  const snapshot = await page.evaluate(
    () => (window as Window & { __stagingProbe: { snapshot: () => StagingSnapshot } }).__stagingProbe.snapshot(),
  )
  return {
    ...snapshot,
    contentBeforeReview: snapshot.transitions.some((transition) => transition.content && !transition.review),
  }
}
