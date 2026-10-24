// V2 化注记（timeline-stability-v2）：组内追加走 tool.called/success（事件面 honest）；
// 中间 text 插删与「删首成员」无事件词汇，走 D5「setMessages + revert.committed 强制重拉 reconcile」。
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
  assistantID,
  assistantMessage,
  revertCommitted,
  setupTimeline,
  toolCalled,
  toolSuccess,
  userID,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

const inputs = {
  read: { filePath: "src/a.ts", offset: 0, limit: 120 },
  glob: { path: ".", pattern: "**/*.ts" },
  grep: { path: ".", pattern: "stable", include: "*.ts" },
  list: { path: "src" },
}

test("appends context operations while the group is expanded", async ({ page }, testInfo) => {
  const firstID = "prt_append_01_read"
  const followingID = "prt_append_99_following"
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          v2Tool({ id: firstID, name: "read", state: v2ToolRunning({ input: inputs.read }) }),
          v2Text("Following append", followingID),
        ],
        { completed: false },
      ),
    ],
    cpuRate: 4,
    active: true,
  })
  const initialGroup = `[data-timeline-part-ids="${firstID}"]`
  await page.locator(`${initialGroup} [data-slot="collapsible-trigger"]`).click()
  await waitForVisualSettle(page, [initialGroup, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    context: {
      selector: '[data-timeline-part-ids^="prt_append_01_read"]',
      closest: '[data-timeline-row="AssistantPart"]',
    },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(toolCalled("prt_append_02_glob", "glob", inputs.glob), 180)
  await timeline.send(toolCalled("prt_append_03_grep", "grep", inputs.grep), 60)
  await timeline.send(toolSuccess("prt_append_03_grep"), 180)
  await timeline.send(toolCalled("prt_append_04_list", "list", inputs.list), 60)
  await timeline.send(toolSuccess("prt_append_04_list"), 440)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "context-append",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["context", "following"] },
        { type: "unique", regions: ["context", "following"] },
        { type: "stable", regions: ["context", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: ["following"], maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "preserve-bottom-anchor" },
        { type: "flow", regions: ["context", "following"] },
      ],
      { perMarker: true },
    ),
  )
  await expect(
    page.locator(
      '[data-timeline-part-ids="prt_append_01_read,prt_append_02_glob,prt_append_03_grep,prt_append_04_list"]',
    ),
  ).toBeVisible()
  await expect(
    page.locator('[data-timeline-part-ids^="prt_append_01_read"] [data-slot="collapsible-trigger"]'),
  ).toHaveAttribute("aria-expanded", "true")
})

test("splits and merges context groups when a middle text part changes", async ({ page }, testInfo) => {
  const textID = "prt_split_02_text"
  const followingID = "prt_split_99_following"
  const withBoundary = (present: boolean) => [
    userMessage(),
    assistantMessage([
      v2Tool({ id: "prt_split_01_read", name: "read", state: v2ToolCompleted({ input: inputs.read }) }),
      ...(present ? [v2Text("Boundary", textID)] : []),
      v2Tool({ id: "prt_split_03_glob", name: "glob", state: v2ToolCompleted({ input: inputs.glob }) }),
      v2Text("Following split groups", followingID),
    ]),
  ]
  const timeline = await setupTimeline(page, { messages: withBoundary(true), cpuRate: 4 })
  const regions = defineVisualRegions({
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  // 中间 text 删除 → 两侧 context 工具并组（D5 重拉 reconcile）
  timeline.setMessages(withBoundary(false))
  await timeline.send(revertCommitted(userID), 500)
  await expect(page.locator('[data-timeline-part-ids="prt_split_01_read,prt_split_03_glob"]')).toBeVisible()
  // text 恢复 → 组重新拆分
  timeline.setMessages(withBoundary(true))
  await timeline.send(revertCommitted(assistantID), 500)
  await expect(page.locator('[data-timeline-part-ids="prt_split_01_read"]')).toBeVisible()
  await expect(page.locator('[data-timeline-part-ids="prt_split_03_glob"]')).toBeVisible()
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "context-split-merge",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["following"] },
        { type: "unique", regions: ["following"] },
        { type: "stable", regions: ["following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 1 },
        { type: "label-stability", regions: "all" },
      ],
      { perMarker: true },
    ),
  )
})

test("removing the first context member replaces the group once without overlapping following content", async ({
  page,
}, testInfo) => {
  const ids = ["prt_key_01_read", "prt_key_02_glob", "prt_key_03_grep"]
  const followingID = "prt_key_99_following"
  const withMembers = (members: string[]) => [
    userMessage(),
    assistantMessage([
      ...members.map((id) => {
        const name = id.endsWith("read") ? "read" : id.endsWith("glob") ? "glob" : "grep"
        return v2Tool({ id, name, state: v2ToolCompleted({ input: inputs[name] }) })
      }),
      v2Text("Following replaced group", followingID),
    ]),
  ]
  const timeline = await setupTimeline(page, { messages: withMembers(ids), cpuRate: 4 })
  const original = page.locator(`[data-timeline-part-ids="${ids.join(",")}"]`)
  const originalRowKey = await original.evaluate((element) =>
    element.closest("[data-timeline-key]")?.getAttribute("data-timeline-key"),
  )
  await original.locator('[data-slot="collapsible-trigger"]').click()
  await expect(original.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
  const regions = defineVisualRegions({
    context: {
      selector: '[data-timeline-part-ids*="prt_key_02_glob"]',
      closest: '[data-timeline-row="AssistantPart"]',
    },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  // 删首成员（D5 重拉 reconcile）：组应保持原 row key、不重挂、不压 following
  timeline.setMessages(withMembers(ids.slice(1)))
  await timeline.send(revertCommitted(assistantID), 500)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "context-first-remove",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["context", "following"] },
      { type: "unique", regions: ["context", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 0 },
      { type: "label-stability", regions: "all" },
      { type: "flow", regions: ["context", "following"] },
    ]),
  )
  await expect(page.locator(`[data-timeline-part-ids="${ids.slice(1).join(",")}"]`)).toBeVisible()
  expect(
    await page
      .locator(`[data-timeline-part-ids="${ids.slice(1).join(",")}"]`)
      .evaluate((element) => element.closest("[data-timeline-key]")?.getAttribute("data-timeline-key")),
  ).toBe(originalRowKey)
  await expect(
    page.locator(`[data-timeline-part-ids="${ids.slice(1).join(",")}"] [data-slot="collapsible-trigger"]`),
  ).toHaveAttribute("aria-expanded", "true")
})
