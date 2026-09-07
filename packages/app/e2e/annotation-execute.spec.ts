import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "./utils/mock-server"
import { APP_READY_TIMEOUT } from "./utils/waits"

const directory = "/home/user/NovelProject"
const novelID = "novel-annotation-execute"
const chapterID = "ch-001"
const sessionID = "session-annotation"
const now = Date.now()

const mockNovel = {
  id: novelID,
  title: "Annotation Book",
  genre: "Xuanhuan",
  synopsis: "Annotation execute e2e",
  status: "draft",
  createdAt: now,
  updatedAt: now,
  styleGuide: { id: "sg", novelId: novelID, rules: {}, tone: "neutral", pov: "third", tense: "past" },
  stats: { chapterCount: 1, volumeCount: 1, characterCount: 0, wordCount: 24 },
}

const mockVolumes = [{ id: "vol-001", novelId: novelID, title: "Volume 1", summary: "", order: 1, createdAt: now }]
const mockChapters = [{
  id: chapterID,
  novelId: novelID,
  title: "Chapter 1",
  order: 1,
  volumeId: "vol-001",
  status: "drafting",
  wordCount: 24,
  createdAt: now,
  updatedAt: now,
}]
const mockChapterDetail = {
  ...mockChapters[0],
  content: "夜幕降临，星辰闪烁。\n\n少年仰望星空，心中充满了对未知的渴望。",
}

type AnnotationState = Record<string, unknown>
let annotations: AnnotationState[] = []
let executionRounds: AnnotationState[] = []
let promptBody: unknown

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

async function mockNovelApi(page: Page) {
  await page.route(/\/api\/novel/, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname

    if (method === "GET" && path === "/api/novel") return json(route, [mockNovel])
    if (method === "GET" && path === `/api/novel/${novelID}`) return json(route, mockNovel)
    if (method === "GET" && path === `/api/novel/${novelID}/chapters`) return json(route, mockChapters)
    if (method === "GET" && path === `/api/novel/${novelID}/volumes`) return json(route, mockVolumes)
    if (method === "GET" && (path === `/api/novel/${novelID}/session-bindings` || path === "/api/novel/session-bindings")) {
      return json(route, [{ novelID, sessionID }])
    }

    if (method === "GET" && path === `/api/novel/${novelID}/chapters/${chapterID}`) {
      return json(route, mockChapterDetail)
    }

    if (method === "GET" && path === `/api/novel/${novelID}/chapters/${chapterID}/annotations`) {
      return json(route, annotations)
    }

    if (method === "POST" && path === `/api/novel/${novelID}/chapters/${chapterID}/annotations`) {
      const input = request.postDataJSON()
      const annotation = {
        id: "ann-e2e-1",
        novelId: novelID,
        chapterId: chapterID,
        source: input.source ?? "user",
        anchorType: input.anchorType ?? "range",
        paragraphIndex: input.paragraphIndex ?? null,
        startOffset: input.startOffset ?? null,
        endOffset: input.endOffset ?? null,
        quote: input.quote ?? "",
        comment: input.comment ?? "",
        suggestedReplacement: input.suggestedReplacement ?? null,
        status: "open",
        executionRoundId: null,
        createdAt: now,
        updatedAt: now,
      }
      annotations = [annotation]
      return json(route, annotation)
    }

    const updateAnnotation = path.match(/^\/api\/novel\/[^/]+\/annotations\/([^/]+)$/)
    if (method === "PUT" && updateAnnotation) {
      const input = request.postDataJSON()
      annotations = annotations.map((ann) => ann.id === updateAnnotation[1] ? { ...ann, ...input } : ann)
      return json(route, annotations.find((ann) => ann.id === updateAnnotation[1]))
    }

    if (method === "GET" && path === `/api/novel/${novelID}/chapters/${chapterID}/execution-rounds`) {
      return json(route, executionRounds)
    }

    if (method === "POST" && path === `/api/novel/${novelID}/chapters/${chapterID}/execution-rounds`) {
      const input = request.postDataJSON()
      const round = {
        id: "round-e2e-1",
        novelId: novelID,
        chapterId: chapterID,
        promptSnapshot: input.promptSnapshot ?? "",
        status: input.status ?? "running",
        annotationsSnapshot: input.annotationsSnapshot ?? [],
        resultSummary: input.resultSummary ?? "",
        createdAt: now,
      }
      executionRounds = [round]
      return json(route, round)
    }

    const updateRound = path.match(/\/execution-rounds\/([^/]+)$/)
    if (method === "PUT" && updateRound) {
      const input = request.postDataJSON()
      executionRounds = executionRounds.map((round) => round.id === updateRound[1] ? { ...round, ...input } : round)
      return json(route, executionRounds.find((round) => round.id === updateRound[1]))
    }

    return json(route, [])
  })
}

