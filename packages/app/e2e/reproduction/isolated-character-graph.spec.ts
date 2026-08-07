/**
 * 回归测试：全局关系图在只有角色、没有关系时仍应绘制孤立角色节点。
 */
import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"

const directory = "/home/user/NovelProject"
const now = Date.now()

const novelID = "novel-repro-isolated-node"

const mockNovel = {
  id: novelID,
  title: "孤立角色测试",
  genre: "玄幻",
  synopsis: "isolated",
  status: "draft",
  createdAt: now,
  updatedAt: now,
  styleGuide: { id: "sg-002", novelId: novelID, rules: {}, tone: "neutral", pov: "third", tense: "past" },
  stats: { chapterCount: 0, volumeCount: 0, characterCount: 2, wordCount: 0 },
}

const mockCharacters = [
  { id: "char-001", novelId: novelID, name: "星尘", role: "protagonist", description: "主角", status: "active", createdAt: now },
  { id: "char-002", novelId: novelID, name: "月影", role: "supporting", description: "配角", status: "active", createdAt: now },
]

const mockRelationships: never[] = []

function makeEightCharacterNovel() {
  const id = "novel-eight-characters"
  return {
    novel: {
      id,
      title: "八角色全局图测试",
      genre: "玄幻",
      synopsis: "eight",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      styleGuide: { id: "sg-008", novelId: id, rules: {}, tone: "neutral", pov: "third", tense: "past" },
      stats: { chapterCount: 0, volumeCount: 0, characterCount: 8, wordCount: 0 },
    },
    characters: [
      { id: "c-01", novelId: id, name: "岳飞", role: "protagonist", description: "主角", status: "active", createdAt: now },
      { id: "c-02", novelId: id, name: "司徒珩", role: "major", description: "", status: "active", createdAt: now },
      { id: "c-03", novelId: id, name: "陆沉", role: "supporting", description: "", status: "active", createdAt: now },
      { id: "c-04", novelId: id, name: "司徒老帅", role: "supporting", description: "", status: "active", createdAt: now },
      { id: "c-05", novelId: id, name: "沈知白", role: "supporting", description: "", status: "active", createdAt: now },
      { id: "c-06", novelId: id, name: "白凛", role: "supporting", description: "", status: "active", createdAt: now },
      { id: "c-07", novelId: id, name: "姚清瑶", role: "supporting", description: "", status: "active", createdAt: now },
      { id: "c-08", novelId: id, name: "李铁山", role: "supporting", description: "孤立角色", status: "active", createdAt: now },
    ],
    relationships: [
      { id: "r-01", novelId: id, charAId: "c-01", charBId: "c-02", type: "师徒", description: "" },
      { id: "r-02", novelId: id, charAId: "c-01", charBId: "c-03", type: "同门", description: "" },
      { id: "r-03", novelId: id, charAId: "c-01", charBId: "c-04", type: "仇敌", description: "" },
      { id: "r-04", novelId: id, charAId: "c-02", charBId: "c-05", type: "朋友", description: "" },
      { id: "r-05", novelId: id, charAId: "c-03", charBId: "c-06", type: "朋友", description: "" },
      { id: "r-06", novelId: id, charAId: "c-04", charBId: "c-07", type: "朋友", description: "" },
      { id: "r-07", novelId: id, charAId: "c-05", charBId: "c-06", type: "朋友", description: "" },
    ],
  }
}

async function setupNovelMocks(page: import("@playwright/test").Page) {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-isolated", directory },
    pageMessages: () => ({ items: [] }),
  })

  await page.route(/\/api\/novel/, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

    if (method === "GET" && path === "/api/novel") return json([mockNovel])
    if (path === `/api/novel/${novelID}`) return json(mockNovel)
    if (path === `/api/novel/${novelID}/characters`) return json(mockCharacters)
    if (path === `/api/novel/${novelID}/relationships`) return json(mockRelationships)
    if (path === `/api/novel/${novelID}/chapters`) return json([])
    if (path === `/api/novel/${novelID}/volumes`) return json([])
    if (path === `/api/novel/${novelID}/outline`) return json([])
    if (path === `/api/novel/${novelID}/tension`) return json([])
    if (path === `/api/novel/${novelID}/plot-threads`) return json([])
    if (path === `/api/novel/${novelID}/foreshadowing`) return json([])
    if (path === `/api/novel/${novelID}/world-entries`) return json([])
    if (path.includes("/for-session/")) return json(mockNovel)
    return json({})
  })
}

async function setupEightCharacterMocks(page: import("@playwright/test").Page) {
  const { novel, characters, relationships } = makeEightCharacterNovel()
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-eight", directory },
    pageMessages: () => ({ items: [] }),
  })

  await page.route(/\/api\/novel/, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

    if (method === "GET" && path === "/api/novel") return json([novel])
    if (path === `/api/novel/${novel.id}`) return json(novel)
    if (path === `/api/novel/${novel.id}/characters`) return json(characters)
    if (path === `/api/novel/${novel.id}/relationships`) return json(relationships)
    if (path === `/api/novel/${novel.id}/chapters`) return json([])
    if (path === `/api/novel/${novel.id}/volumes`) return json([])
    if (path === `/api/novel/${novel.id}/outline`) return json([])
    if (path === `/api/novel/${novel.id}/tension`) return json([])
    if (path === `/api/novel/${novel.id}/plot-threads`) return json([])
    if (path === `/api/novel/${novel.id}/foreshadowing`) return json([])
    if (path === `/api/novel/${novel.id}/world-entries`) return json([])
    if (path.includes("/for-session/")) return json(novel)
    return json({})
  })

  return { novelId: novel.id, characters }
}

