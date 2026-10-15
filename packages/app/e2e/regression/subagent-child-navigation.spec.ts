import { base64Encode } from "@opennovel-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer, type MockSession } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectSessionTitle } from "../utils/waits"

// 独立会话路由已退役为重定向宿主（session-book-only）：子代理子会话直接落在
// 所属书籍工作台的对话面板，本 spec 工作台路由上验证导航与删除兜底；
// subagent-session-binding 追加覆盖「未绑定子代理经祖先绑定兜底进书」与
// 「孙级子代理沿整条父链回溯」两条链式归属路径。
const directory = "C:/OpenNovel/SubagentNavigation"
const novelID = "novel_subagent_navigation"
const projectID = "proj_subagent_navigation"
const parentID = "ses_subagent_parent"
const childID = "ses_subagent_child"
const grandchildID = "ses_subagent_grandchild"
const parentTitle = "Parent session"
const childTitle = "Subagent child session"
// Child session pages derive their heading from the task part that spawned them.
const taskDescription = "Inspect child navigation"
const grandchildTaskDescription = "Inspect grandchild navigation"

type EventPayload = { directory: string; payload: Record<string, unknown> }

type SetupOptions = {
  events?: () => EventPayload[]
  /** session-bindings mock 返回的绑定行；默认父、子会话均已绑定 */
  boundSessionIDs?: string[]
  /** 服务端会话配置；默认父 + 子（会话列表覆盖始终只返回父） */
  sessions?: MockSession[]
  pageMessages?: (sessionID: string) => { items: unknown[] }
}

test.use({ viewport: { width: 1440, height: 900 } })

test("navigates to a subagent child session missing from the session list", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)

  await expectSessionTitle(page, taskDescription)
  await expect(page.getByRole("heading", { name: parentTitle })).toHaveCount(0)

  const titlebarRight = page.locator("#opennovel-titlebar-right")
  await expect(titlebarRight.getByRole("button", { name: "Toggle review" })).toHaveCount(1)
})

test("unbound subagent child opens through its bound parent without degradation", async ({ page }) => {
  // 仅父会话持有绑定行：子代理自身无绑定，须沿父链回溯进书
  await setup(page, { boundSessionIDs: [parentID] })
  await openChildFromParent(page)

  await expectSessionTitle(page, taskDescription)
  await expect(page.getByText("会话未绑定书籍")).toHaveCount(0)
})

test("grandchild subagent walks the ancestor chain through an unbound middle parent", async ({ page }) => {
  // 孙级链：grandchild → child（无绑定）→ parent（已绑定）
  await setup(page, {
    boundSessionIDs: [parentID],
    sessions: [session(parentID, parentTitle, 1700000000000), childSession(), grandchildSession()],
    pageMessages: (sessionID) => ({
      items: sessionID === parentID ? parentMessages() : sessionID === childID ? childMessages() : [],
    }),
  })
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)

  const card = page.locator(`a[href="/${base64Encode(directory)}/session/${grandchildID}"]`)
  await expect(card).toBeVisible()
  await card.click()

  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${grandchildID}$`), { timeout: 15_000 })
  await expectSessionTitle(page, grandchildTaskDescription)
  await expect(page.getByText("会话未绑定书籍")).toHaveCount(0)
})

test("shows the not found fallback when the viewed session is deleted", async ({ page }) => {
  const events: EventPayload[] = []
  await setup(page, { events: () => events.splice(0, 1) })
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)

  events.push({
    directory,
    payload: { type: "session.deleted", properties: { info: childSession() } },
  })

  await expect(page.getByText("This session cannot be found")).toBeVisible()
  await expect(page.getByRole("button", { name: "Close Tab" })).toBeVisible()
  await expect(page.getByRole("heading", { name: taskDescription })).toHaveCount(0)
})

async function setup(page: Page, options: SetupOptions = {}) {
  await mockOpenNovelServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "subagent-navigation",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opennovel",
          name: "OpenNovel",
          models: {
            "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } },
          },
        },
      ],
      connected: ["opennovel"],
      default: { providerID: "opennovel", modelID: "claude-opus-4-6" },
    },
    sessions: options.sessions ?? [session(parentID, parentTitle, 1700000000000), childSession()],
    pageMessages:
      options.pageMessages ?? ((sessionID) => ({ items: sessionID === parentID ? parentMessages() : [] })),
    events: options.events,
    eventRetry: options.events ? 16 : undefined,
  })
  // The child session resolves via /session/:id but is absent from the /session list,
  // matching a subagent session that has not been loaded into the list cache yet.
  await page.route(
    (url) => url.pathname === "/session" && url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([session(parentID, parentTitle, 1700000000000)]),
      }),
  )
  await mockNovelWorkspaceAPIs(page, {
    directory,
    novelID,
    boundSessionIDs: options.boundSessionIDs ?? [parentID, childID],
  })
}

async function openChildFromParent(page: Page) {
  await page.goto(novelWorkspaceURL(directory, novelID, parentID))
  await expectSessionTitle(page, parentTitle)

  // 时间线子会话卡片链接沿用目录级会话路由（DirectoryDataProvider 的
  // onSessionHref）：/:dir/session/:childID——经重定向宿主查绑定后 replace 进书内
  const card = page.locator(`a[href="/${base64Encode(directory)}/session/${childID}"]`)
  await expect(card).toBeVisible()
  await card.click()

  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${childID}$`), { timeout: 15_000 })
}