test.describe("annotation execute flow", () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test("creates annotation, executes it in a session, and archives its snapshot", async ({ page }) => {
    annotations = []
    executionRounds = []
    promptBody = undefined

    await mockOpenNovelServer(page, {
      sessions: [{ id: sessionID, title: "Annotation Session", directory }],
      provider: { id: "opennovel", model: "gpt-test", provider: "opennovel" },
      directory,
      project: { id: "project-annotation", directory },
      pageMessages: () => ({ items: [] }),
    })
    await mockNovelApi(page)

    await page.route(/\/session(\?.*)?$/, async (route) => {
      return json(route, [{ id: sessionID, parentID: null, time: { archived: false } }])
    })

    await page.route(new RegExp(`/session/${sessionID}/message(\\?.*)?$`), async (route) => {
      promptBody = route.request().postDataJSON()
      return json(route, { data: { id: "input-1", sessionID, prompt: { text: "" } } })
    })

    await page.addInitScript(() => {
      localStorage.setItem("opennovel-color-scheme", "light")
      localStorage.setItem("opennovel.global.dat:language", JSON.stringify({ locale: "en" }))
    })

    await page.goto(`/${base64Encode(directory)}/novel/${novelID}`)
    await page.getByRole("button", { name: "Reading" }).click()
    await expect(page.getByText("夜幕降临，星辰闪烁。")).toBeVisible({ timeout: APP_READY_TIMEOUT })

    const paragraph = page.locator("p[data-paragraph-index='0']")
    await page.evaluate(() => {
      const paragraph = document.querySelector("p[data-paragraph-index='0']")
      const text = paragraph?.firstChild
      if (!paragraph || !text) throw new Error("paragraph text not found")
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 4)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    const paragraphBox = await paragraph.boundingBox()
    await paragraph.dispatchEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: paragraphBox?.x + 20,
      clientY: paragraphBox?.y + 12,
    })
    await page.getByText("Add annotation").click()
    await page.getByPlaceholder("Comment (required)").fill("Make the opening stronger")
    await page.getByPlaceholder("Suggested replacement (optional)").fill("夜色深沉，星辰更亮。")
    await page.getByRole("button", { name: "Confirm" }).click()

    await expect.poll(() => annotations).toHaveLength(1)
    await page.getByRole("button", { name: "Annotations" }).click()
    await expect(page.getByRole("heading", { name: "Annotations" })).toBeVisible()
    await page.getByRole("button", { name: "Apply" }).click()

    const execute = page.getByRole("button", { name: "Execute" })
    await expect(execute).toBeEnabled()
    await execute.click()

    await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
    expect(promptBody).toBeTruthy()
    expect(JSON.stringify(promptBody)).toContain("annotation_id: ann-e2e-1")
    expect(JSON.stringify(promptBody)).toContain("selected_quote")
    expect(executionRounds[0]?.status).toBe("completed")

    await page.getByRole("button", { name: "Annotations" }).click()
    await page.getByRole("button", { name: "History" }).last().click()
    await expect(page.getByText("Make the opening stronger", { exact: true })).toBeVisible()

  })
})
