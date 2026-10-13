import { expect, test, type Page, type Route } from "@playwright/test"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"

// 独立会话路由已退役为重定向宿主（session-book-only）：会话页统一嵌在书籍工作台，
// 设置对话框的"当前服务器上下文"跟随聚焦服务器。test 1 迁移到工作台路由验证
// 远端服务器上下文；原 test 2（未聚焦服务器上后台会话的自动批准响应）覆盖的
// 跨服务器独立会话面已随路由退役，无对应 UI 宿主，用例随之移除——同服务器的
// 自动批准行为仍由 test 1 与 permission-auto-respond 单测覆盖。
const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const directoryA = "C:/server-a"
const directoryB = "/home/server-b"
const novelID = "novel_server_b"
const sessionA = session("ses_server_a", directoryA, "Server A session")
const childSessionA = { ...session("ses_server_a_child", directoryA, "Server A child session"), parentID: sessionA.id }
const sessionB = session("ses_server_b", directoryB, "Server B session")

test("session settings use the remote server context", async ({ page }) => {
  const permissionRequests: string[] = []
  await mockServers(page, permissionRequests)
  await mockNovelWorkspaceAPIs(page, { directory: directoryB, novelID, boundSessionIDs: [sessionB.id] })
  await configureServers(page)

  await page.goto(novelWorkspaceURL(directoryB, novelID, sessionB.id))
  await expect(page.getByRole("heading", { name: sessionB.title })).toBeVisible()
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,")

  const dialog = page.locator(".settings-v2-dialog")
  const autoAccept = dialog.locator('[data-action="settings-auto-accept-permissions"]')
  const input = autoAccept.getByRole("switch")
  await expect(autoAccept).toBeVisible()
  await expect(input).toBeEnabled()
  permissionRequests.length = 0
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(input).toBeChecked()
  await expect
    .poll(() =>
      permissionRequests.some((request) => {
        const url = new URL(request)
        return url.origin === serverB && url.searchParams.get("directory") === directoryB
      }),
    )
    .toBe(true)
  expect(permissionRequests.every((request) => new URL(request).origin === serverB)).toBe(true)

  await dialog.getByRole("tab", { name: "Models" }).click()
  await expect(dialog.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(dialog.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
})

type PermissionResponse = {
  origin: string
  directory?: string
  sessionID: string
  permissionID: string
  body: unknown
}

async function configureServers(page: Page) {
  await page.addInitScript(
    (serverB) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opennovel.global.dat:server", JSON.stringify({ list: [serverB] }))
      // 工作台路由无 server 段：通过默认服务器把远端上下文设为当前，directory 才能在该服务器上解析
      localStorage.setItem("opennovel.settings.dat:defaultServerUrl", serverB)
    },
    serverB,
  )
}

async function mockServers(page: Page, permissionRequests: string[], permissionResponses: PermissionResponse[] = []) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverA && url.origin !== serverB) return route.fallback()
    if (url.pathname === "/api/sync/run") return json(route, { results: [] })
    if (url.pathname === "/api/novel" || url.pathname === "/api/novel/session-bindings" || url.pathname.endsWith("/annotations")) return json(route, [])
    const remote = url.origin === serverB
    const directory = remote ? directoryB : directoryA
    const sessions = remote ? [sessionB] : [sessionA, childSessionA]
    const requestDirectory = url.searchParams.get("directory")
    const response = url.pathname.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/)
    if (route.request().method() === "POST" && response) {
      permissionResponses.push({
        origin: url.origin,
        directory: requestDirectory ?? undefined,
        sessionID: response[1]!,
        permissionID: response[2]!,
        body: route.request().postDataJSON(),
      })
      return json(route, true)
    }
    if (requestDirectory && requestDirectory !== directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (url.pathname === "/global/event" || url.pathname === "/event") return sse(route)
    if (url.pathname === "/global/health") return json(route, { healthy: true })
    if (url.pathname === "/api/session") return json(route, { data: sessions.map(v2Session), cursor: {} })
    if (url.pathname === "/experimental/capabilities") return json(route, { backgroundSubagents: false })
    const v2Match = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (v2Match) {
      const found = sessions.find((item) => item.id === v2Match[1])
      return json(route, found ? v2Session(found) : { name: "NotFoundError" }, found ? 200 : 404)
    }
    if (url.pathname === "/session/status") return json(route, {})
    if (url.pathname === "/session") return json(route, sessions)
    const current = sessions.find((session) => url.pathname === `/session/${session.id}`)
    if (current) return json(route, current)
    if (/^\/session\/[^/]+$/.test(url.pathname)) return json(route, { name: "NotFoundError" }, 404)
    if (/^\/session\/[^/]+\/message$/.test(url.pathname)) return json(route, [])
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(url.pathname)) return json(route, [])
    if (url.pathname === "/permission") {
      permissionRequests.push(url.toString())
      return json(route, [])
    }
    if (["/skill", "/command", "/lsp", "/formatter", "/question", "/vcs/diff", "/pty/shells"].includes(url.pathname))
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp"].includes(url.pathname)) return json(route, {})
    if (url.pathname === "/provider") return json(route, provider(remote ? "server-b" : "server-a"))
    if (url.pathname === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (url.pathname === "/project" || url.pathname === "/project/current") {
      const project = {
        id: remote ? sessionB.projectID : "project-server-a",
        worktree: directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(route, url.pathname === "/project" ? [project] : project)
    }
    if (url.pathname === "/path")
      return json(route, {
        state: directory,
        config: directory,
        worktree: directory,
        directory,
        home: directory,
      })
    if (url.pathname === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    return json(route, {})
  })
}

function session(id: string, directory: string, title: string) {
  return {
    id,
    slug: id,
    projectID: `project-${id}`,
    directory,
    title,
    version: "dev",
    time: { created: 1, updated: 1 },
  }
}

// v2 会话投影（书内绑定列表/lineage 走 /api/session 系列端点）
function v2Session(session: ReturnType<typeof session>) {
  return {
    id: session.id,
    parentID: (session as { parentID?: string }).parentID,
    projectID: session.projectID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: session.time.created, updated: session.time.updated },
    title: session.title,
    location: { directory: session.directory },
  }
}

function provider(id: string) {
  const name = id === "server-b" ? "Server B" : "Server A"
  return {
    all: [
      {
        id,
        name: `${name} Provider`,
        models: {
          [id]: {
            id,
            name: `${name} Model`,
            family: id,
            release_date: "2026-01-01",
            limit: { context: 200_000 },
          },
        },
      },
    ],
    connected: [id],
    default: { providerID: id, modelID: id },
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
