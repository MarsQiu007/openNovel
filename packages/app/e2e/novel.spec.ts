import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "./utils/mock-server"
import { trackPageErrors } from "./utils/errors"
import { APP_READY_TIMEOUT } from "./utils/waits"

const directory = "/home/user/NovelProject"
const novelID = "novel-e2e-journey-001"
const now = Date.now()

// ─── Mock data ───

const mockNovel = {
  id: novelID,
  title: "星辰之旅",
  genre: "玄幻",
  synopsis: "A journey through the stars",
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
    characterCount: 2,
    wordCount: 400,
  },
}

const mockNovels = [mockNovel]

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
    volumeId: "vol-001",
    status: "drafting",
    wordCount: 200,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "ch-002",
    novelId: novelID,
    title: "第二章",
    order: 2,
    volumeId: "vol-001",
    status: "final",
    wordCount: 200,
    createdAt: now,
    updatedAt: now,
  },
]

const mockChapterDetail = {
  id: "ch-001",
  novelId: novelID,
  title: "第一章",
  order: 1,
  volumeId: "vol-001",
  status: "drafting",
  wordCount: 200,
  createdAt: now,
  updatedAt: now,
  content: "夜幕降临，星辰闪烁。\n\n少年仰望星空，心中充满了对未知的渴望。\n\n他知道，自己的命运即将改变。",
}

const mockOutline = {
  master: "# 星辰之旅\n\n## 大纲\n\n- 第一幕：启程\n- 第二幕：冒险\n- 第三幕：归来",
  volumes: [
    {
      volumeId: "vol-001",
      markdown: "## 第一卷大纲\n\n- 第一章：星辰初现\n- 第二章：命运转折",
    },
  ],
  chapters: [
    {
      chapterId: "ch-001",
      markdown: "### 第一章：星辰初现\n\n少年仰望星空...",
    },
  ],
}

const mockTension = [
  {
    id: "ten-001",
    novelId: novelID,
    chapterNumber: 1,
    level: 5,
    createdAt: now,
  },
  {
    id: "ten-002",
    novelId: novelID,
    chapterNumber: 2,
    level: 7,
    createdAt: now,
  },
]

const mockCharacters = [
  {
    id: "char-001",
    novelId: novelID,
    name: "星尘",
    role: "主角",
    description: "一个充满好奇心的少年，梦想探索宇宙。",
    createdAt: now,
  },
  {
    id: "char-002",
    novelId: novelID,
    name: "月影",
    role: "导师",
    description: "神秘的星空导师，引导主角踏上旅程。",
    createdAt: now,
  },
]

const mockPlotThreads: Array<Record<string, unknown>> = []
const mockForeshadowing: Array<Record<string, unknown>> = []
const mockWorldEntries: Array<Record<string, unknown>> = []

// ─── Test ───

