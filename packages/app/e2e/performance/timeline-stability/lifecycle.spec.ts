// V2 化注记（timeline-stability-v2）：并行 shell 的错峰增长/结算走 tool.called + progress/success
// 交错帧（sendAll）；Thinking→reasoning→text 交接走 reasoning.*/text.* 帧序列；
// message 定稿走 step.ended，busy→idle 走 setBusy + 对账帧（session.next.updated）。
import { expect, test } from "@playwright/test"
import {
  defineVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import { v2Text, v2Tool, v2ToolRunning } from "../../utils/v2-fixture"
import {
  assistantMessage,
  reasoningDelta,
  reasoningEnded,
  reasoningStarted,
  sessionUpdated,
  setupTimeline,
  stepEnded,
  textDelta,
  textEnded,
  textStarted,
  textTurn,
  toolCalled,
  toolProgress,
  toolSuccess,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

test.describe("timeline visual lifecycle stability", () => {
  test("streams empty, short, and long parallel shells to staggered completion", async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const ids = ["prt_parallel_01_empty", "prt_parallel_02_short", "prt_parallel_03_long"] as const
    const followingID = "prt_parallel_04_following"
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [
            ...ids.map((id) =>
              v2Tool({ id, name: "bash", state: v2ToolRunning({ input: { command: `echo ${id}` } }) }),
            ),
            v2Text("Following all parallel shells.", followingID),
          ],
          { completed: false },
        ),
      ],
      settings: { shellToolPartsExpanded: true, showReasoningSummaries: true },
      cpuRate: 4,
      eventRetry: 24,
      seedHistory: true,
      active: true,
    })
    // 登记三个 call record（种子 running 无事件史，translator 需要 called 才保 tool/input）
    for (const id of ids) await timeline.send(toolCalled(id, "bash", { command: `echo ${id}` }), 30)
    for (const id of ids) await timeline.waitForPart(id)
    const scroller = page.locator(".scroll-view__viewport", {
      has: page.locator('[data-timeline-row="AssistantPart"]'),
    })
    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    const regions = defineVisualRegions({
      prt_shell_empty: shellRegion(ids[0]),
      prt_shell_short: shellRegion(ids[1]),
      prt_shell_long: shellRegion(ids[2]),
      following: shellRegion(followingID),
    })
    await waitForVisualSettle(page, [`[data-timeline-part-id="${followingID}"]`])
    const output = (id: string, text: string) => ({ title: `echo ${id}`, command: `echo ${id}`, output: text })
    await startVisualProbe(page, regions)
    await timeline.sendAll([
      { frame: toolSuccess(ids[0]!, { structured: output(ids[0]!, ""), content: [] }), delay: 180 },
      { frame: toolProgress(ids[2]!, output(ids[2]!, lines(10))), delay: 70 },
      { frame: toolProgress(ids[1]!, output(ids[1]!, lines(2))), delay: 110 },
      { frame: toolProgress(ids[2]!, output(ids[2]!, lines(25))), delay: 80 },
      {
        frame: toolSuccess(ids[1]!, {
          structured: output(ids[1]!, lines(2)),
          content: [{ type: "text", text: lines(2) }],
        }),
        delay: 260,
      },
      { frame: toolProgress(ids[2]!, output(ids[2]!, lines(50))), delay: 100 },
      {
        frame: toolSuccess(ids[2]!, {
          structured: output(ids[2]!, lines(50)),
          content: [{ type: "text", text: lines(50) }],
        }),
        delay: 450,
      },
      { frame: stepEnded(), delay: 100 },
    ])
    timeline.setBusy(false)
    await timeline.send(sessionUpdated(), 700)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "parallel-shells",
      trace,
      visualPlan(
        regions,
        [
          { type: "required", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long", "following"] },
          { type: "unique", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long"] },
          { type: "stable", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long", "following"] },
          { type: "opacity", regions: "all" },
          { type: "continuity", regions: "all" },
          { type: "motion", regions: "all", maxPositionReversals: 0, maxReversals: 4 },
          { type: "label-stability", regions: "all" },
          { type: "preserve-bottom-anchor" },
          { type: "flow", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long", "following"] },
        ],
        { perMarker: true },
      ),
    )
    await expect(page.locator(`[data-timeline-part-id="${ids[2]}"] [data-slot="bash-pre"]`)).toContainText("line 50")

    const short = page.locator(`[data-timeline-part-id="${ids[1]}"]`)
    // novel-live 对 step.ended 有 5s 防抖 invalidate：最后一次结算事件后 ~5s 工作区（含时间线）
    // 整页重挂，正好落在探针报告后的交互窗口内，自动 scroll-into-view 会被反复重挂空转到超时。
    // 先等旧节点离线确认重挂完成，再对新节点交互。
    const stale = await short.elementHandle()
    await page.waitForFunction((element) => !element?.isConnected, stale, { timeout: 15_000 })
    await stale?.dispose()
    await expect(short).toBeVisible()
    // autoScroll 的 ResizeObserver 在 userScrolled=false 时会把任何程序滚动拉回底部，
    // 而 userScrolled 只能由真实 wheel/touch 手势置位（程序 scrollTop 写不入）。先在
    // scroller 上派发一次上滚手势解除底部跟随，再居中定位点击（短 shell 在视口上方，
    // 最小滚动会把触发器停在 sticky 标题栏/bottom-spacer 下被拦截）。
    await scroller.evaluate((element) =>
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true })),
    )
    await short.evaluate((element) => element.scrollIntoView({ block: "center" }))
    await waitForVisualSettle(page, [`[data-timeline-part-id="${ids[1]}"]`, `[data-timeline-part-id="${followingID}"]`])
    await short.locator('[data-slot="collapsible-trigger"]').click()
    await expect(short.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
    for (const frame of textTurn({ textID: "prt_late_sibling", text: "A later sibling rerender." })) {
      await timeline.send(frame, 80)
    }
    await page.waitForTimeout(250)
    await expect(short.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
  })

  test("replaces thinking with streamed reasoning and text without a blank visible turn", async ({
    page,
  }, testInfo) => {
    const reasoningID = "prt_reasoning_visible"
    const textID = "prt_streamed_text"
    const finalText = "Starting **stable output** with `code` and [a link](https://example.com)."
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([], { completed: false })],
      settings: { showReasoningSummaries: true },
      cpuRate: 4,
      active: true,
    })
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()

    const regions = defineVisualRegions({
      thinking: { selector: '[data-timeline-row="Thinking"]' },
      reasoning: {
        selector: `[data-timeline-part-id="${reasoningID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
      text: { selector: `[data-timeline-part-id="${textID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    })
    await startVisualProbe(page, regions)
    // reasoning.started 先建空 part（空 reasoning 不渲染，Thinking 仍在）
    await timeline.send(reasoningStarted(reasoningID), 100)
    await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
    await timeline.send(reasoningDelta(reasoningID, "## Planning\n\nChecking the visible timeline."), 160)
    await timeline.send(reasoningEnded(reasoningID, "## Planning\n\nChecking the visible timeline."))
    await timeline.waitForPart(reasoningID)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await timeline.send(textStarted(textID), 100)
    await timeline.send(textDelta(textID, "Starting"), 90)
    await timeline.send(textDelta(textID, " **stable"), 90)
    await timeline.send(textDelta(textID, " output** with `code` and [a link"), 130)
    await timeline.send(textDelta(textID, "](https://example.com)."), 220)
    await timeline.send(textEnded(textID, finalText), 60)
    await timeline.send(stepEnded(), 120)
    timeline.setBusy(false)
    await timeline.send(sessionUpdated(), 500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "reasoning-text-handoff",
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["reasoning", "text"] },
        { type: "continuous-any", regions: ["thinking", "reasoning", "text"] },
        { type: "unique", regions: ["reasoning", "text"] },
        { type: "stable", regions: ["reasoning", "text"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxReversals: 4 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["reasoning", "text"] },
      ]),
    )
    await expect(page.locator(`[data-timeline-part-id="${textID}"]`)).toContainText("stable output")
  })
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function shellRegion(id: string) {
  return { selector: `[data-timeline-part-id="${id}"]`, closest: '[data-timeline-row="AssistantPart"]' }
}
