// V2 化注记（timeline-stability-v2）：纯分析器自校验场景，仅种子工厂换 v2-fixture（v2Text）。
import { expect, test } from "@playwright/test"
import {
  analyzeVisualObservations,
  defineVisualRegions,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import { v2Text } from "../../utils/v2-fixture"
import { assistantMessage, setupTimeline, userMessage } from "./fixture"

test("detects blanking caused by ancestor opacity", async ({ page }) => {
  const partID = "prt_oracle_ancestor_opacity"
  await setupTimeline(page, { messages: [userMessage(), assistantMessage([v2Text("Visible content", partID)])] })
  const row = page.locator(`[data-timeline-part-id="${partID}"]`).first()
  const regions = defineVisualRegions({
    content: { selector: `[data-timeline-part-id="${partID}"]` },
  })
  await startVisualProbe(page, regions)
  await row.evaluate((element) => {
    element.parentElement!.style.opacity = "0"
  })
  await page.waitForTimeout(50)
  await row.evaluate((element) => {
    element.parentElement!.style.opacity = "1"
  })
  await page.waitForTimeout(50)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  const issues = analyzeVisualObservations(
    trace.samples,
    visualPlan(regions, [
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all" },
      { type: "label-stability", regions: "all" },
    ]),
  )

  expect(issues.some((issue) => issue.includes("blanked between visible frames"))).toBe(true)
})

test("detects root opacity when probing descendant opacity", async ({ page }) => {
  const partID = "prt_oracle_descendant_opacity"
  await setupTimeline(page, { messages: [userMessage(), assistantMessage([v2Text("Visible content", partID)])] })
  const row = page.locator(`[data-timeline-part-id="${partID}"]`).first()
  await row.evaluate((element) => {
    element.innerHTML = '<span data-probe-opacity="true">Visible content</span>'
  })
  const regions = defineVisualRegions({
    content: {
      selector: `[data-timeline-part-id="${partID}"]`,
      opacitySelectors: ['[data-probe-opacity="true"]'],
    },
  })
  await startVisualProbe(page, regions)
  await row.evaluate((element) => {
    ;(element as HTMLElement).style.opacity = "0"
  })
  await page.waitForTimeout(50)
  await row.evaluate((element) => {
    ;(element as HTMLElement).style.opacity = "1"
  })
  await page.waitForTimeout(50)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  const issues = analyzeVisualObservations(
    trace.samples,
    visualPlan(regions, [
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all" },
      { type: "label-stability", regions: "all" },
    ]),
  )

  expect(issues.some((issue) => issue.includes("blanked between visible frames"))).toBe(true)
})
