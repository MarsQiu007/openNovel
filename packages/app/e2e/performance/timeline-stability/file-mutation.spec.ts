// V2 化注记（timeline-stability-v2）：patch 文件列表增量走 tool.progress 的 structured.files
// （→ metadata），结算走 tool.success。tool.called 会重置 metadata，故首份文件列表在
// called 后由 progress 重新给出（honest 序：called → progress 逐步扩列 → success）。
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
  setupTimeline,
  toolCalled,
  toolProgress,
  toolSuccess,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

test("adds patch files incrementally without resetting outer expansion", async ({ page }, testInfo) => {
  const patchID = "prt_incremental_01_patch"
  const followingID = "prt_incremental_02_following"
  const first = patchFile("src/a.ts", "update")
  const second = patchFile("src/b.ts", "add")
  const third = patchFile("src/old.ts", "delete")
  const input = { files: [first.filePath, second.filePath, third.filePath] }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          v2Tool({ id: patchID, name: "apply_patch", state: v2ToolRunning({ input: { files: [first.filePath] } }) }),
          v2Text("Following incremental patch", followingID),
        ],
        { completed: false },
      ),
    ],
    settings: { editToolPartsExpanded: true },
    cpuRate: 4,
    seedHistory: true,
    active: true,
  })
  await timeline.send(toolCalled(patchID, "apply_patch", input))
  await timeline.send(toolProgress(patchID, { files: [first] }))
  const trigger = page.locator(`[data-timeline-part-id="${patchID}"] [data-slot="collapsible-trigger"]`).first()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await waitForVisualSettle(page, [`[data-timeline-part-id="${patchID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    patch: { selector: `[data-timeline-part-id="${patchID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(toolProgress(patchID, { files: [first, second] }), 240)
  await timeline.send(toolSuccess(patchID, { structured: { files: [first, second, third] } }), 800)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "incremental-patch",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["patch", "following"] },
        { type: "unique", regions: ["patch", "following"] },
        { type: "stable", regions: ["patch", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: ["following"], maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "preserve-bottom-anchor" },
        { type: "flow", regions: ["patch", "following"] },
      ],
      { perMarker: true },
    ),
  )
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator('[data-scope="apply-patch"] [data-type="delete"]')).toBeVisible()
})

function patchFile(filePath: string, type: "add" | "update" | "delete") {
  return {
    filePath,
    relativePath: filePath,
    type,
    additions: type === "delete" ? 0 : 4,
    deletions: type === "add" ? 0 : 3,
    before: type === "add" ? undefined : source(false),
    after: type === "delete" ? undefined : source(true),
  }
}

function source(changed: boolean) {
  return Array.from({ length: 12 }, (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`).join(
    "",
  )
}
