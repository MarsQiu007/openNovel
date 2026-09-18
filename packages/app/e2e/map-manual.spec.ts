import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "./utils/mock-server"

const directory = "/home/user/MapProject"
const novelID = "novel-map-viewing"
const now = Date.now()

const novel = {
  id: novelID,
  title: "地图验证",
  genre: "玄幻",
  synopsis: "",
  status: "draft",
  createdAt: now,
  updatedAt: now,
}
const aggregate = {
  map: {
    id: "map-active",
    novelId: novelID,
    title: "九州正式图",
    description: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
  },
  features: [
    {
      id: "feature-region",
      mapId: "map-active",
      novelId: novelID,
      worldEntryId: "entry-1",
      kind: "region",
      name: "西荒",
      description: "广阔沙漠",
      color: "#e11d48",
      polygon: [
        { x: 1000, y: 1000 },
        { x: 5200, y: 1000 },
        { x: 4200, y: 4800 },
      ],
    },
    {
      id: "feature-place",
      mapId: "map-active",
      novelId: novelID,
      worldEntryId: "entry-1",
      kind: "place",
      name: "青石城",
      description: "商贸重镇",
      color: "#0ea5e9",
      x: 2400,
      y: 2600,
      polygon: [],
    },
  ],
  pins: [
    {
      id: "pin-1",
      mapId: "map-active",
      novelId: novelID,
      characterId: "char-1",
      featureId: "feature-place",
      x: 2400,
      y: 2600,
      createdAt: now,
      updatedAt: now,
    },
  ],
}
const draftAggregate = {
  map: {
    id: "map-draft",
    novelId: novelID,
    title: "九州草稿图",
    description: "",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  },
  features: [
    {
      id: "draft-region",
      mapId: "map-draft",
      novelId: novelID,
      kind: "region",
      name: "东林草稿",
      description: "",
      color: "#22c55e",
      polygon: [
        { x: 5200, y: 5200 },
        { x: 9000, y: 5200 },
        { x: 8200, y: 9000 },
      ],
    },
  ],
  pins: [],
}

test("renders map, hover details, draft switch and promote confirmation", async ({ page }) => {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-map", directory },
    pageMessages: () => ({ items: [] }),
  })

  const json = (route: import("@playwright/test").Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  await page.route(/\/api\/novel/, (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === "GET" && path === `/api/novel/${novelID}`) return json(route, novel)
    if (path === `/api/novel/${novelID}/outline`) return json(route, { master: "", volumes: [], chapters: [] })
    if (path === `/api/novel/${novelID}/maps/active`) return json(route, aggregate)
    if (path === `/api/novel/${novelID}/maps/draft`) return json(route, draftAggregate)
    if (
      path === `/api/novel/${novelID}/volumes` ||
      path === `/api/novel/${novelID}/chapters` ||
      path === `/api/novel/${novelID}/chapter-reviews` ||
      path === `/api/novel/${novelID}/character-states` ||
      path === `/api/novel/${novelID}/plot-threads` ||
      path === `/api/novel/${novelID}/foreshadowing`
    )
      return json(route, [])
    if (/^\/api\/novel\/[^/]+\/chapters\/[^/]+\/reviews$/.test(path)) return json(route, [])
    if (path === `/api/novel/${novelID}/characters`)
      return json(route, [
        {
          id: "char-1",
          novelId: novelID,
          name: "林九",
          role: "protagonist",
          description: "",
          status: "active",
          createdAt: now,
        },
      ])
    if (path === `/api/novel/${novelID}/world-entries`)
      return json(route, [
        { id: "entry-1", novelId: novelID, category: "地理", title: "西荒志", content: "", createdAt: now },
      ])
    return route.fallback()
  })

  await page.goto(`/${base64Encode(directory)}/novel/${novelID}/map`, { waitUntil: "load" })
  await page.locator("a[data-titlebar-tab-link]").click()
  await expect(page.getByRole("heading", { name: "地图验证" })).toBeVisible()
  await page.getByRole("button", { name: "Map" }).click()
  await expect(page.locator(".leaflet-container")).toBeVisible()
  await expect(page.locator(".leaflet-interactive")).toHaveCount(1)
  await expect(page.getByText("正式地图")).toBeVisible()
  await expect(page.getByRole("button", { name: "退出编辑" })).toBeVisible()

  await page.getByRole("button", { name: "退出编辑" }).click()
  await expect(page.locator(".leaflet-interactive")).toHaveCount(3)
  await expect(page.locator(".map-pin-icon")).toHaveCount(1)
  await page.locator(".leaflet-overlay-pane path").first().hover({ force: true })
  await expect(page.locator(".map-detail-tooltip")).toContainText("西荒")
  await expect(page.locator(".map-detail-tooltip")).toContainText("关联条目：西荒志")

  await page.getByRole("button", { name: "草稿", exact: true }).click()
  await expect(page.getByRole("button", { name: "退出编辑" })).toBeVisible()
  await expect(page.locator(".leaflet-interactive")).toHaveCount(1)
  await page.getByRole("button", { name: "确认生效" }).click()
  await expect(page.getByText("将替换正式地图「九州正式图」")).toBeVisible()
  await expect(page.getByText("2 个要素、1 个角色图钉")).toBeVisible()
})

test("shows empty state when no maps exist", async ({ page }) => {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-map-empty", directory },
    pageMessages: () => ({ items: [] }),
  })
  const json = (route: import("@playwright/test").Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  await page.route(/\/api\/novel/, (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === "GET" && path === `/api/novel/${novelID}`) return json(route, novel)
    if (path === `/api/novel/${novelID}/maps/active` || path === `/api/novel/${novelID}/maps/draft`)
      return json(route, null)
    if (path === `/api/novel/${novelID}/outline`) return json(route, { master: "", volumes: [], chapters: [] })
    if (
      path === `/api/novel/${novelID}/volumes` ||
      path === `/api/novel/${novelID}/chapters` ||
      path === `/api/novel/${novelID}/characters` ||
      path === `/api/novel/${novelID}/world-entries` ||
      path === `/api/novel/${novelID}/character-states`
    )
      return json(route, [])
    return route.fallback()
  })
  await page.goto(`/${base64Encode(directory)}/novel/${novelID}/map`, { waitUntil: "load" })
  await page.locator("a[data-titlebar-tab-link]").click()
  await expect(page.getByRole("heading", { name: "地图验证" })).toBeVisible()
  await page.getByRole("button", { name: "Map" }).click()
  await expect(page.getByText("还没有世界地图")).toBeVisible()
  await expect(page.getByText("创建一个空白地图草稿")).toBeVisible()
  await expect(page.getByRole("button", { name: "创建地图草稿" })).toBeVisible()
  await expect(page.locator(".leaflet-container")).toHaveCount(0)
  await page.getByRole("button", { name: "AI 生成" }).click()
  await expect(page.getByRole("heading", { name: "AI 生成地图" })).toBeVisible()
  await expect(page.getByPlaceholder("例：西部是沙漠，东部是群岛")).toBeVisible()
})
