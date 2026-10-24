// V2 化注记（timeline-stability-v2）：shell 输出增长改走 tool.progress 的 structured（metadata 透传），
// 完成态走 tool.success（content 序列化为 output）。translator 的 tool.progress 对未知 callID
// 退化为 tool:""，故运行中 shell 一律由 tool.called 帧开场，不种子 running 态。
import { expect, test } from "@playwright/test"
import {
  defineVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import { v2Text, v2Tool, v2ToolCompleted, v2ToolRunning } from "../../utils/v2-fixture"
import {
  assistantMessage,
  prompted,
  setupTimeline,
  stepStarted,
  textTurn,
  toolCalled,
  toolProgress,
  toolSuccess,
  userMessage,
} from "./fixture"

test("does not reverse visible rows when the user wheels during shell remeasurement", async ({ page }, testInfo) => {
  const shellID = "prt_wheel_01_shell"
  const followingID = "prt_wheel_02_following"
  const command = "fixture-shell"
  const timeline = await setupTimeline(page, {
    messages: history(12),
    settings: { shellToolPartsExpanded: true },
    cpuRate: 4,
    reducedMotion: true,
    seedHistory: true,
    active: true,
  })
  await startShellTurn(timeline, shellID, followingID, "Following wheel interaction", command)
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(toolProgress(shellID, shellState(command, lines(30))), 80)
  await scroller.evaluate((element) =>
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -180 })),
  )
  await scroller.evaluate((element) => (element.scrollTop -= 180))
  await timeline.send(toolProgress(shellID, shellState(command, lines(50))), 250)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "wheel-during-resize", trace, rowPairPlan(regions, 1))
})

test("keeps moving upward while drag-selecting above the timeline", async ({ page }) => {
  await setupTimeline(page, {
    messages: history(80),
    viewport: { width: 1400, height: 700 },
    reducedMotion: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const text = page.getByText("History 79.", { exact: false })
  await expect(text).toBeVisible()
  await scroller.evaluate((element) => {
    element.dataset.selectionLength = "0"
    document.addEventListener("selectionchange", () => {
      element.dataset.selectionLength = String(
        Math.max(Number(element.dataset.selectionLength), window.getSelection()?.toString().length ?? 0),
      )
    })
  })
  const textBox = await text.boundingBox()
  const scrollBox = await scroller.boundingBox()
  expect(textBox).not.toBeNull()
  expect(scrollBox).not.toBeNull()
  if (!textBox || !scrollBox) return

  await page.mouse.move(textBox.x + textBox.width - 10, textBox.y + textBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(textBox.x + 20, scrollBox.y - 120, { steps: 30 })

  await expect.poll(() => scroller.evaluate((element) => Number(element.dataset.selectionLength))).toBeGreaterThan(0)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeGreaterThan(500)
  await page.mouse.up()
})

test("does not pull a keyboard-scrolled user during shell remeasurement", async ({ page }, testInfo) => {
  const shellID = "prt_keyboard_01_shell"
  const followingID = "prt_keyboard_02_following"
  const command = "fixture-shell"
  const timeline = await setupTimeline(page, {
    messages: history(12),
    settings: { shellToolPartsExpanded: true },
    cpuRate: 4,
    active: true,
  })
  await startShellTurn(timeline, shellID, followingID, "Following keyboard interaction", command)
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  await scroller.focus()
  for (let index = 0; index < 3; index++) {
    await scroller.press("PageUp")
    await page.waitForTimeout(250)
  }
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop), {
      timeout: 20_000,
    })
    .toBeGreaterThan(80)
  await page.waitForFunction(() => {
    const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
      element.querySelector("[data-timeline-row]"),
    )
    if (!root) return false
    return new Promise<boolean>((resolve) => {
      const top = root.scrollTop
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(root.scrollTop - top) <= 0.5)))
    })
  })
  const anchor = await scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    return [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top >= view.top + 40 && rect.bottom <= view.bottom - 40
    })?.dataset.timelineKey
  })
  expect(anchor).toBeTruthy()
  const regions = defineVisualRegions({
    anchor: { selector: `[data-timeline-key="${anchor}"]` },
  })
  await startVisualProbe(page, regions)
  await timeline.send(toolProgress(shellID, shellState(command, lines(50))), 400)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "keyboard-during-resize", trace, anchorPlan(regions))
})

