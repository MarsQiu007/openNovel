// V2 化注记（timeline-stability-v2）：V1 的 part/message 级 upsert 与删除事件在 V2 无对应词汇，
// 插删场景改走「setMessages 改写可变历史 + session.next.revert.committed 强制重拉 reconcile」
// （design D5）；retry 演进走 session.next.retried；流式/结算走 session.next.step/text 帧序列。
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
  retried,
  revertCommitted,
  sessionUpdated,
  setupTimeline,
  stepEnded,
  stepFailed,
  stepStarted,
  textDelta,
  textEnded,
  textStarted,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

test("keeps unchanged siblings stable while a middle part is inserted and removed", async ({ page }, testInfo) => {
  const firstID = "prt_mutation_01_first"
  const middleID = "prt_mutation_02_middle"
  const lastID = "prt_mutation_03_last"
  const pair = () => [
    userMessage(),
    assistantMessage([v2Text("First stable row", firstID), v2Text("Last stable row", lastID)]),
  ]
  const timeline = await setupTimeline(page, { messages: pair(), cpuRate: 4 })
  const regions = defineVisualRegions({
    first: { selector: `[data-timeline-part-id="${firstID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    last: { selector: `[data-timeline-part-id="${lastID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  timeline.setMessages([
    userMessage(),
    assistantMessage([
      v2Text("First stable row", firstID),
      v2Text("Inserted middle row. ".repeat(12), middleID),
      v2Text("Last stable row", lastID),
    ]),
  ])
  await timeline.send(revertCommitted(), 350)
  await expect(page.locator(`[data-timeline-part-id="${middleID}"]`)).toBeVisible()
  timeline.setMessages(pair())
  await timeline.send(revertCommitted(), 500)
  await expect(page.locator(`[data-timeline-part-id="${middleID}"]`)).toHaveCount(0)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "middle-insert-remove", trace, stablePairPlan(regions, 1))
})

test("streams text through growth, canonical replacement, and completion", async ({ page }, testInfo) => {
  const textID = "prt_text_reconcile"
  const anchorID = "msg_00017_history_a_user"
  const timeline = await setupTimeline(page, { messages: [], seedHistory: true, cpuRate: 4 })
  await waitForVisualSettle(page, [`[data-message-id="${anchorID}"]`])
  const regions = defineVisualRegions({
    anchor: { selector: `[data-timeline-row="UserMessage"][data-message-id="${anchorID}"]` },
    text: { selector: `[data-timeline-part-id="${textID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  // 生产形态：delta 增量累积，text.ended 以更短的 canonical 全文收口（须丢弃陈旧 delta 后缀）
  await timeline.send(prompted("Stream the reconcile probe."))
  await timeline.send(stepStarted())
  await timeline.send(textStarted(textID))
  await startVisualProbe(page, regions)
  await timeline.send(textDelta(textID, "Starting streamed content. "), 100)
  await timeline.send(textDelta(textID, "- item one\n- item two\n- item three "), 180)
  await timeline.send(textEnded(textID, "Canonical replacement."), 200)
  await timeline.send(stepEnded(), 500)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "text-reconcile",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["anchor", "text"] },
      { type: "unique", regions: ["anchor", "text"] },
      { type: "stable", regions: ["anchor", "text"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 1, maxReversals: 2 },
      { type: "label-stability", regions: "all" },
      { type: "preserve-bottom-anchor" },
      { type: "flow", regions: ["anchor", "text"] },
    ]),
  )
})

test("inserts a completed question between stable rows", async ({ page }, testInfo) => {
  const firstID = "prt_question_01_first"
  const questionID = "prt_question_02_hidden"
  const lastID = "prt_question_03_last"
  const input = { questions: [{ header: "Choice", question: "Keep stable?", options: [] }] }
  const withQuestion = (state: "running" | "completed") => [
    userMessage(),
    assistantMessage([
      v2Text("Before question", firstID),
      v2Tool({
        id: questionID,
        name: "question",
        state:
          state === "running"
            ? v2ToolRunning({ input })
            : v2ToolCompleted({ input, structured: { answers: [["Yes"]] } }),
      }),
      v2Text("After question", lastID),
    ]),
  ]
  const timeline = await setupTimeline(page, { messages: withQuestion("running"), cpuRate: 4 })
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  const regions = defineVisualRegions({
    first: { selector: `[data-timeline-part-id="${firstID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    last: { selector: `[data-timeline-part-id="${lastID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  timeline.setMessages(withQuestion("completed"))
  await timeline.send(revertCommitted(), 600)
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toBeVisible()
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "question-insert", trace, stablePairPlan(regions, 0))
})

test("replaces thinking with an assistant error without a blank turn", async ({ page }, testInfo) => {
  const timeline = await setupTimeline(page, { messages: [], active: true, cpuRate: 4 })
  await timeline.send(prompted("Fail visibly."))
  await timeline.send(stepStarted(), 150)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  const regions = defineVisualRegions({
    thinking: { selector: '[data-timeline-row="Thinking"]' },
    error: { selector: '[data-timeline-row="Error"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(stepFailed("Provider failed visibly"), 500)
  timeline.setBusy(false)
  await timeline.send(sessionUpdated())
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Error"]')).toContainText("Provider failed visibly")
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "thinking-error",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["thinking", "error"] },
      { type: "continuous-any", regions: ["thinking", "error"] },
      { type: "unique", regions: ["thinking", "error"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all" },
      { type: "label-stability", regions: "all" },
    ]),
  )
})

test("updates retry attempts and long provider messages without remounting the retry row", async ({
  page,
}, testInfo) => {
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([], { completed: false })],
    active: true,
    cpuRate: 4,
  })
  await timeline.send(retried(1), 120)
  await expect(page.locator('[data-timeline-row="Retry"]')).toBeVisible()
  const regions = defineVisualRegions({
    retry: { selector: '[data-timeline-row="Retry"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(retried(2, "A very long provider retry message ".repeat(8)), 300)
  await timeline.send(retried(3), 300)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "retry-evolution",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["retry"] },
        { type: "unique", regions: ["retry"] },
        { type: "stable", regions: ["retry"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
      ],
      { perMarker: true },
    ),
  )
})

test("reducer-hardening: resync removes a historical turn without moving a visible lower anchor twice", async ({
  page,
}, testInfo) => {
  const removeUserID = "msg_0500_remove_user"
  const removeAssistantID = "msg_0501_remove_assistant"
  const anchorUserID = "msg_2000_anchor_user"
  const full = () => [
    userMessage({ id: removeUserID, created: 1690000000000 }),
    assistantMessage([v2Text("Removed historical content. ".repeat(15), "prt_remove_text")], {
      id: removeAssistantID,
      created: 1690000001000,
    }),
    userMessage({ id: anchorUserID }),
    assistantMessage([v2Text("Visible anchor response", "prt_anchor_text")], { id: "msg_2001_anchor_assistant" }),
  ]
  const timeline = await setupTimeline(page, { messages: full(), cpuRate: 4 })
  const regions = defineVisualRegions({
    anchor: { selector: `[data-timeline-row="UserMessage"][data-message-id="${anchorUserID}"]` },
  })
  await startVisualProbe(page, regions)
  // V2 无 message 级删除事件：历史改写后强制重拉，reconcile 丢弃消失消息（design D5）
  timeline.setMessages(full().filter((message) => message.id !== removeAssistantID))
  await timeline.send(revertCommitted(removeAssistantID), 200)
  await expect(page.locator('[data-timeline-part-id="prt_remove_text"]')).toHaveCount(0)
  timeline.setMessages(full().filter((message) => message.id !== removeAssistantID && message.id !== removeUserID))
  await timeline.send(revertCommitted(removeUserID), 500)
  await expect(page.locator(`[data-message-id="${removeUserID}"]`)).toHaveCount(0)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "historical-turn-remove",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["anchor"] },
        { type: "unique", regions: ["anchor"] },
        { type: "stable", regions: ["anchor"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
      ],
      { perMarker: true },
    ),
  )
})

function stablePairPlan(
  regions: Record<"first" | "last", { selector: string; closest?: string }>,
  maxPositionReversals: number,
) {
  return visualPlan(regions, [
    { type: "required", regions: ["first", "last"] },
    { type: "unique", regions: ["first", "last"] },
    { type: "stable", regions: ["first", "last"] },
    { type: "opacity", regions: "all" },
    { type: "continuity", regions: "all" },
    { type: "motion", regions: "all", maxPositionReversals },
    { type: "label-stability", regions: "all" },
  ])
}
