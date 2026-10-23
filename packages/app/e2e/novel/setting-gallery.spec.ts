import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"

/**
 * 设定图片画廊主路径（setting-entry-gallery tasks 5.1）：
 * 设定树进条目画廊 → 上传 → 网格出现 → 预览编辑说明 → 上移排序 → 删除确认后消失。
 * 服务端行为由带内存状态的 mock 端点承载（列表/上传/读取/说明/排序/删除）。
 */

const directory = "/home/user/GalleryProject"
const novelID = "novel-gallery-e2e"
const now = Date.now()

// 1x1 透明 PNG
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

type MockImage = {
  id: string
  novelId: string
  ownerType: string
  ownerId: string
  filename: string
  mime: string
  bytes: number
  source: string
  sortOrder: number
  note: string
  createdAt: number
}

/** 内存画廊状态：与真实服务端一致的行结构，sortOrder 由重排端点维护 */
function setupGalleryState() {
  const images: MockImage[] = []
  let seq = 0
  return {
    images,
    add(filename: string): MockImage {
      const row: MockImage = {
        id: `img-${++seq}`,
        novelId: novelID,
        ownerType: "world_entry",
        ownerId: "entry-1",
        filename,
        mime: "image/png",
        bytes: Buffer.from(PNG_BASE64, "base64").length,
        source: "upload",
        sortOrder: images.length,
        note: "",
        createdAt: now + seq,
      }
      images.push(row)
      return row
    },
  }
}

async function openEntryGallery(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "World Entries", exact: true }).click()
  await page.locator('[data-slot="settings-tree"]').getByRole("button", { name: "西荒志", exact: true }).click()
  await page.locator('button[data-slot="segmented-control-v2-item"]', { hasText: "Gallery" }).click()
}

test("条目画廊主路径：上传 → 网格 → 说明与排序 → 删除确认", async ({ page }) => {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-gallery", directory },
  })

  const state = setupGalleryState()
  const json = (route: import("@playwright/test").Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

  await page.route(/\/api\/novel/, (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (method === "GET" && path === `/api/novel/${novelID}`) return json(route, {
      id: novelID,
      title: "画廊走查",
      genre: "玄幻",
      synopsis: "",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    if (method === "GET" && path === `/api/novel/${novelID}/world-entries`)
      return json(route, [
        { id: "entry-1", novelId: novelID, category: "地理", title: "西荒志", content: "", createdAt: now },
      ])
    if (method === "GET" && path.endsWith("/review-inbox/counts")) return json(route, { total: 0, byKind: {} })
    if (method === "GET" && path.endsWith("/setting-images")) return json(route, { images: state.images })
    if (method === "POST" && path.endsWith("/setting-images")) {
      const body = route.request().postDataJSON() as { filename?: string }
      return json(route, state.add(body.filename ?? ""))
    }
    if (method === "GET" && /\/setting-images\/[^/]+$/.test(path)) return json(route, { dataUrl: PNG_DATA_URL })
    if (method === "PATCH" && /\/setting-images\/[^/]+$/.test(path)) {
      const body = route.request().postDataJSON() as { note: string }
      const id = path.split("/").pop()!
      const row = state.images.find((image) => image.id === id)
      if (row) row.note = body.note
      return json(route, row ?? null)
    }
    if (method === "POST" && path.endsWith("/setting-images/reorder")) {
      const body = route.request().postDataJSON() as { orderedIds: string[] }
      state.images.sort(
        (a, b) => body.orderedIds.indexOf(a.id) - body.orderedIds.indexOf(b.id),
      )
      for (const [index, image] of state.images.entries()) image.sortOrder = index
      return json(route, { images: state.images })
    }
    if (method === "DELETE" && /\/setting-images\/[^/]+$/.test(path)) {
      const id = path.split("/").pop()!
      const index = state.images.findIndex((image) => image.id === id)
      if (index >= 0) state.images.splice(index, 1)
      return json(route, { deleted: true })
    }
    if (
      path === `/api/novel/${novelID}/volumes` ||
      path === `/api/novel/${novelID}/chapters` ||
      path === `/api/novel/${novelID}/characters` ||
      path === `/api/novel/${novelID}/character-states` ||
      path === `/api/novel/${novelID}/plot-threads` ||
      path === `/api/novel/${novelID}/foreshadowing`
    )
      return json(route, [])
    return route.fallback()
  })
  await page.route(/\/api\/sync\/run/, (route) => json(route, { results: [] }))

  await page.goto(`/${base64Encode(directory)}/novel/${novelID}`, { waitUntil: "load" })
  await openEntryGallery(page)

  // 空态引导
  const gallery = page.getByTestId("setting-gallery")
  await expect(gallery.getByTestId("gallery-empty")).toBeVisible()

  // 上传两张 → 网格出现对应数量
  const png = Buffer.from(PNG_BASE64, "base64")
  const fileInput = gallery.locator('input[type="file"]')
  await fileInput.setInputFiles({ name: "场景-西荒.png", mimeType: "image/png", buffer: png })
  await expect(gallery.getByTestId("gallery-thumb")).toHaveCount(1)
  await fileInput.setInputFiles({ name: "场景-青石城.png", mimeType: "image/png", buffer: png })
  await expect(gallery.getByTestId("gallery-thumb")).toHaveCount(2)

  // 预览第一张：编辑说明保存后，重开预览仍回显（说明已持久化）
  await gallery.getByTestId("gallery-thumb").first().click()
  const preview = page.getByTestId("gallery-preview")
  await expect(preview).toBeVisible()
  await preview.getByTestId("gallery-note-input").fill("西荒入口参考图")
  await preview.getByRole("button", { name: "Save note" }).click()
  await preview.getByRole("button", { name: "Close", exact: true }).click()
  await expect(preview).toBeHidden()
  await gallery.getByTestId("gallery-thumb").first().click()
  await expect(preview.getByTestId("gallery-note-input")).toHaveValue("西荒入口参考图")

  // 第二张上移 → 网格首位交换
  await preview.getByRole("button", { name: "Close", exact: true }).click()
  await gallery.getByTestId("gallery-thumb").nth(1).click()
  await expect(page.getByTestId("gallery-preview")).toBeVisible()
  await page.getByTestId("gallery-preview").getByRole("button", { name: "Move up" }).click()
  await page.getByTestId("gallery-preview").getByRole("button", { name: "Close", exact: true }).click()
  await expect(gallery.getByTestId("gallery-thumb").first()).toHaveAttribute("data-image-id", "img-2")

  // 删除确认两步：确认后缩略图消失；删空后空态回归
  await gallery.getByTestId("gallery-thumb").first().click()
  await page.getByTestId("gallery-preview").getByRole("button", { name: "Delete image" }).click()
  await expect(page.getByTestId("gallery-preview").getByText("Delete this image? This cannot be undone.")).toBeVisible()
  await page.getByTestId("gallery-preview").getByTestId("gallery-delete-confirm").click()
  await expect(page.getByTestId("gallery-preview")).toBeHidden()
  await expect(gallery.getByTestId("gallery-thumb")).toHaveCount(1)

  await gallery.getByTestId("gallery-thumb").first().click()
  await page.getByTestId("gallery-preview").getByRole("button", { name: "Delete image" }).click()
  await page.getByTestId("gallery-preview").getByTestId("gallery-delete-confirm").click()
  await expect(page.getByTestId("gallery-preview")).toBeHidden()
  await expect(gallery.getByTestId("gallery-empty")).toBeVisible()
})
