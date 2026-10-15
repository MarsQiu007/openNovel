import type { Page } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../../utils/novel-workspace"
import { benchmark, expect } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import {
  collectCachedRepaintTrace,
  compressCachedRepaintTrace,
  installCachedRepaintProbe,
  waitForCachedRepaintWindow,
} from "./session-tab-repaint-probe"
import { waitForStableTimeline } from "./session-tab-switch-probe"
import { injectSessionLink, installTimelineSettings, mockStressTimeline } from "./timeline-test-helpers"

benchmark("samples cached session repaint after the click", async ({ page, report }) => {
  benchmark.setTimeout(120_000)
  await setup(page)
  await injectSessionLink(page, { id: "flash-source-link", href: sessionHref(fixture.sourceID) })
  await page.locator("#flash-source-link").click()
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)

  await installCachedRepaintProbe(page, {
    targetHref: sessionHref(fixture.targetID),
    destination: fixture.messages[fixture.targetID].map((message) => message.info.id),
    source: fixture.messages[fixture.sourceID].map((message) => message.info.id),
    last: fixture.expected.targetMessageIDs.at(-1)!,
    windowMs: 1_000,
  })

  await injectSessionLink(page, { id: "flash-target-link", href: sessionHref(fixture.targetID) })
  await page.locator("#flash-target-link").click()
  await Promise.all([expectSessionTitle(page, fixture.expected.targetTitle), waitForCachedRepaintWindow(page, 1_000)])
  const result = await collectCachedRepaintTrace(page)
  report(compressCachedRepaintTrace(result))
  expect(result.samples.length).toBeGreaterThan(0)
})

// 缓存回访：先访问 target 并切走，再经注入的书内链接切回，采样缓存重绘轨迹
async function setup(page: Page) {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await mockNovelWorkspaceAPIs(page, {
    directory: fixture.directory,
    novelID: fixture.novelID,
    boundSessionIDs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })
  await page.goto(novelWorkspaceURL(fixture.directory, fixture.novelID, fixture.targetID))
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await waitForStableTimeline(page, fixture.expected.targetMessageIDs.at(-1)!)
}

function sessionHref(sessionID: string) {
  return novelWorkspaceURL(fixture.directory, fixture.novelID, sessionID)
}
