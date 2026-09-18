import { expect, test, type Route } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "./utils/mock-server"

const directory = "/home/user/MapEditorProject"
const novelID = "novel-map-editor"
const now = Date.now()

const novel = {
  id: novelID,
  title: "地图编辑",
  genre: "玄幻",
  synopsis: "",
  status: "draft",
  createdAt: now,
  updatedAt: now,
}

const character = {
  id: "char-editor",
  novelId: novelID,
  name: "林九",
  role: "protagonist",
  description: "",
  status: "active",
  createdAt: now,
}

const worldEntry = {
  id: "entry-editor",
  novelId: novelID,
  category: "地理",
  title: "西荒志",
  content: "",
  createdAt: now,
}

const activeAggregate = {
  map: {
    id: "map-source",
    novelId: novelID,
    title: "九州正式图",
    description: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
  },
  features: [
    {
      id: "source-region",
      mapId: "map-source",
      novelId: novelID,
      worldEntryId: null,
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
      id: "source-place",
      mapId: "map-source",
      novelId: novelID,
      worldEntryId: "entry-editor",
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
      id: "source-pin",
      mapId: "map-source",
      novelId: novelID,
      characterId: character.id,
      featureId: "source-place",
      x: 2400,
      y: 2600,
      createdAt: now,
      updatedAt: now,
    },
  ],
}

function blankDraft() {
  return {
    map: {
      id: "map-editor-draft",
      novelId: novelID,
      title: "未命名地图",
      description: "",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    },
    features: [] as Array<Record<string, unknown>>,
    pins: [] as Array<Record<string, unknown>>,
  }
}

type EditorFixture = {
  active: typeof activeAggregate | null
  draft: ReturnType<typeof blankDraft> | null
  failNextFeaturePatch: boolean
  featurePatchAttempts: number
  requests: string[]
}

function setupEditorRoutes(page: import("@playwright/test").Page, fixture: EditorFixture) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

  return page.route(/\/api\/novel/, (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const label = `${method} ${path}`
    if (!fixture.requests.includes(label)) fixture.requests.push(label)
    const featureMatch = path.match(/^\/api\/novel\/[^/]+\/maps\/[^/]+\/features\/([^/]+)$/)

    if (method === "GET" && path === `/api/novel/${novelID}`) return json(route, novel)
    if (path === `/api/novel/${novelID}/outline`) return json(route, { master: "", volumes: [], chapters: [] })
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
    if (path === `/api/novel/${novelID}/characters`) return json(route, [character])
    if (path === `/api/novel/${novelID}/world-entries`) return json(route, [worldEntry])

    if (method === "GET" && path === `/api/novel/${novelID}/maps/active`) return json(route, fixture.active)
    if (method === "GET" && path === `/api/novel/${novelID}/maps/draft`) return json(route, fixture.draft)

    if (method === "POST" && path === `/api/novel/${novelID}/maps`) {
      fixture.draft = blankDraft()
      return json(route, fixture.draft.map)
    }

    if (method === "POST" && path === `/api/novel/${novelID}/maps/${fixture.draft?.map.id}/features`) {
      const body = request.postDataJSON()
      const feature = {
        id: `feature-${fixture.draft.features.length + 1}`,
        mapId: fixture.draft.map.id,
        novelId: novelID,
        worldEntryId: body.worldEntryId ?? null,
        polygon: [],
        ...body,
      }
      fixture.draft.features.push(feature)
      return json(route, feature)
    }

    if (method === "PATCH" && featureMatch) {
      fixture.featurePatchAttempts += 1
      if (fixture.failNextFeaturePatch) {
        fixture.failNextFeaturePatch = false
        return json(route, { message: "网络中断" }, 500)
      }
      const feature = fixture.draft?.features.find((item) => item.id === featureMatch[1])
      if (!feature) return json(route, { message: "要素不存在" }, 404)
      Object.assign(feature, request.postDataJSON())
      return json(route, feature)
    }

    if (method === "POST" && path === `/api/novel/${novelID}/maps/${fixture.draft?.map.id}/pins`) {
      const body = request.postDataJSON()
      if (fixture.draft.pins.some((pin) => pin.characterId === body.characterId)) {
        return json(route, { message: "同一角色在同一张地图上只能有一个图钉" }, 409)
      }
      const pin = {
        id: `pin-${fixture.draft.pins.length + 1}`,
        mapId: fixture.draft.map.id,
        novelId: novelID,
        featureId: null,
        ...body,
        createdAt: now,
        updatedAt: now,
      }
      fixture.draft.pins.push(pin)
      return json(route, pin)
    }

    if (method === "DELETE" && path === `/api/novel/${novelID}/maps/${fixture.draft?.map.id}`) {
      fixture.draft = null
      return json(route, { deleted: true })
    }

    return route.fallback()
  })
}

