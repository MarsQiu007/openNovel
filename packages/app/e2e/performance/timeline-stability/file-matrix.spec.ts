// V2 化注记（timeline-stability-v2）：pending 仅存于种子（v2ToolPending）；running 走 tool.called，
// 完成态的 filediff/files 走 tool.success 的 structured（→ metadata）。
import { test } from "@playwright/test"
import {
  defineVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import { v2Text, v2Tool, v2ToolPending } from "../../utils/v2-fixture"
import {
  assistantMessage,
  setupTimeline,
  toolCalled,
  toolSuccess,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

const profiles = [
  { name: "edit", tool: "edit", input: { filePath: "src/edit.ts" } },
  {
    name: "multi patch",
    tool: "apply_patch",
    input: { files: ["src/a.ts", "src/b.ts", "src/old.ts", "src/moved.ts"] },
  },
] as const

for (const profile of profiles) {
  test(`stabilizes ${profile.name} pending to completed`, async ({ page }, testInfo) => {
    const partID = `prt_file_matrix_${profiles.indexOf(profile)}`
    const followingID = `prt_file_matrix_following_${profiles.indexOf(profile)}`
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [v2Tool({ id: partID, name: profile.tool, state: v2ToolPending(profile.input) }), v2Text(`Following ${profile.name}`, followingID)],
          { completed: false },
        ),
      ],
      settings: { editToolPartsExpanded: true },
      cpuRate: 4,
      active: true,
    })
    await waitForVisualSettle(page, [`[data-timeline-part-id="${partID}"]`, `[data-timeline-part-id="${followingID}"]`])
    const regions = defineVisualRegions({
      tool: { selector: `[data-timeline-part-id="${partID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await timeline.send(toolCalled(partID, profile.tool, profile.input), 180)
    await timeline.send(toolSuccess(partID, { structured: completedStructured(profile) }), 900)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      `file-${profile.name}`,
      trace,
      visualPlan(
        regions,
        [
          { type: "required", regions: ["tool", "following"] },
          { type: "unique", regions: ["tool", "following"] },
          { type: "stable", regions: ["tool", "following"] },
          { type: "opacity", regions: "all" },
          { type: "continuity", regions: "all" },
          { type: "motion", regions: "all", maxPositionReversals: 0, maxReversals: 1 },
          { type: "label-stability", regions: "all" },
          { type: "preserve-bottom-anchor" },
          { type: "flow", regions: ["tool", "following"] },
        ],
        { perMarker: true },
      ),
    )
  })
}

function completedStructured(profile: (typeof profiles)[number]) {
  if (profile.tool === "edit") {
    return {
      filediff: {
        file: "src/edit.ts",
        additions: 50,
        deletions: 50,
        before: source(50, false),
        after: source(50, true),
      },
    }
  }
  return {
    files: [
      patchFile("src/a.ts", "update"),
      patchFile("src/b.ts", "add"),
      patchFile("src/old.ts", "delete"),
      { ...patchFile("src/moved.ts", "move"), move: "src/new-place.ts" },
    ],
  }
}

function patchFile(filePath: string, type: "add" | "update" | "delete" | "move") {
  return {
    filePath,
    relativePath: filePath,
    type,
    additions: type === "delete" ? 0 : 20,
    deletions: type === "add" ? 0 : 20,
    before: type === "add" ? undefined : source(20, false),
    after: type === "delete" ? undefined : source(20, true),
  }
}

function source(count: number, changed: boolean) {
  return Array.from(
    { length: count },
    (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`,
  ).join("")
}
