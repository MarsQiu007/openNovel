// V2 化（perf-benchmark-v2）：V2 投影的 assistant 不带 parentID，页首孤儿 turn 由
// repairParentIDs 按已加载时间线容错（server-session.ts:112-124），不再有单条父消息水合——
// 本基准随之改为测量「冷点击切入页首跨页孤儿 turn 会话」的首帧正确渲染，并断言
// parent 单条 GET 计数为 0（固化 V2 无父消息水合的设计事实）。
// mock 面：sessions 含目标会话（单条 GET 正常信封），sessionList 只列源会话
// （目标从列表缺席，对齐子代理先例）；messageDelay 语义内联进 beforeV2MessagesResponse（D3）。
import type { Page } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { mockOpenNovelServer } from "../../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../../utils/novel-workspace"
import { v2UserMessage } from "../../utils/v2-fixture"
import { benchmark, expect, withBenchmarkPage } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import { injectSessionLink, installTimelineSettings } from "./timeline-test-helpers"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"

const novelID = "novel_parent_hydration"
const userID = "msg_parent_hydration_user"
const userSeed = fixture.messages[fixture.targetID][0]!
const user = v2UserMessage({
  id: userID,
  text: userSeed.type === "user" ? userSeed.text : "",
  created: 1700001000000,
})
const assistantSeed = fixture.messages[fixture.targetID].filter((message) => message.type === "assistant")[1]!
// 24 条 assistant 超过首页 20（initialMessagePageSize）：user 落更旧分页，
// 首页成为全 assistant 的孤儿 turn 页（页首 assistant 的父消息不在已加载集合）
const assistants = Array.from({ length: 24 }, (_, index) => {
  const messageID = `msg_parent_hydration_${String(index).padStart(2, "0")}`
  return {
    ...assistantSeed,
    id: messageID,
    time: { created: 1700001001000 + index * 1_000, completed: 1700001001500 + index * 1_000 },
    content: assistantSeed.content.map((item, partIndex) => ({
      ...item,
      id: `prt_parent_hydration_${String(index).padStart(2, "0")}_${partIndex}`,
    })),
  }
})
const messages = [user, ...assistants]
const target = fixture.sessions.find((session) => session.id === fixture.targetID)!
const lastID = assistants.at(-1)!.id
const lastPartID = assistants.at(-1)!.content.at(-1)!.id

benchmark("renders an orphaned latest turn after a cold session click", async ({ browser, report }, testInfo) => {
  benchmark.setTimeout(180_000)
  const results = [] as Awaited<ReturnType<typeof trial>>[]
  for (let run = 0; run < 5; run++) {
    results.push(await withBenchmarkPage(browser, `session-parent-hydration-${run}`, (page) => trial(page), testInfo))
  }
  const timing = results.map((result) => result.metrics.firstCorrectObservedMs!).sort((a, b) => a - b)
  report(
    {
      results: results.map((result) => result.metrics),
      summary: {
        firstCorrectObservedMs: { min: timing[0], median: timing[2], max: timing.at(-1) },
        blankSamples: results.map((result) => result.metrics.blankSamples),
        requestCounts: {
          list: results.map((result) => result.requestCounts.list),
          parent: results.map((result) => result.requestCounts.parent),
        },
      },
    },
  )
})

async function trial(page: Page) {
  const requests: { type: "list" | "parent" }[] = []
  await mockOpenNovelServer(page, {
    sessions: fixture.sessions.filter((session) => session.id === fixture.sourceID || session.id === fixture.targetID),
    // 目标会话从列表缺席（冷直达链接场景），单条 GET 仍解析 sessions
    sessionList: fixture.sessions.filter((session) => session.id === fixture.sourceID),
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    v2Messages: (sessionID) => (sessionID === fixture.targetID ? messages : fixture.messages[fixture.sourceID]),
    onV2Messages: (request) => {
      if (request.sessionID === fixture.targetID && request.phase === "start") requests.push({ type: "list" })
    },
    // V1 messageDelay: 50 的等价物（D3）：模拟慢列表响应
    beforeV2MessagesResponse: () => new Promise((resolve) => setTimeout(resolve, 50)),
  })
  // 父消息单条 GET 观察层：计数后交回 mock 处理器（mock 不单设单条 GET 回调，D4）
  await page.route(`**/api/session/${fixture.targetID}/message/*`, (route) => {
    requests.push({ type: "parent" })
    return route.fallback()
  })
  await installTimelineSettings(page)
  await mockNovelWorkspaceAPIs(page, {
    directory: fixture.directory,
    novelID,
    boundSessionIDs: [fixture.sourceID],
  })
  await page.goto(novelWorkspaceURL(fixture.directory, novelID, fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)

  // 打开入口为注入的书内会话链接（套件诊断手法）：点击一步切换，供首帧采样
  const href = novelWorkspaceURL(fixture.directory, novelID, fixture.targetID)
  await injectSessionLink(page, { id: "parent-hydration-target", href, text: target.title as string })
  const metrics = await measureSessionSwitch(page, {
    destinationIDs: messages.map((message) => message.id),
    sourceIDs: fixture.messages[fixture.sourceID].map((message) => message.id),
    lastID,
    requiredPartID: lastPartID,
    requireBottomAnchor: false,
    href,
    switch: async () => {
      await page.locator("#parent-hydration-target").click()
      await expectSessionTitle(page, target.title as string)
    },
  })
  expect(metrics.firstCorrectObservedMs).not.toBeNull()
  const requestCounts = {
    list: requests.filter((request) => request.type === "list").length,
    parent: requests.filter((request) => request.type === "parent").length,
  }
  // V2 设计事实：页首孤儿 turn 容错渲染，不发生父消息单条水合
  expect(requestCounts.parent).toBe(0)
  return { metrics, requestCounts }
}