async function openNovelRelationsGraph(page: import("@playwright/test").Page, novelId: string) {
  await page.goto("/", { waitUntil: "load" })
  await page.waitForTimeout(3000)
  await page.goto(`/${base64Encode(directory)}/novel/${novelId}`, { waitUntil: "load" })

  const relationsTab = page.getByRole("button", { name: "Relations", exact: true }).first()
  await relationsTab.waitFor({ state: "visible", timeout: 30_000 })
  await relationsTab.click()

  const graphBtn = page.getByRole("button", { name: "Graph", exact: true })
  await graphBtn.waitFor({ state: "visible", timeout: 10_000 })
  await graphBtn.click()
}

test("isolated characters should still render in global relations graph", async ({ page }) => {
  const errors = trackPageErrors(page)
  await setupNovelMocks(page)
  await openNovelRelationsGraph(page, novelID)
  await page.waitForTimeout(1000)

  for (const name of ["星尘", "月影"]) {
    const node = page.locator('svg g:has(> circle)', { hasText: name }).first()
    await node.waitFor({ state: "visible", timeout: 15_000 })
    const box = await node.boundingBox()
    expect(box, `node for ${name} should be rendered and have a bounding box`).not.toBeNull()
  }

  const lines = await page.locator('svg line').count()
  expect(lines, "no edges should be rendered when there are no relationships").toBe(0)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})

test("ego graph for a character with zero direct relations should still render the character node", async ({ page }) => {
  const errors = trackPageErrors(page)
  await setupNovelMocks(page)
  await openNovelRelationsGraph(page, novelID)

  await page.getByRole("button", { name: /月影/, exact: false }).first().click()
  await page.waitForTimeout(800)

  const node = page.locator('svg g:has(> circle)', { hasText: "月影" }).first()
  await node.waitFor({ state: "visible", timeout: 15_000 })
  const box = await node.boundingBox()
  expect(box, "ego graph center node should render for character with no direct relations").not.toBeNull()

  await expect(page.getByText("暂无直接关系", { exact: false })).not.toBeVisible()

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})

test("global graph should render all 8 characters including an isolated one", async ({ page }) => {
  const errors = trackPageErrors(page)
  const { novelId, characters } = await setupEightCharacterMocks(page)
  await openNovelRelationsGraph(page, novelId)
  await page.waitForTimeout(1200)

  for (const c of characters) {
    const node = page.locator('svg g:has(> circle)', { hasText: c.name }).first()
    await expect(node, `node for ${c.name} should be visible in global graph`).toBeVisible()
    const box = await node.boundingBox()
    expect(box, `node for ${c.name} should have a bounding box`).not.toBeNull()
  }

  const lines = await page.locator('svg line').count()
  expect(lines, "all 7 relationship edges should be rendered").toBe(7)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})

test("global graph should render all 7 connected characters plus keep isolated ones in view", async ({ page }) => {
  const errors = trackPageErrors(page)
  const { novel, characters, relationships } = makeEightCharacterNovel()
  const sevenCharacters = characters.slice(0, 7)

  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-seven", directory },
    pageMessages: () => ({ items: [] }),
  })

  await page.route(/\/api\/novel/, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

    if (method === "GET" && path === "/api/novel") return json([novel])
    if (path === `/api/novel/${novel.id}`) return json(novel)
    if (path === `/api/novel/${novel.id}/characters`) return json(sevenCharacters)
    if (path === `/api/novel/${novel.id}/relationships`) return json(relationships)
    if (path === `/api/novel/${novel.id}/chapters`) return json([])
    if (path === `/api/novel/${novel.id}/volumes`) return json([])
    if (path === `/api/novel/${novel.id}/outline`) return json([])
    if (path === `/api/novel/${novel.id}/tension`) return json([])
    if (path === `/api/novel/${novel.id}/plot-threads`) return json([])
    if (path === `/api/novel/${novel.id}/foreshadowing`) return json([])
    if (path === `/api/novel/${novel.id}/world-entries`) return json([])
    if (path.includes("/for-session/")) return json(novel)
    return json({})
  })

  await openNovelRelationsGraph(page, novel.id)
  await page.waitForTimeout(1200)

  for (const c of sevenCharacters) {
    const node = page.locator('svg g:has(> circle)', { hasText: c.name }).first()
    await expect(node, `node for ${c.name} should be visible in global graph`).toBeVisible()
    const box = await node.boundingBox()
    expect(box, `node for ${c.name} should have a bounding box`).not.toBeNull()
  }

  const lines = await page.locator('svg line').count()
  expect(lines, "all 7 relationship edges should be rendered").toBe(7)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})