test("create blank draft, place and edit, reject duplicate pin", async ({ page }) => {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-map-editor", directory },
    pageMessages: () => ({ items: [] }),
  })
  const fixture: EditorFixture = {
    active: null,
    draft: null,
    failNextFeaturePatch: false,
    featurePatchAttempts: 0,
    requests: [],
  }
  setupEditorRoutes(page, fixture)

  await page.goto(`/${base64Encode(directory)}/novel/${novelID}/map`, { waitUntil: "load" })
  await page.locator("a[data-titlebar-tab-link]").click()
  await expect(page.getByRole("heading", { name: "地图编辑" })).toBeVisible()
  await page.getByRole("button", { name: "Map" }).click()
  await page.getByRole("button", { name: "创建地图草稿" }).click()
  await expect(page.getByRole("button", { name: "退出编辑" })).toBeVisible()
  await expect(fixture.requests).toContain(`POST /api/novel/${novelID}/maps`)

  await page.getByRole("button", { name: "地点", exact: true }).click()
  await page.locator(".leaflet-container").click({ position: { x: 320, y: 220 } })
  await expect(page.locator(".map-place-icon")).toHaveCount(1)
  await expect(fixture.requests).toContain(`POST /api/novel/${novelID}/maps/map-editor-draft/features`)

  await page.getByRole("button", { name: "选择" }).click()
  await page.locator(".map-place-icon").click()
  await page.getByRole("textbox", { name: "名称" }).fill("青石城")
  await page.locator("textarea").fill("商贸重镇")
  await expect
    .poll(() => fixture.draft?.features[0], { timeout: 5000 })
    .toMatchObject({ name: "青石城", description: "商贸重镇" })

  await page.getByRole("button", { name: "区域", exact: true }).click()
  await page.locator(".leaflet-container").click({ position: { x: 300, y: 350 } })
  await page.locator(".leaflet-container").click({ position: { x: 520, y: 350 } })
  await page.locator(".leaflet-container").click({ position: { x: 410, y: 450 } })
  await page.getByRole("button", { name: "闭合区域（3）" }).click()
  await expect
    .poll(() => fixture.draft?.features.at(1), { timeout: 5000 })
    .toMatchObject({ kind: "region", name: "未命名区域" })
  expect((fixture.draft?.features.at(1) as { polygon?: unknown[] }).polygon).toHaveLength(3)

  await page.getByRole("button", { name: "选择" }).click()
  await page.locator(".map-place-icon").click()
  await page.getByLabel("世界观条目").selectOption(worldEntry.id)
  await expect
    .poll(() => fixture.draft?.features.at(0), { timeout: 5000 })
    .toMatchObject({ worldEntryId: worldEntry.id })

  fixture.failNextFeaturePatch = true
  await page.locator("textarea").fill("丝绸与灵石集散地")
  await expect(page.getByText("保存失败")).toBeVisible()
  await expect(page.getByText("UnexpectedStatus")).toBeVisible()
  await page.getByRole("button", { name: "重试" }).click()
  await expect(page.getByText("保存失败")).toBeHidden()
  await expect
    .poll(() => fixture.draft?.features[0], { timeout: 5000 })
    .toMatchObject({ description: "丝绸与灵石集散地" })

  await page.getByRole("button", { name: "图钉", exact: true }).click()
  await page.getByTestId("pin-character-select").selectOption(character.id)
  await page.locator(".leaflet-container").click({ position: { x: 420, y: 260 } })
  await expect(page.locator(".map-pin-icon")).toHaveCount(1)
  await page.locator(".leaflet-container").click({ position: { x: 520, y: 320 } })
  await expect(page.getByText("该角色已有图钉").first()).toBeVisible()
})

test("drag a placed feature to save a new coordinate", async ({ page }) => {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-map-drag", directory },
    pageMessages: () => ({ items: [] }),
  })
  const fixture: EditorFixture = {
    active: null,
    draft: blankDraft(),
    failNextFeaturePatch: false,
    featurePatchAttempts: 0,
    requests: [],
  }
  fixture.draft.features.push({
    id: "feature-drag",
    mapId: "map-editor-draft",
    novelId: novelID,
    worldEntryId: null,
    kind: "place",
    name: "可拖动地点",
    description: "",
    color: "#4f46e5",
    x: 3000,
    y: 3000,
    polygon: [],
  })
  setupEditorRoutes(page, fixture)

  await page.goto(`/${base64Encode(directory)}/novel/${novelID}/map`, { waitUntil: "load" })
  await page.locator("a[data-titlebar-tab-link]").click()
  await page.getByRole("button", { name: "Map" }).click()
  await expect(page.locator(".map-place-icon")).toBeVisible()
  await expect(page.getByRole("button", { name: "退出编辑" })).toBeVisible()
  await page.waitForTimeout(100)

  const marker = page.locator(".map-place-icon")
  const box = await marker.boundingBox()
  expect(box).toBeTruthy()
  await marker.hover()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 40, { steps: 12 })
  await page.mouse.up()

  await expect.poll(() => fixture.draft?.features[0], { timeout: 5000 }).toMatchObject({ name: "可拖动地点" })
  await expect.poll(() => fixture.featurePatchAttempts, { timeout: 5000 }).toBeGreaterThan(0)
})

test("derive a draft from active map", async ({ page }) => {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-map-derive", directory },
    pageMessages: () => ({ items: [] }),
  })
  const fixture: EditorFixture = {
    active: structuredClone(activeAggregate),
    draft: null,
    failNextFeaturePatch: false,
    featurePatchAttempts: 0,
    requests: [],
  }
  setupEditorRoutes(page, fixture)

  await page.goto(`/${base64Encode(directory)}/novel/${novelID}/map`, { waitUntil: "load" })
  await page.locator("a[data-titlebar-tab-link]").click()
  await page.getByRole("button", { name: "Map" }).click()
  await page.getByRole("button", { name: "从正式地图派生草稿" }).click()
  await expect(page.getByRole("button", { name: "退出编辑" })).toBeVisible()
  await expect(page.locator(".map-place-icon")).toHaveCount(1)
  await expect(page.locator(".map-pin-icon")).toHaveCount(1)
  expect(fixture.draft?.features).toHaveLength(2)
  expect(fixture.requests).toContain(`POST /api/novel/${novelID}/maps/map-editor-draft/pins`)
})
