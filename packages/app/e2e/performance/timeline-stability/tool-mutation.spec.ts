// V2 化注记（timeline-stability-v2）：task 子会话链接走 tool.success 的 structured.sessionId
// （→ metadata）。工具参数原位变更无事件词汇（tool.called 的 input 一次定型），
// 改走 D5 重拉通路（setMessages 改写 + revert.committed），reconcile 按 part id 原位更新。
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
  session,
  sessionID,
  setupTimeline,
  toolCalled,
  toolSuccess,
  userID,
  userMessage,
} from "./fixture"

test("adds a task child-session link without replacing the task row", async ({ page }, testInfo) => {
  const taskID = "prt_task_link"
  const childID = "ses_task_child"
  const input = { description: "Inspect child", subagent_type: "explore" }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([v2Tool({ id: taskID, name: "task", state: v2ToolRunning({ input }) })], {
        completed: false,
      }),
    ],
    sessions: [session(), session({ id: childID, parentID: sessionID, title: "Inspect child" })],
    cpuRate: 4,
    active: true,
  })
  // 登记 call record，success 才能保住 tool 名与 input
  await timeline.send(toolCalled(taskID, "task", input))
  const regions = defineVisualRegions({
    task: { selector: `[data-timeline-part-id="${taskID}"] [data-slot="collapsible-trigger"]` },
  })
  await startVisualProbe(page, regions)
  await timeline.send(toolSuccess(taskID, { structured: { sessionId: childID } }), 500)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "task-link",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["task"] },
      { type: "unique", regions: ["task"] },
      { type: "stable", regions: ["task"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 0 },
      { type: "label-stability", regions: "all" },
    ]),
  )
  await expect(
    page.locator(`a[href$="/session/${childID}"]`, { has: page.locator('[data-component="task-tool-card"]') }),
  ).toBeVisible()
})

test("changes generic tool arguments without replacing the row", async ({ page }, testInfo) => {
  const toolID = "prt_generic_mutation"
  const followingID = "prt_generic_mutation_following"
  const withTool = (state: "running" | "mutated" | "completed") => [
    userMessage(),
    assistantMessage(
      [
        v2Tool({
          id: toolID,
          name: "mcp_probe",
          state:
            state === "completed"
              ? v2ToolCompleted({ input: { target: "two", count: 2, mode: "deep" } })
              : v2ToolRunning({
                  input: state === "running" ? { target: "one", count: 1 } : { target: "two", count: 2, mode: "deep" },
                }),
        }),
        v2Text("Following generic tool", followingID),
      ],
      { completed: false },
    ),
  ]
  const timeline = await setupTimeline(page, { messages: withTool("running"), cpuRate: 4 })
  const regions = defineVisualRegions({
    tool: { selector: `[data-timeline-part-id="${toolID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  timeline.setMessages(withTool("mutated"))
  await timeline.send(revertCommitted(userID), 200)
  timeline.setMessages(withTool("completed"))
  await timeline.send(revertCommitted(assistantID), 400)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "generic-mutation",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["tool", "following"] },
        { type: "unique", regions: ["tool", "following"] },
        { type: "stable", regions: ["tool", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["tool", "following"] },
      ],
      { perMarker: true },
    ),
  )
})
