import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { APP_READY_TIMEOUT } from "../utils/waits"

const directory = "C:/OpenNovel/NovelProject"
const novelID = "novel-e2e-live-001"
const now = Date.now()

const mockNovel = {
  id: novelID,
  title: "实时刷新测试小说",
  genre: "玄幻",
  synopsis: "A test novel for SSE live refresh e2e testing",
  status: "draft",
  createdAt: now,
  updatedAt: now,
  styleGuide: {
    id: "sg-001",
    novelId: novelID,
    rules: {},
    tone: "neutral",
    pov: "third",
    tense: "past",
  },
  stats: {
    chapterCount: 2,
    volumeCount: 1,
    characterCount: 0,
    wordCount: 400,
  },
}

const mockVolumes = [
  {
    id: "vol-001",
    novelId: novelID,
    title: "第一卷",
    summary: "Volume 1 introduction",
    order: 1,
    createdAt: now,
  },
]

const mockChapters = [
  {
    id: "ch-001",
    novelId: novelID,
    title: "第一章",
    order: 1,
    status: "draft",
    wordCount: 200,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "ch-002",
    novelId: novelID,
    title: "第二章",
    order: 2,
    status: "draft",
    wordCount: 200,
    createdAt: now,
    updatedAt: now,
  },
]

const mockOutline = {
  id: "outline-001",
  novelId: novelID,
  content: JSON.stringify({ acts: [{ title: "序章", summary: "Beginning" }] }),
  updatedAt: now,
}

const mockTension = [
  {
    id: "ten-001",
    novelId: novelID,
    chapterId: "ch-001",
    value: 5,
    label: "开场",
    createdAt: now,
  },
]

test.describe("novel-live", () => {
  test.setTimeout(120_000)

  test("wires useNovelLiveInvalidation and renders workspace without errors", async ({ page }) => {
    const errors = trackPageErrors(page)

    // Mock the standard OpenNovel server API (sessions, provider, etc.)
    await mockOpenNovelServer(page, {
      sessions: [],
      provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
      directory,
      project: { id: "proj-novel-e2e", directory },
      pageMessages: () => ({ items: [] }),
    })

    // Mock novel API endpoints — registered after mockOpenNovelServer so they
    // take priority for matching routes (Playwright LIFO order).
    await page.route("**/api/novel/**", async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname

      if (path === `/api/novel/${novelID}`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockNovel),
        })
      }

      if (path === `/api/novel/${novelID}/chapters`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockChapters),
        })
      }

      if (path === `/api/novel/${novelID}/volumes`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockVolumes),
        })
      }

      if (path === `/api/novel/${novelID}/outline`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockOutline),
        })
      }

      if (path === `/api/novel/${novelID}/tension`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockTension),
        })
      }

      // Characters / plot-threads / foreshadowing / world-entries / character-states return empty
      if (
        path === `/api/novel/${novelID}/characters` ||
        path === `/api/novel/${novelID}/plot-threads` ||
        path === `/api/novel/${novelID}/foreshadowing` ||
        path === `/api/novel/${novelID}/world-entries` ||
        path === `/api/novel/${novelID}/character-states`
      ) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        })
      }

      // for-session: /api/novel/:novelID/for-session/:sessionID
      if (path.includes("/for-session/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockNovel),
        })
      }

      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
    })

    // Navigate to the novel workspace page
    await page.goto(`/${base64Encode(directory)}/novel/${novelID}`)

    // Wait for the novel title to appear — confirms the page and data hooks loaded
    await expect(page.getByText("实时刷新测试小说")).toBeVisible({ timeout: APP_READY_TIMEOUT })

    // Verify chapter sidebar renders with both chapters
    await expect(page.getByText("第一章")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("第二章")).toBeVisible({ timeout: 10_000 })

    // Verify the useNovelLiveInvalidation hook did not cause errors
    expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
  })

  test("recovers from novel API errors gracefully", async ({ page }) => {
    const errors = trackPageErrors(page)

    await mockOpenNovelServer(page, {
      sessions: [],
      provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
      directory,
      project: { id: "proj-novel-e2e", directory },
      pageMessages: () => ({ items: [] }),
    })

    // Return 500 for all novel API calls
    await page.route("**/api/novel/**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Server error" }),
      })
    })

    await page.goto(`/${base64Encode(directory)}/novel/${novelID}`)

    // Should show error state, not crash
    await expect(page.getByText(/Back to Bookshelf/)).toBeVisible({ timeout: APP_READY_TIMEOUT })
    expect(
      errors.filter((e) => !e.includes("ExperimentalWarning") && !e.includes("Failed to load resource")),
    ).toHaveLength(0)
  })
})
