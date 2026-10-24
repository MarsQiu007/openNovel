// V2 化注记（timeline-stability-v2）：shell 增长走 tool.called + progress/success 帧序列
// （种子 running 须先补 tool.called 登记 call record）；「滚离不被拉动」的前置是真实
// wheel 手势——autoScroll 的底部跟随只认 wheel/touch 置位 userScrolled，程序 scrollTop
// 写入会被其 ResizeObserver 拉回底部；折叠态跨虚拟化与 resize 为纯交互场景（无事件）。
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
  setupTimeline,
  toolCalled,
  toolProgress,
  toolSuccess,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

test.describe("timeline adverse visual stability", () => {
  test("does not pull a scrolled-away user while an active shell grows", async ({ page }, testInfo) => {
    const activeShellID = "prt_adverse_01_shell"
    const timeline = await setupTimeline(page, {
      messages: [
        ...history(24),
        userMessage(),
        assistantMessage(
          [v2Tool({ id: activeShellID, name: "bash", state: v2ToolRunning({ input: { command: "echo grow" } }) })],
          { completed: false },
        ),
      ],
      settings: { shellToolPartsExpanded: true },
      cpuRate: 4,
      eventRetry: 30,
      active: true,
    })
    // 登记 call record（种子 running 无事件史，translator 需要 called 才保 tool/input）
    await timeline.send(toolCalled(activeShellID, "bash", { command: "echo grow" }), 30)
    const scroller = page.locator(".scroll-view__viewport", {
      has: page.locator('[data-timeline-row="AssistantPart"]'),
    })
    await scroller.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -450 }))
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 450)
    })
    await page.waitForTimeout(150)
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeGreaterThan(100)
    const anchor = await scroller.evaluate((element) => {
      const view = element.getBoundingClientRect()
      return [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].find((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top >= view.top + 40 && rect.bottom <= view.bottom - 40
      })?.dataset.timelineKey
    })
    expect(anchor).toBeTruthy()
    await waitForVisualSettle(page, [`[data-timeline-key="${anchor}"]`])

    const regions = defineVisualRegions({
      anchor: { selector: `[data-timeline-key="${anchor}"]` },
    })
    await startVisualProbe(page, regions)
    const grown = (count: number) => ({ title: "echo grow", command: "echo grow", output: lines(count) })
    await timeline.send(toolProgress(activeShellID, grown(1)), 180)
    await timeline.send(toolProgress(activeShellID, grown(10)), 90)
    await timeline.send(toolProgress(activeShellID, grown(50)), 350)
    await timeline.send(
      toolSuccess(activeShellID, { structured: grown(50), content: [{ type: "text", text: lines(50) }] }),
      500,
    )
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "scrolled-away-shell",
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["anchor"] },
        { type: "unique", regions: ["anchor"] },
        { type: "stable", regions: ["anchor"] },
        { type: "fixed", regions: ["anchor"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
      ]),
    )
  })

  test("preserves an explicit shell state across virtualization", async ({ page }) => {
    const targetID = "prt_virtual_shell"
    await setupTimeline(page, {
      messages: [
        userMessage({ id: "msg_0000_virtual_user", created: 1700000000000 }),
        assistantMessage(
          [
            v2Tool({
              id: targetID,
              name: "bash",
              state: v2ToolCompleted({
                input: { command: "echo virtual" },
                structured: { title: "echo virtual", command: "echo virtual", output: lines(20) },
                content: [{ type: "text", text: lines(20) }],
              }),
            }),
          ],
          { id: "msg_0001_virtual_assistant", created: 1700000001000 },
        ),
        ...history(35),
      ],
      settings: { shellToolPartsExpanded: false },
    })
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1_000 }))
      element.scrollTop = 0
    })
    await page.waitForTimeout(300)
    const trigger = page.locator(`[data-timeline-part-id="${targetID}"] [data-slot="collapsible-trigger"]`)
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")

    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect(page.locator(`[data-timeline-part-id="${targetID}"]`)).toHaveCount(0)
    await scroller.evaluate((element) => (element.scrollTop = 0))
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
  })

  // 宿主迁移注记（V2）：独立会话页退役后会话嵌在书籍工作台右栏，窗口过窄会触发工作台
  // 自动收边（railCollapsed → display:none，属产品预期），「窄容器」场景改为钉小右栏宽度。
  test("keeps narrow rail rows ordered during long shell growth", async ({ page }, testInfo) => {
    const shellID = "prt_narrow_01_shell"
    const followingID = "prt_narrow_02_following"
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [
            v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command: "echo narrow" } }) }),
            v2Text("A narrow following row that wraps across lines.", followingID),
          ],
          { completed: false },
        ),
      ],
      settings: { shellToolPartsExpanded: true },
      railWidth: 420,
      cpuRate: 4,
      active: true,
    })
    // 登记 call record
    await timeline.send(toolCalled(shellID, "bash", { command: "echo narrow" }), 30)
    await waitForVisualSettle(page, [
      `[data-timeline-part-id="${shellID}"]`,
      `[data-timeline-part-id="${followingID}"]`,
    ])
    const regions = defineVisualRegions({
      shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    const grown = (count: number) => ({ title: "echo narrow", command: "echo narrow", output: wideLines(count) })
    await timeline.send(toolProgress(shellID, grown(10)), 100)
    await timeline.send(toolProgress(shellID, grown(50)), 300)
    await timeline.send(
      toolSuccess(shellID, { structured: grown(50), content: [{ type: "text", text: wideLines(50) }] }),
      500,
    )
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "narrow-shell",
      trace,
      visualPlan(
        regions,
        [
          { type: "required", regions: ["shell", "following"] },
          { type: "unique", regions: ["shell", "following"] },
          { type: "stable", regions: ["shell", "following"] },
          { type: "opacity", regions: "all" },
          { type: "continuity", regions: "all" },
          { type: "motion", regions: "all", maxPositionReversals: 0 },
          { type: "label-stability", regions: "all" },
          { type: "preserve-bottom-anchor" },
          { type: "flow", regions: ["shell", "following"] },
        ],
        { perMarker: true },
      ),
    )
  })

  test("keeps visible rows ordered while resizing desktop to narrow and back", async ({ page }, testInfo) => {
    const shellID = "prt_resize_01_shell"
    const contextIDs = ["prt_resize_02_read", "prt_resize_03_glob"]
    const followingID = "prt_resize_04_following"
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([
          v2Tool({
            id: shellID,
            name: "bash",
            state: v2ToolCompleted({
              input: { command: "echo resize" },
              structured: { title: "echo resize", command: "echo resize", output: wideLines(15) },
              content: [{ type: "text", text: wideLines(15) }],
            }),
          }),
          v2Tool({
            id: contextIDs[0]!,
            name: "read",
            state: v2ToolCompleted({ input: { filePath: "src/a.ts" } }),
          }),
          v2Tool({
            id: contextIDs[1]!,
            name: "glob",
            state: v2ToolCompleted({ input: { path: ".", pattern: "**/*.ts" } }),
          }),
          v2Text("Following responsive timeline content that wraps on narrow screens.", followingID),
        ]),
      ],
      settings: { shellToolPartsExpanded: true },
      cpuRate: 4,
      seedHistory: true,
    })
    const group = `[data-timeline-part-ids="${contextIDs.join(",")}"]`
    const regions = defineVisualRegions({
      shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
      context: { selector: group, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    // 收窄终点 1000 保持在右栏自动收边阈值（≈左栏 220 + 右栏 320 + 主区保底 160 + 应用侧栏）
    // 之上：跨过阈值右栏 display:none、时间线整棵隐藏属产品预期行为，不在本断言范围
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.waitForTimeout(500)
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.waitForTimeout(500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "responsive-resize",
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["shell", "context", "following"] },
        { type: "unique", regions: ["shell", "context", "following"] },
        { type: "stable", regions: ["shell", "context", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 4, maxReversals: 4 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["shell", "context", "following"] },
      ]),
    )
  })
})

function history(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const value = String(index).padStart(4, "0")
    return [
      userMessage({ id: `msg_${value}_adverse_a_user`, created: 1690000000000 + index * 10_000 }),
      assistantMessage([v2Text(`Historical response ${index}. ${"Stable history content. ".repeat(8)}`, `prt_${value}_adverse`)], {
        id: `msg_${value}_adverse_b_assistant`,
        created: 1690000001000 + index * 10_000,
      }),
    ]
  }).flat()
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function wideLines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1} ${"wide-output-".repeat(20)}`).join("\n")
}