test("tracks keyboard scrolling from a focused timeline descendant", async ({ page }, testInfo) => {
  const shellID = "prt_descendant_keyboard_01_shell"
  const command = "fixture-shell"
  await setupTimeline(page, {
    messages: [
      ...history(12),
      userMessage(),
      assistantMessage([completedShell(shellID, command, lines(5))]),
    ],
    settings: { shellToolPartsExpanded: false },
    cpuRate: 4,
    reducedMotion: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const row = page.locator(`[data-timeline-part-id="${shellID}"]`).first()
  const trigger = page.locator(`[data-timeline-part-id="${shellID}"] [data-slot="collapsible-trigger"]`)
  await row.evaluate((element) => element.setAttribute("tabindex", "0"))
  await row.focus()
  for (let index = 0; index < 3; index++) {
    await row.press("PageUp")
    await page.waitForTimeout(250)
  }
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeGreaterThan(5)
  const anchor = await scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    return [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top >= view.top + 40 && rect.bottom <= view.bottom - 40
    })?.dataset.timelineKey
  })
  expect(anchor).toBeTruthy()
  const regions = defineVisualRegions({
    anchor: { selector: `[data-timeline-key="${anchor}"]` },
  })
  await startVisualProbe(page, regions)
  await trigger.click()
  await page.waitForTimeout(300)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "descendant-keyboard-resize", trace, anchorPlan(regions))
})

test("does not claim keyboard scrolling owned by a nested scrollable", async ({ page }) => {
  const shellID = "prt_nested_keyboard_shell"
  const command = "fixture-shell"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([completedShell(shellID, command, lines(50))])],
    settings: { shellToolPartsExpanded: true },
    cpuRate: 4,
    reducedMotion: true,
    seedHistory: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const nested = page.locator(`[data-timeline-part-id="${shellID}"] [data-scrollable]`)
  await nested.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await nested.focus()
  await page.waitForFunction(() => {
    const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
      element.querySelector("[data-timeline-row]"),
    )
    if (!root) return false
    return new Promise<boolean>((resolve) => {
      const top = root.scrollTop
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(root.scrollTop - top) <= 0.5)))
    })
  })
  const before = await scroller.evaluate((element) => element.scrollTop)
  const nestedBefore = await nested.evaluate((element) => element.scrollTop)
  await nested.press("PageUp")
  await page.waitForTimeout(300)
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before)
  expect(await nested.evaluate((element) => element.scrollTop)).toBeLessThan(nestedBefore)

  await nested.evaluate((element) => (element.scrollTop = 0))
  await scroller.evaluate((element) => (element.scrollTop = Math.min(300, element.scrollHeight - element.clientHeight)))
  const boundaryBefore = await scroller.evaluate((element) => element.scrollTop)
  expect(boundaryBefore).toBeGreaterThan(0)
  await nested.press("PageUp")
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(boundaryBefore)

  const nonOverflowing = page.locator(`[data-timeline-part-id="${shellID}"]`).first()
  await nonOverflowing.evaluate((element) => {
    element.setAttribute("data-scrollable", "")
    element.setAttribute("tabindex", "0")
  })
  await nonOverflowing.focus()
  const nonOverflowBefore = await scroller.evaluate((element) => element.scrollTop)
  await nonOverflowing.press("PageUp")
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(nonOverflowBefore)
})

test("jump to latest lands on stable final rows after offscreen growth", async ({ page }, testInfo) => {
  const shellID = "prt_jump_01_shell"
  const followingID = "prt_jump_02_following"
  const command = "fixture-shell"
  const timeline = await setupTimeline(page, {
    messages: history(20),
    settings: { shellToolPartsExpanded: true },
    cpuRate: 4,
    active: true,
  })
  await startShellTurn(timeline, shellID, followingID, "Latest visible row", command)
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  await scroller.evaluate(
    (element) => (element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 600)),
  )
  await timeline.send(toolProgress(shellID, shellState(command, lines(50))), 300)
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await page.getByRole("button", { name: /Jump to latest/i }).click()
  await expect(page.locator(`[data-timeline-part-id="${followingID}"]`)).toBeVisible()
  await page.waitForTimeout(600)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "jump-latest",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["shell", "following"] },
      { type: "unique", regions: ["shell", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 1 },
      { type: "label-stability", regions: "all" },
      { type: "acquire-bottom-anchor" },
      { type: "flow", regions: ["shell", "following"] },
    ]),
  )
})

