// V2 化注记（timeline-stability-v2）：种子在制 turn（running 空输出 shell + following），
// 补 tool.called 登记 call record；增长走 tool.progress structured，结算走 tool.success。
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
  toolCalled,
  toolProgress,
  toolSuccess,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

// Fractional scaling exercises different browser rounding than the baseline.
for (const deviceScaleFactor of [1, 1.25]) {
  test(`keeps shell growth ordered at device scale ${deviceScaleFactor}`, async ({ page }, testInfo) => {
    const shellID = `prt_dpr_${String(deviceScaleFactor).replace(".", "_")}_01_shell`
    const followingID = `prt_dpr_${String(deviceScaleFactor).replace(".", "_")}_02_following`
    const command = "fixture-shell"
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [
            v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command } }) }),
            v2Text("Following scaled shell", followingID),
          ],
          { completed: false },
        ),
      ],
      settings: { shellToolPartsExpanded: true },
      cpuRate: 4,
      deviceScaleFactor,
      seedHistory: true,
      active: true,
    })
    await timeline.send(toolCalled(shellID, "bash", { command }))
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
    const output = lines(20)
    await startVisualProbe(page, regions)
    await timeline.send(toolProgress(shellID, { title: command, command, output }), 180)
    await timeline.send(
      toolSuccess(shellID, {
        structured: { title: command, command, output },
        content: [{ type: "text", text: output }],
      }),
      500,
    )
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(testInfo, `dpr-${deviceScaleFactor}`, trace, shellPlan(regions))
  })
}

for (const reducedMotion of [true]) {
  test(`keeps shell and status transitions ordered with reduced motion ${reducedMotion}`, async ({
    page,
  }, testInfo) => {
    const shellID = `prt_motion_${reducedMotion}_01_shell`
    const followingID = `prt_motion_${reducedMotion}_02_following`
    const command = "fixture-shell"
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [
            v2Tool({ id: shellID, name: "bash", state: v2ToolRunning({ input: { command } }) }),
            v2Text("Following motion profile", followingID),
          ],
          { completed: false },
        ),
      ],
      settings: { shellToolPartsExpanded: true },
      reducedMotion,
      cpuRate: 4,
      seedHistory: true,
      active: true,
    })
    await timeline.send(toolCalled(shellID, "bash", { command }))
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
    const output = lines(10)
    await startVisualProbe(page, regions)
    await timeline.send(
      toolSuccess(shellID, {
        structured: { title: command, command, output },
        content: [{ type: "text", text: output }],
      }),
      500,
    )
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(testInfo, `reduced-motion-${reducedMotion}`, trace, shellPlan(regions))
  })
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function shellPlan<Regions extends ReturnType<typeof defineVisualRegions>>(
  regions: Regions & Record<"shell" | "following", { selector: string }>,
) {
  return visualPlan(
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
  )
}