test.describe("novel journey", () => {
  test.setTimeout(120_000)

  test("completes full novel writing journey: bookshelf → wizard → workspace → reader → approval → editor → panels", async ({
    page,
  }) => {
    const errors = trackPageErrors(page)

    // Mock the standard OpenNovel server API
    await mockOpenNovelServer(page, {
      sessions: [],
      provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
      directory,
      project: { id: "proj-novel-e2e", directory },
      pageMessages: () => ({ items: [] }),
    })

    // Mock novel API endpoints
    await page.route(/\/api\/novel/, async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname
      const method = route.request().method()

      // GET /api/novel — list novels
      if (method === "GET" && path === "/api/novel") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockNovels),
        })
      }

      // POST /api/novel — create novel
      if (method === "POST" && path === "/api/novel") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockNovel),
        })
      }

      // GET /api/novel/:novelID — novel detail
      if (method === "GET" && path === `/api/novel/${novelID}`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockNovel),
        })
      }

      // GET /api/novel/:novelID/chapters/:chapterID — chapter detail
      const chapterMatch = path.match(/^\/api\/novel\/[^/]+\/chapters\/([^/]+)$/)
      if (method === "GET" && chapterMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...mockChapterDetail, id: chapterMatch[1] }),
        })
      }

      // GET /api/novel/:novelID/chapters/:chapterID/versions — chapter versions
      const versionsMatch = path.match(/^\/api\/novel\/[^/]+\/chapters\/([^/]+)\/versions$/)
      if (method === "GET" && versionsMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        })
      }

      // GET /api/novel/:novelID/chapters/:chapterID/reviews — chapter reviews
      const reviewsMatch = path.match(/^\/api\/novel\/[^/]+\/chapters\/([^/]+)\/reviews$/)
      if (method === "GET" && reviewsMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        })
      }

      // GET /api/novel/:novelID/chapters — chapters
      if (path === `/api/novel/${novelID}/chapters`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockChapters),
        })
      }

      // GET /api/novel/:novelID/volumes — volumes
      if (path === `/api/novel/${novelID}/volumes`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockVolumes),
        })
      }

      // GET /api/novel/:novelID/outline — outline
      if (path === `/api/novel/${novelID}/outline`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockOutline),
        })
      }

      // GET /api/novel/:novelID/tension — tension
      if (path === `/api/novel/${novelID}/tension`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockTension),
        })
      }

      // GET /api/novel/:novelID/characters — characters
      if (path === `/api/novel/${novelID}/characters`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockCharacters),
        })
      }

      // GET /api/novel/:novelID/plot-threads / foreshadowing / world-entries / character-states
      if (
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

      // POST /api/novel/:novelID/chapters/:chapterID/approval — approval
      if (path.includes("/approval")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "ch-001", status: "final" }),
        })
      }

      // for-session: /api/novel/for-session/:sessionID
      if (path.includes("/for-session/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockNovel),
        })
      }

      // Default fallback — return empty JSON for unmatched novel API paths
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
    })

    // ════════════════════════════════════════════════
    // Step 1: Bookshelf — navigate to home page
    // ════════════════════════════════════════════════
    await page.goto("/", { waitUntil: "load" })
    await page.waitForTimeout(3000)

    // ════════════════════════════════════════════════
    // Step 2: Wizard — navigate to novel wizard
    // ════════════════════════════════════════════════
    await page.goto(`/${base64Encode(directory)}/novel/wizard`, { waitUntil: "load" })

    // Step 0: Select genre — click the Xuanhuan button
    const genreButton = page.getByText("Xuanhuan").first()
    await genreButton.click()

    // Click "Continue" to go to step 1
    const continueBtn = page.getByText("Continue")
    await continueBtn.click()

    // Step 1: Enter title
    const titleInput = page.locator('input[type="text"]')
    await titleInput.fill("星辰之旅")
    await continueBtn.click()

    // Step 2: Enter synopsis
    const synopsisTextarea = page.locator("textarea")
    await synopsisTextarea.fill(
      "A journey through the stars — a young boy discovers his destiny among the constellations.",
    )
    await continueBtn.click()

    // Step 3: Confirm — verify summary shows
    // The confirm step shows the title, genre, synopsis
    await expect(page.getByText("星辰之旅")).toBeVisible()

    // Screenshot: wizard confirm
    await page.screenshot({ path: "../.omo/evidence/task-35-wizard.png", fullPage: true })

    // Click submit
    const submitBtn = page.getByText("Submit")
    await submitBtn.click()

    // After submission, the wizard navigates to the workspace URL
    // Wait for the workspace to load
    await page.waitForURL(`**/${base64Encode(directory)}/novel/${novelID}`, { timeout: APP_READY_TIMEOUT })

    // ════════════════════════════════════════════════
    // Step 3: Workspace — verify three areas render
    // ════════════════════════════════════════════════
    // Verify the novel title in the workspace header
    await expect(page.getByText("星辰之旅")).toBeVisible({ timeout: APP_READY_TIMEOUT })
    // Verify genre badge
    await expect(page.getByText("Xuanhuan")).toBeVisible()
    // Verify status badge
    await expect(page.getByText("draft")).toBeVisible()

    // Screenshot: workspace
    await page.screenshot({ path: "../.omo/evidence/task-35-workspace.png", fullPage: true })

    // ════════════════════════════════════════════════
    // Step 4: Sidebar — verify chapter sidebar
    // ════════════════════════════════════════════════
    // Verify volume header
    await expect(page.getByText("第一卷")).toBeVisible()
    // Verify chapter titles in sidebar
    await expect(page.getByText("第一章").first()).toBeVisible()
    await expect(page.getByText("第二章").first()).toBeVisible()

    // ════════════════════════════════════════════════
    // Step 5: Reader — click a chapter and verify reader
    // ════════════════════════════════════════════════
    // Click the first chapter in the sidebar
    const firstChapter = page.getByText("第一章").first()
    await firstChapter.click()

    // Wait for the chapter reader to render with the novel-reading class
    await page.waitForSelector(".novel-reading", { timeout: APP_READY_TIMEOUT })
    // Verify chapter title in reader
    await expect(page.getByText("第一章").first()).toBeVisible()
    // Verify content renders
    await expect(page.getByText("夜幕降临，星辰闪烁")).toBeVisible()

    // Screenshot: reader
    await page.screenshot({ path: "../.omo/evidence/task-35-reader.png", fullPage: true })

    // ════════════════════════════════════════════════
    // Step 6: Approval — verify approval bar with approve/reject buttons
    // ════════════════════════════════════════════════
    // Chapter 1 has status "drafting" which maps to "pending" approval
    // The approval bar should show approve and reject buttons
    await expect(page.getByText("Approve")).toBeVisible({ timeout: APP_READY_TIMEOUT })
    await expect(page.getByText("Reject")).toBeVisible()

    // Screenshot: approval
    await page.screenshot({ path: "../.omo/evidence/task-35-approval.png", fullPage: true })

    // ════════════════════════════════════════════════
    // Step 7: Editor — switch to writing tab and verify editor
    // ════════════════════════════════════════════════
    // Click the "Writing" tab
    const writingTab = page.getByRole("button", { name: "Writing", exact: true })
    await writingTab.click()

    // Wait for the editor textarea to render
    await page.waitForSelector("textarea", { timeout: APP_READY_TIMEOUT })
    // Verify the editor shows the chapter content
    await expect(page.locator("textarea")).toHaveValue(/夜幕降临，星辰闪烁/)

    // Screenshot: editor
    await page.screenshot({ path: "../.omo/evidence/task-35-editor.png", fullPage: true })

    // ════════════════════════════════════════════════
    // Step 8: Panels — click right panel tabs
    // ════════════════════════════════════════════════
    // Switch back to reading tab first to see panels
    const readingTab = page.getByRole("button", { name: "Reading" })
    await readingTab.click()
    await page.waitForTimeout(500)

    // Panel: Characters tab (default)
    const charactersTab = page.getByRole("button", { name: "Characters" })
    await expect(charactersTab).toBeVisible()
    await charactersTab.click()
    await page.waitForTimeout(300)
    // Verify character list renders
    await expect(page.getByText("星尘")).toBeVisible()

    // Panel: Tension tab
    const tensionTab = page.getByRole("button", { name: "Tension" })
    await tensionTab.click()
    await page.waitForTimeout(300)
    // Verify tension chart renders (it has an SVG with viewBox)
    await expect(page.locator('svg[viewBox="0 0 320 180"]')).toBeVisible()

    // Verify no page errors
    expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
  })
})