test("handles a single row taller than the viewport", async ({ page }, testInfo) => {
  const shellID = "prt_tall_01_shell"
  const followingID = "prt_tall_02_following"
  const command = "fixture-shell"
  // 种子在制 turn（running 空输出 shell + following），初始滚底保证探针启动时可见；
  // 补一帧 tool.called 登记 call record（translator 对未知 callID 的 success 会退化为 tool:""）
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command } }) }),
          v2Text("After tall row", followingID),
        ],
        { completed: false },
      ),
    ],
    settings: { shellToolPartsExpanded: true },
    // V1 的 360 高度在独立会话页时代 scroller 尚有 ~300px；现嵌入书籍工作台，chrome 占 ~300px，
    // 360 只剩 59px scroller，探针采样不到任何行——抬到 700 保住「单行高于 scroller 视口」语义
    viewport: { width: 900, height: 700 },
    cpuRate: 4,
    seedHistory: true,
    active: true,
  })
  await timeline.send(toolCalled(shellID, "bash", { command }))
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  const output = lines(100)
  await timeline.send(
    toolSuccess(shellID, {
      structured: shellState(command, output),
      content: [{ type: "text", text: output }],
    }),
    700,
  )
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "taller-than-viewport",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["shell", "following"] },
      { type: "unique", regions: ["shell", "following"] },
      { type: "stable", regions: ["shell", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 0 },
      { type: "label-stability", regions: "all" },
      { type: "preserve-bottom-anchor" },
      { type: "flow", regions: ["shell", "following"] },
    ]),
  )
})

type Timeline = Awaited<ReturnType<typeof setupTimeline>>

/** 事件驱动的运行中 shell turn：prompted → step.started → tool.called → following text 定稿 */
async function startShellTurn(
  timeline: Timeline,
  shellID: string,
  followingID: string,
  followingText: string,
  command: string,
) {
  await timeline.send(prompted("Run the shell scenario."))
  await timeline.send(stepStarted())
  await timeline.send(toolCalled(shellID, "bash", { command }), 60)
  for (const frame of textTurn({ textID: followingID, text: followingText })) await timeline.send(frame, 20)
  await timeline.waitForPart(shellID)
  await timeline.waitForPart(followingID)
}

/** 种子用完成态 bash（output 经 content 序列化、structured → metadata） */
function completedShell(id: string, command: string, output: string) {
  return v2Tool({
    id,
    name: "bash",
    state: v2ToolCompleted({
      input: { command },
      structured: shellState(command, output),
      content: [{ type: "text", text: output }],
    }),
  })
}

function shellState(command: string, output: string) {
  return { title: command, command, output }
}

function history(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const value = String(index).padStart(4, "0")
    return [
      userMessage({ id: `msg_${value}_scroll_a_user`, created: 1690000000000 + index * 10_000 }),
      assistantMessage([v2Text(`History ${index}. ${"content ".repeat(30)}`, `prt_${value}_scroll`)], {
        id: `msg_${value}_scroll_b_assistant`,
        created: 1690000001000 + index * 10_000,
      }),
    ]
  }).flat()
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function rowPairPlan(
  regions: Record<"shell" | "following", { selector: string; closest?: string }>,
  maxPositionReversals: number,
) {
  return visualPlan(regions, [
    { type: "required", regions: ["shell", "following"] },
    { type: "unique", regions: ["shell", "following"] },
    { type: "stable", regions: ["shell", "following"] },
    { type: "opacity", regions: "all" },
    { type: "continuity", regions: "all" },
    { type: "motion", regions: "all", maxPositionReversals },
    { type: "label-stability", regions: "all" },
    { type: "flow", regions: ["shell", "following"] },
  ])
}

function anchorPlan(regions: Record<"anchor", { selector: string; closest?: string }>) {
  return visualPlan(regions, [
    { type: "required", regions: ["anchor"] },
    { type: "unique", regions: ["anchor"] },
    { type: "stable", regions: ["anchor"] },
    { type: "fixed", regions: ["anchor"] },
    { type: "opacity", regions: "all" },
    { type: "continuity", regions: "all" },
    { type: "motion", regions: "all", maxPositionReversals: 0 },
    { type: "label-stability", regions: "all" },
  ])
}
