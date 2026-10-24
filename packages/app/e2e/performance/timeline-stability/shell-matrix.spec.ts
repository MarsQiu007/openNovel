// V2 化注记（timeline-stability-v2）：shell 输出增长走 tool.progress 的 structured（→ metadata），
// 结算走 tool.success（content → output）/ tool.failed。种子 running shell 后补 tool.called
// 登记 call record（translator 对未知 callID 的 progress/success/failed 退化为 tool:""）。
import { test } from "@playwright/test"
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
  setupTimeline,
  textTurn,
  toolCalled,
  toolFailed,
  toolProgress,
  toolSuccess,
  userMessage,
  waitForVisualSettle,
  type Timeline,
} from "./fixture"

const profiles = [
  {
    name: "empty running to completed",
    updates: [{ output: "", delay: 350 }],
  },
  {
    name: "50 lines arriving incrementally",
    updates: [
      { output: lines(1), delay: 100 },
      { output: lines(10), delay: 160 },
      { output: lines(25), delay: 90 },
      { output: lines(50), delay: 220 },
      { output: lines(50), delay: 500, completed: true },
    ],
  },
  {
    name: "wide ANSI and CRLF output",
    updates: [
      {
        output: Array.from({ length: 20 }, (_, index) => `\u001b[32mline ${index}\u001b[0m ${"wide-".repeat(30)}`).join(
          "\r\n",
        ),
        delay: 240,
      },
      {
        output: Array.from({ length: 20 }, (_, index) => `line ${index} ${"wide-".repeat(30)}`).join("\n"),
        delay: 500,
        completed: true,
      },
    ],
  },
] as const

for (const profile of profiles) {
  test(`keeps rows stable for shell ${profile.name}`, async ({ page }, testInfo) => {
    const shellID = `prt_matrix_${profiles.indexOf(profile)}_01_shell`
    const followingID = `prt_matrix_${profiles.indexOf(profile)}_02_following`
    const command = "fixture-shell"
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [
            v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command } }) }),
            v2Text("Following shell row", followingID),
          ],
          { completed: false },
        ),
      ],
      settings: { shellToolPartsExpanded: true },
      cpuRate: 4,
      seedHistory: true,
      active: true,
    })
    await timeline.send(toolCalled(shellID, "bash", { command }))
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
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
    for (const update of profile.updates) {
      await sendShellUpdate(timeline, shellID, command, update.output, update.delay, "completed" in update)
    }
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      `shell-${profiles.indexOf(profile)}`,
      trace,
      visualPlan(
        regions,
        [
          { type: "required", regions: ["shell", "following"] },
          { type: "unique", regions: ["shell", "following"] },
          { type: "stable", regions: ["shell", "following"] },
          { type: "opacity", regions: "all" },
          { type: "continuity", regions: "all" },
          { type: "motion", regions: "all", maxPositionReversals: 0, maxReversals: 1 },
          { type: "label-stability", regions: "all" },
          { type: "preserve-bottom-anchor" },
          { type: "flow", regions: ["shell", "following"] },
        ],
        { perMarker: true },
      ),
    )
  })
}

test("keeps following row stable when a collapsed shell receives 50 lines", async ({ page }, testInfo) => {
  const shellID = "prt_matrix_collapsed_01_shell"
  const followingID = "prt_matrix_collapsed_02_following"
  const command = "fixture-shell"
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command } }) }),
          v2Text("Following collapsed shell", followingID),
        ],
        { completed: false },
      ),
    ],
    settings: { shellToolPartsExpanded: false },
    cpuRate: 4,
    seedHistory: true,
    active: true,
  })
  await timeline.send(toolCalled(shellID, "bash", { command }))
  await waitForVisualSettle(page, [`[data-timeline-part-id="${shellID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await sendShellUpdate(timeline, shellID, command, lines(50), 240, false)
  await sendShellUpdate(timeline, shellID, command, lines(50), 500, true)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "collapsed-shell",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["shell", "following"] },
        { type: "unique", regions: ["shell", "following"] },
        { type: "stable", regions: ["shell", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: ["following"], maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["shell", "following"] },
      ],
      { perMarker: true },
    ),
  )
})

test("keeps rows stable when a running shell becomes an error", async ({ page }, testInfo) => {
  const shellID = "prt_matrix_error_01_shell"
  const followingID = "prt_matrix_error_02_following"
  const command = "fixture-shell"
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command } }) }),
          v2Text("Following failed shell", followingID),
        ],
        { completed: false },
      ),
    ],
    settings: { shellToolPartsExpanded: true },
    cpuRate: 4,
    seedHistory: true,
    active: true,
  })
  // 先叫输出再失败（honest 序：called → progress 出 10 行 → failed）
  await timeline.send(toolCalled(shellID, "bash", { command }))
  await timeline.send(toolProgress(shellID, { title: command, command, output: lines(10) }))
  await waitForVisualSettle(page, [`[data-timeline-part-id="${shellID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(toolFailed(shellID, "Command failed after output"), 500)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "shell-error",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["shell", "following"] },
        { type: "unique", regions: ["shell", "following"] },
        { type: "stable", regions: ["shell", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: ["following"], maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "preserve-bottom-anchor" },
        { type: "flow", regions: ["shell", "following"] },
      ],
      { perMarker: true },
    ),
  )
})

test("keeps rows stable when later text arrives before shell output", async ({ page }, testInfo) => {
  const shellID = "prt_late_text_01_shell"
  const followingID = "prt_late_text_02_following"
  const command = "fixture-shell"
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command } }) })], {
        completed: false,
      }),
    ],
    settings: { shellToolPartsExpanded: true },
    cpuRate: 4,
    seedHistory: true,
    active: true,
  })
  await timeline.send(toolCalled(shellID, "bash", { command }))
  await waitForVisualSettle(page, [`[data-timeline-part-id="${shellID}"]`])
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: {
      selector: `[data-timeline-part-id="${followingID}"]`,
      closest: '[data-timeline-row="AssistantPart"]',
    },
  })
  await startVisualProbe(page, regions)
  for (const frame of textTurn({ textID: followingID, text: "Later assistant content arrived before shell output." })) {
    await timeline.send(frame, 80)
  }
  await page.waitForTimeout(80)
  await sendShellUpdate(timeline, shellID, command, lines(20), 300, false)
  await sendShellUpdate(timeline, shellID, command, lines(20), 600, true)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "late-text-before-shell-output",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["shell", "following"] },
        { type: "unique", regions: ["shell", "following"] },
        { type: "stable", regions: ["shell"] },
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

function sendShellUpdate(
  timeline: Timeline,
  shellID: string,
  command: string,
  output: string,
  delay: number,
  completed: boolean,
) {
  if (completed) {
    return timeline.send(
      toolSuccess(shellID, {
        structured: { title: command, command, output },
        content: [{ type: "text", text: output }],
      }),
      delay,
    )
  }
  return timeline.send(toolProgress(shellID, { title: command, command, output }), delay)
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
