// V2 化注记（timeline-stability-v2）：三个交互场景均为纯 DOM 交互（折叠/展开），
// 数据面种子改用 v2-fixture 工厂（tool 完成态 output 走 content、filediff 走 structured→metadata）。
// V1 的 DiffSummary show-all 场景不可诚实重建：wire SessionMessageUser 无 summary 字段，
// adaptUser 不产出 diffs，DiffSummary 行恒空——删减依据见 proposal/design。
import { expect, test } from "@playwright/test"
import {
  defineVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import { v2Text, v2Tool, v2ToolCompleted } from "../../utils/v2-fixture"
import { assistantMessage, setupTimeline, userMessage, waitForVisualSettle } from "./fixture"

test("expands and collapses a long completed shell without overlap", async ({ page }, testInfo) => {
  const shellID = "prt_interaction_01_shell"
  const followingID = "prt_interaction_02_following"
  const output = lines(50)
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        v2Tool({
          id: shellID,
          name: "bash",
          state: v2ToolCompleted({
            input: { command: "fixture-shell" },
            structured: { title: "fixture-shell", command: "fixture-shell", output },
            content: [{ type: "text", text: output }],
          }),
        }),
        v2Text("Following shell expansion", followingID),
      ]),
    ],
    settings: { shellToolPartsExpanded: false },
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page.locator(`[data-timeline-part-id="${shellID}"] [data-slot="collapsible-trigger"]`)
  await waitForVisualSettle(page, [`[data-timeline-part-id="${shellID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  const plan = visualPlan(regions, [
    { type: "required", regions: ["shell", "following"] },
    { type: "unique", regions: ["shell", "following"] },
    { type: "stable", regions: ["shell", "following"] },
    { type: "opacity", regions: "all" },
    { type: "continuity", regions: "all" },
    { type: "motion", regions: "all", maxPositionReversals: 0 },
    { type: "label-stability", regions: "all" },
    { type: "preserve-bottom-anchor" },
    { type: "flow", regions: ["shell", "following"] },
  ])
  await startVisualProbe(page, regions)
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.waitForTimeout(500)
  const expanded = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "shell-expand", expanded, plan)

  await startVisualProbe(page, regions)
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await page.waitForTimeout(500)
  const collapsed = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "shell-collapse", collapsed, plan)
})

test("expands and collapses a completed context group without overlap", async ({ page }, testInfo) => {
  const ids = [
    "prt_interaction_01_read",
    "prt_interaction_02_glob",
    "prt_interaction_03_grep",
    "prt_interaction_04_list",
  ]
  const group = `[data-timeline-part-ids="${ids.join(",")}"]`
  const followingID = "prt_interaction_context_following"
  const contextTool = (id: string, name: string, input: Record<string, unknown>) =>
    v2Tool({ id, name, state: v2ToolCompleted({ input }) })
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        contextTool(ids[0], "read", { filePath: "src/a.ts" }),
        contextTool(ids[1], "glob", { path: ".", pattern: "**/*.ts" }),
        contextTool(ids[2], "grep", { path: ".", pattern: "stable" }),
        contextTool(ids[3], "list", { path: "src" }),
        v2Text("Following context expansion", followingID),
      ]),
    ],
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page.locator(`${group} [data-slot="collapsible-trigger"]`)
  await waitForVisualSettle(page, [group, `[data-timeline-part-id="${followingID}"]`])
  for (const [name, expanded] of [
    ["context-expand", true],
    ["context-collapse", false],
    ["context-reexpand", true],
  ] as const) {
    const regions = defineVisualRegions({
      context: { selector: group, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", String(expanded))
    await page.waitForTimeout(500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      name,
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["context", "following"] },
        { type: "unique", regions: ["context", "following"] },
        { type: "stable", regions: ["context", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "preserve-bottom-anchor" },
        { type: "flow", regions: ["context", "following"] },
      ]),
    )
  }
})

test("expands and collapses an edit diff without moving twice", async ({ page }, testInfo) => {
  const editID = "prt_interaction_edit"
  const followingID = "prt_interaction_edit_following"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        v2Tool({
          id: editID,
          name: "edit",
          state: v2ToolCompleted({
            input: { filePath: "src/edit.ts" },
            // filediff 经 structured → part.metadata 透传（v2-adapter）
            structured: {
              filediff: {
                file: "src/edit.ts",
                additions: 40,
                deletions: 40,
                before: source(40, false),
                after: source(40, true),
              },
            },
          }),
        }),
        v2Text("Following edit expansion", followingID),
      ]),
    ],
    settings: { editToolPartsExpanded: false },
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page.locator(`[data-timeline-part-id="${editID}"] [data-slot="collapsible-trigger"]`).first()
  await waitForVisualSettle(page, [`[data-timeline-part-id="${editID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    edit: { selector: `[data-timeline-part-id="${editID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.waitForTimeout(900)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "edit-expand",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["edit", "following"] },
      { type: "unique", regions: ["edit", "following"] },
      { type: "stable", regions: ["edit", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 0, maxReversals: 1 },
      { type: "label-stability", regions: "all" },
      { type: "preserve-bottom-anchor" },
      { type: "flow", regions: ["edit", "following"] },
    ]),
  )
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function source(count: number, changed: boolean) {
  return Array.from(
    { length: count },
    (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`,
  ).join("")
}