function session(id: string, title: string, created: number, extra?: Record<string, unknown>) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
    ...extra,
  }
}

function childSession() {
  return session(childID, childTitle, 1700000001000, { parentID })
}

function grandchildSession() {
  return session(grandchildID, "Subagent grandchild session", 1700000002000, { parentID: childID })
}

function parentMessages() {
  const userID = "msg_user_0001"
  const assistantID = "msg_assistant_0001"
  return [
    {
      info: {
        id: userID,
        sessionID: parentID,
        role: "user",
        time: { created: 1700000000000 },
        agent: "build",
        model: { providerID: "opennovel", modelID: "claude-opus-4-6" },
      },
      parts: [
        {
          id: "prt_user_text_0001",
          sessionID: parentID,
          messageID: userID,
          type: "text",
          text: "Delegate work to a subagent",
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID: parentID,
        role: "assistant",
        time: { created: 1700000001000, completed: 1700000002000 },
        parentID: userID,
        modelID: "claude-opus-4-6",
        providerID: "opennovel",
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0.01,
        tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [
        {
          id: "prt_tool_task_0001",
          sessionID: parentID,
          messageID: assistantID,
          type: "tool",
          callID: "call_task_0001",
          tool: "task",
          state: {
            status: "completed",
            input: { description: taskDescription, subagent_type: "explore" },
            output: "Subagent finished",
            title: taskDescription,
            metadata: { sessionId: childID },
            time: { start: 1700000001000, end: 1700000002000 },
          },
        },
      ],
    },
  ]
}

function childMessages() {
  const userID = "msg_user_child_0001"
  const assistantID = "msg_assistant_child_0001"
  return [
    {
      info: {
        id: userID,
        sessionID: childID,
        role: "user",
        time: { created: 1700000001000 },
        agent: "build",
        model: { providerID: "opennovel", modelID: "claude-opus-4-6" },
      },
      parts: [
        {
          id: "prt_user_child_text_0001",
          sessionID: childID,
          messageID: userID,
          type: "text",
          text: "Delegate further to a nested subagent",
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID: childID,
        role: "assistant",
        time: { created: 1700000001100, completed: 1700000001200 },
        parentID: userID,
        modelID: "claude-opus-4-6",
        providerID: "opennovel",
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0.01,
        tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [
        {
          id: "prt_tool_task_child_0001",
          sessionID: childID,
          messageID: assistantID,
          type: "tool",
          callID: "call_task_child_0001",
          tool: "task",
          state: {
            status: "completed",
            input: { description: grandchildTaskDescription, subagent_type: "explore" },
            output: "Nested subagent finished",
            title: grandchildTaskDescription,
            metadata: { sessionId: grandchildID },
            time: { start: 1700000001100, end: 1700000001200 },
          },
        },
      ],
    },
  ]
}