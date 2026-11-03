import { expect, test, type Page, type Route } from "@playwright/test"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"

// 独立会话路由已退役为重定向宿主（session-book-only）：会话页统一嵌在书籍工作台，
// 设置对话框的"当前服务器上下文"跟随聚焦服务器。test 1 迁移到工作台路由验证
// 远端服务器上下文：权限模式三档切换（settings-permission-mode）经 global.config.update
// 写回，断言 PATCH 落在聚焦的 serverB 上——原 auto-accept 开关的等价覆盖。
const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const directoryA = "C:/server-a"
const directoryB = "/home/server-b"
const novelID = "novel_server_b"
const sessionA = session("ses_server_a", directoryA, "Server A session")
const childSessionA = { ...session("ses_server_a_child", directoryA, "Server A child session"), parentID: sessionA.id }
const sessionB = session("ses_server_b", directoryB, "Server B session")

test("session settings use the remote server context", async ({ page }) => {
  const configPatches: ConfigPatch[] = []
  await mockServers(page, configPatches)
  await mockNovelWorkspaceAPIs(page, { directory: directoryB, novelID, boundSessionIDs: [sessionB.id] })
  await configureServers(page)

  await page.goto(novelWorkspaceURL(directoryB, novelID, sessionB.id))
  await expect(page.getByRole("heading", { name: sessionB.title })).toBeVisible()
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,")

  const dialog = page.locator(".settings-v2-dialog")
  const modeSelect = dialog.locator('[data-action="settings-permission-mode"]')
  await expect(modeSelect).toBeVisible()
  configPatches.length = 0
  await modeSelect.click()
  // SelectV2 的 option 无计算可访问名（aria snapshot 呈无名 option），按列表内文本定位
  await page
    .locator('[data-slot="select-v2-listbox"]')
    .getByText("Auto approve", { exact: true })
    .click()
  await expect
    .poll(() => configPatches.some((patch) => patch.origin === serverB && patch.mode === "judge"))
    .toBe(true)
  expect(configPatches.every((patch) => patch.origin === serverB)).toBe(true)

  await dialog.getByRole("tab", { name: "Models" }).click()
  await expect(dialog.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(dialog.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
})

type ConfigPatch = {
  origin: string
  mode?: string
}

// 无类型断言读取 PATCH 体 permission.mode（postDataJSON 为 any，Reflect.get 窄化）
function readPermissionMode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const permission = Reflect.get(body, "permission")
  if (typeof permission !== "object" || permission === null) return undefined
  const mode = Reflect.get(permission, "mode")
  return typeof mode === "string" ? mode : undefined
}

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

async function mockServers(page: Page, configPatches: ConfigPatch[], permissionResponses: PermissionResponse[] = []) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverA && url.origin !== serverB) return route.fallback()
    if (url.pathname === "/api/sync/run") return json(route, { results: [] })
    if (url.pathname === "/api/novel" || url.pathname === "/api/novel/session-bindings" || url.pathname.endsWith("/annotations")) return json(route, [])
    const remote = url.origin === serverB
    const directory = remote ? directoryB : directoryA
    const sessions = remote ? [sessionB] : [sessionA, childSessionA]
    const requestDirectory = url.searchParams.get("directory")
    // 权限模式三档切换经 global.config.update 写回：捕获 PATCH 验证落在聚焦服务器上
    if (url.pathname === "/global/config" && route.request().method() === "PATCH") {
      configPatches.push({ origin: url.origin, mode: readPermissionMode(route.request().postDataJSON()) })
      return json(route, {})
    }
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
    // app 启动固定读取面（global-sync bootstrap）：空信封而非落入 v2Match 的 NotFoundError 404
    if (url.pathname === "/api/session/active") return json(route, { data: {} })
    if (/^\/api\/session\/[^/]+\/message$/.test(url.pathname)) return json(route, { data: [], cursor: {} })
    if (/^\/api\/session\/[^/]+\/message\/[^/]+$/.test(url.pathname)) return json(route, { error: "Message not found" }, 404)
    if (url.pathname === "/experimental/capabilities") return json(route, { backgroundSubagents: false })
    const v2Match = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (v2Match) {
      const found = sessions.find((item) => item.id === v2Match[1])
      // V2 单条 success 是 { data: SessionV2Info } 包装，裸对象会让 adaptInfo 读到 undefined
      return json(route, found ? { data: v2Session(found) } : { name: "NotFoundError" }, found ? 200 : 404)
    }
    if (url.pathname === "/session/status") return json(route, {})
    if (url.pathname === "/session") return json(route, sessions)
    const current = sessions.find((session) => url.pathname === `/session/${session.id}`)
    if (current) return json(route, current)
    if (/^\/session\/[^/]+$/.test(url.pathname)) return json(route, { name: "NotFoundError" }, 404)
    if (/^\/session\/[^/]+\/message$/.test(url.pathname)) return json(route, [])
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(url.pathname)) return json(route, [])
    if (url.pathname === "/api/permission/request") return json(route, { data: [], cursor: {} })
    if (url.pathname === "/permission") return json(route, [])
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
