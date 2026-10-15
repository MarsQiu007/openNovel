import type { Page } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { expectSessionTitle } from "../../utils/waits"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../../utils/novel-workspace"
import { benchmark, expect } from "../benchmark"
import { measureFirstNavigation } from "./first-navigation-probe"
import { fixture } from "./session-timeline-stress.fixture"
import { installTimelineSettings, mockStressTimeline } from "./timeline-test-helpers"
import { waitForStableTimeline } from "./session-tab-switch-probe"

const contentSelector = '[data-message-id], [data-component="prompt-input"]'

benchmark.describe("performance: first navigation paint", () => {
  benchmark("opens a child session without a blank frame", async ({ page, report }) => {
    await setup(page)
    const href = childSessionHref()
    const result = await measureFirstNavigation(page, {
      href,
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: messageSelector(fixture.expected.childMessageIDs.at(-1)!),
      contentSelector,
      navigate: async () => {
        await page.locator(`a[href="${href}"]`, { has: page.locator('[data-component="task-tool-card"]') }).click()
        await expectSessionTitle(page, fixture.expected.childTitle)
      },
    })
    report(result)
    expect(result.summary.blankSamples).toBe(0)
    expect(result.summary.unknownSamples).toBe(0)
  })
})

async function setup(page: Page) {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await mockNovelWorkspaceAPIs(page, {
    directory: fixture.directory,
    novelID: fixture.novelID,
    boundSessionIDs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })
  await page.goto(novelWorkspaceURL(fixture.directory, fixture.novelID, fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
}

// 子会话卡片由工作台链接提供层生成为书内地址：/:dir/novel/:novelID/session/:childID
function childSessionHref() {
  return `/${base64Encode(fixture.directory)}/novel/${fixture.novelID}/session/${fixture.childID}`
}

function messageSelector(id: string) {
  return `[data-message-id="${id}"]`
}
