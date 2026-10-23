/// <reference lib="dom" />
// ^ page.evaluate 回调在浏览器页面上下文执行，需要 DOM 类型；core 基线不带 DOM lib，
//   仅本文件引用（skipLibCheck 下不影响其余文件）

export * as BrowserTool from "./browser"

import { ToolFailure } from "@opennovel-ai/llm"
import { Effect, Layer, Schema } from "effect"
import type { Browser, BrowserContext, Page } from "playwright-core"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { convertHTMLToMarkdown } from "./webfetch"

/**
 * 受控浏览器工具族（agent-browser-research）。
 *
 * 只读调研定位：每个会话 BrowserContext 挂路由拦截，页面内非 GET/HEAD 请求
 * 一律中止——表单提交、登录、写 API 在网络层物理不可达，不依赖提示词约束。
 * BrowserContext 按 sessionID 隔离（cookie/存储不跨会话共享），懒启动、
 * browser_close 显式关闭或随 Location 层终结整体回收。
 *
 * 整族共享 permission action "browser"（对齐 edit/write/apply_patch 的
 * "edit" 先例）：agent 权限 map 一条 `browser: allow|deny` 即同时完成
 * 目录过滤与执行授权；导航域白名单走 PermissionV2 既有 resource 通配。
 */

const ACTION = "browser"

const NAVIGATION_TIMEOUT_MS = 30_000
const MAX_ELEMENTS = 100
const MAX_EXTRACT_CHARS = 20_000

export const navigateName = "browser_navigate"
export const stateName = "browser_state"
export const clickName = "browser_click"
export const typeName = "browser_type"
export const extractName = "browser_extract"
export const closeName = "browser_close"

// ─── 会话级浏览器管理 ───

interface SessionPage {
  context: BrowserContext
  page: Page
}

function createManager() {
  let browserPromise: Promise<Browser> | null = null
  const sessions = new Map<string, Promise<SessionPage>>()

  const browser = () => {
    // 重模块动态导入：不进入宿主启动路径，首次浏览器调用才加载 playwright-core
    browserPromise ??= import("playwright-core").then(({ chromium }) => chromium.launch({ headless: true }))
    return browserPromise
  }

  const launch = async (): Promise<SessionPage> => {
    const instance = await browser()
    const context = await instance.newContext()
    await context.route("**/*", (route) => {
      const method = route.request().method()
      return method === "GET" || method === "HEAD" ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS)
    return { context, page }
  }

  const acquire = async (sessionID: string): Promise<SessionPage> => {
    const existing = sessions.get(sessionID)
    if (existing) {
      const sessionPage = await existing
      if (!sessionPage.page.isClosed()) return sessionPage
      // 页面被外部关闭（崩溃等）：丢弃旧 context，重建
      sessions.delete(sessionID)
      await sessionPage.context.close().catch(() => {})
    }
    const created = launch()
    sessions.set(sessionID, created)
    // 启动失败的 Promise 不缓存，下次调用重试
    created.catch(() => sessions.delete(sessionID))
    return created
  }

  const close = async (sessionID: string) => {
    const existing = sessions.get(sessionID)
    if (!existing) return false
    sessions.delete(sessionID)
    const sessionPage = await existing.catch(() => null)
    await sessionPage?.context.close().catch(() => {})
    return true
  }

  const dispose = async () => {
    const pending = [...sessions.values()]
    sessions.clear()
    for (const entry of pending) await entry.then((s) => s.context.close()).catch(() => {})
    const current = browserPromise
    browserPromise = null
    await current?.then((b) => b.close()).catch(() => {})
  }

  return { acquire, close, dispose, has: (id: string) => sessions.has(id) }
}

type Manager = ReturnType<typeof createManager>

// ─── 页面状态枚举（注入 data-opennovel-ref 编号供 click/type 引用） ───

const ElementInfo = Schema.Struct({
  ref: Schema.Number,
  tag: Schema.String,
  text: Schema.String,
})
/** 浏览器侧枚举产出的可变结构（Schema 类型字段为 readonly，evaluate 返回值赋回输出时需可变面） */
interface ElementData {
  ref: number
  tag: string
  text: string
}

// page.evaluate 序列化执行：函数必须自包含，不得引用闭包变量
const enumerateElements = (max: number): ElementData[] => {
  const selector =
    'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], summary'
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
  }
  const elements = Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, max)
  elements.forEach((el, index) => el.setAttribute("data-opennovel-ref", String(index)))
  return elements.map((el, index) => ({
    ref: index,
    tag: el.tagName.toLowerCase(),
    text: (
      el.getAttribute("aria-label") ||
      (el instanceof HTMLElement ? el.innerText : "") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("href") ||
      ""
    )
      .trim()
      .slice(0, 80),
  }))
}

const readState = async (page: Page) => ({
  url: page.url(),
  title: await page.title(),
  elements: await page.evaluate(enumerateElements, MAX_ELEMENTS),
})

// tryPromise 默认把拒绝原因包成 UnknownException（消息只剩 "An error occurred in
// Effect.tryPromise"）；统一透传原始错误，让 ToolFailure 携带可读原因
const tryPromise = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: (error) => error })

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error)

const failure = (tool: string) => (error: unknown) => new ToolFailure({ message: `${tool}: ${messageOf(error)}` })

const source = (context: Tool.Context) =>
  ({
    type: "tool" as const,
    messageID: context.assistantMessageID,
    callID: context.toolCallID,
  }) as const

// ─── 输入输出 Schema ───

export const NavigateInput = Schema.Struct({
  url: Schema.String.annotate({ description: "The http(s) URL to navigate to" }),
})
const NavigateOutput = Schema.Struct({ url: Schema.String, title: Schema.String })

export const StateInput = Schema.Struct({})
const StateOutput = Schema.Struct({ url: Schema.String, title: Schema.String, elements: Schema.Array(ElementInfo) })

export const ClickInput = Schema.Struct({
  ref: Schema.Number.annotate({ description: "Element ref from browser_state output" }),
})

export const TypeInput = Schema.Struct({
  ref: Schema.Number.annotate({ description: "Input element ref from browser_state output" }),
  text: Schema.String.annotate({ description: "Text to fill into the input element" }),
})

export const ExtractInput = Schema.Struct({
  selector: Schema.optional(
    Schema.String.annotate({
      description: "CSS selector of the content root. Defaults to article/main/[role=main]/body.",
    }),
  ),
})
const ExtractOutput = Schema.Struct({ url: Schema.String, title: Schema.String, markdown: Schema.String })

export const CloseInput = Schema.Struct({})
const CloseOutput = Schema.Struct({ closed: Schema.Boolean })

// ─── 工具构建 ───

const NOT_STARTED = `browser session not started; call ${navigateName} first`

const stateText = (state: { url: string; title: string; elements: readonly ElementData[] }) =>
  [
    `URL: ${state.url}`,
    `Title: ${state.title}`,
    state.elements.length === 0
      ? "No interactive elements."
      : `Interactive elements:\n${state.elements.map((el) => `[${el.ref}] <${el.tag}> ${el.text}`).join("\n")}`,
  ].join("\n")

// ─── 注册层 ───

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const manager = yield* Effect.acquireRelease(Effect.sync(createManager), (m) =>
      Effect.promise(() => m.dispose()),
    )
    // state/click/type/extract 要求会话已建立；未启动给清晰指引而非静默创建空白页
    const requirePage = (sessionID: string) => {
      if (!manager.has(sessionID)) throw new Error(NOT_STARTED)
      return manager.acquire(sessionID)
    }
    const assertAction = (context: Tool.Context, resources: string[], metadata?: Record<string, unknown>) =>
      permission.assert({
        action: ACTION,
        resources,
        save: ["*"],
        metadata,
        sessionID: context.sessionID,
        agent: context.agent,
        source: source(context),
      })

    yield* tools
      .register({
        [navigateName]: Tool.withPermission(
          Tool.make({
            description: `Navigate the session browser to an http(s) URL and return the loaded page URL and title. Read-only: the page cannot submit forms or send non-GET requests. Use ${stateName} afterwards to list interactive elements.`,
            input: NavigateInput,
            output: NavigateOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: `URL: ${output.url}\nTitle: ${output.title}` }],
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* Effect.try({
                  try: () => {
                    const parsed = new URL(input.url)
                    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                      throw new Error("URL must use http:// or https://")
                  },
                  catch: (error) => error,
                })
                yield* assertAction(context, [input.url], input)
                const { page } = yield* tryPromise(() => manager.acquire(context.sessionID))
                yield* tryPromise(() =>
                  page.goto(input.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }),
                )
                return { url: page.url(), title: yield* tryPromise(() => page.title()) }
              }).pipe(Effect.mapError(failure(navigateName))),
          }),
          ACTION,
        ),

        [stateName]: Tool.withPermission(
          Tool.make({
            description: `List the current page's visible interactive elements (links, buttons, inputs) with numeric refs for ${clickName}/${typeName}.`,
            input: StateInput,
            output: StateOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: stateText(output) }],
            execute: (_input, context) =>
              Effect.gen(function* () {
                yield* assertAction(context, ["*"])
                const { page } = yield* tryPromise(() => requirePage(context.sessionID))
                return yield* tryPromise(() => readState(page))
              }).pipe(Effect.mapError(failure(stateName))),
          }),
          ACTION,
        ),

        [clickName]: Tool.withPermission(
          Tool.make({
            description: `Click an element by ref from ${stateName} (pagination, expanding sections). Returns the refreshed page state; refs are invalidated by navigation.`,
            input: ClickInput,
            output: StateOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: stateText(output) }],
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* assertAction(context, ["*"], input)
                const { page } = yield* tryPromise(() => requirePage(context.sessionID))
                const locator = page.locator(`[data-opennovel-ref="${input.ref}"]`).first()
                const count = yield* tryPromise(() => locator.count())
                if (count === 0)
                  return yield* Effect.fail(
                    new Error(`element ref ${input.ref} not found; call ${stateName} to refresh the element list`),
                  )
                yield* tryPromise(() => locator.click())
                return yield* tryPromise(() => readState(page))
              }).pipe(Effect.mapError(failure(clickName))),
          }),
          ACTION,
        ),

        [typeName]: Tool.withPermission(
          Tool.make({
            description: `Fill text into an input element by ref (e.g. an on-site search box). Does not submit; combine with ${clickName} on the search button.`,
            input: TypeInput,
            output: NavigateOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: `URL: ${output.url}\nTitle: ${output.title}` }],
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* assertAction(context, ["*"], input)
                const { page } = yield* tryPromise(() => requirePage(context.sessionID))
                const locator = page.locator(`[data-opennovel-ref="${input.ref}"]`).first()
                const count = yield* tryPromise(() => locator.count())
                if (count === 0)
                  return yield* Effect.fail(
                    new Error(`element ref ${input.ref} not found; call ${stateName} to refresh the element list`),
                  )
                yield* tryPromise(() => locator.fill(input.text))
                return { url: page.url(), title: yield* tryPromise(() => page.title()) }
              }).pipe(Effect.mapError(failure(typeName))),
          }),
          ACTION,
        ),

        [extractName]: Tool.withPermission(
          Tool.make({
            description:
              "Extract the current page's main content as markdown (defaults to article/main/[role=main]/body, overridable by CSS selector).",
            input: ExtractInput,
            output: ExtractOutput,
            toModelOutput: ({ output }) => [
              { type: "text", text: `URL: ${output.url}\nTitle: ${output.title}\n\n${output.markdown}` },
            ],
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* assertAction(context, ["*"], input)
                const { page } = yield* tryPromise(() => requirePage(context.sessionID))
                const html = yield* tryPromise(() =>
                  page.evaluate((selector) => {
                    const root = selector
                      ? document.querySelector(selector)
                      : (document.querySelector("article") ??
                        document.querySelector("main") ??
                        document.querySelector('[role="main"]') ??
                        document.body)
                    return root?.innerHTML ?? ""
                  }, input.selector ?? null),
                )
                if (!html) return yield* Effect.fail(new Error("no content matched; check the selector or page state"))
                const markdown = convertHTMLToMarkdown(html)
                return {
                  url: page.url(),
                  title: yield* tryPromise(() => page.title()),
                  markdown:
                    markdown.length > MAX_EXTRACT_CHARS
                      ? `${markdown.slice(0, MAX_EXTRACT_CHARS)}\n…（内容过长已截断，可传 selector 缩小范围）`
                      : markdown,
                }
              }).pipe(Effect.mapError(failure(extractName))),
          }),
          ACTION,
        ),

        [closeName]: Tool.withPermission(
          Tool.make({
            description:
              "Close the session browser context and release its resources. Session state (cookies, storage) is discarded.",
            input: CloseInput,
            output: CloseOutput,
            toModelOutput: ({ output }) => [
              { type: "text", text: output.closed ? "browser session closed" : "no browser session to close" },
            ],
            execute: (_input, context) =>
              Effect.gen(function* () {
                yield* assertAction(context, ["*"])
                return { closed: yield* tryPromise(() => manager.close(context.sessionID)) }
              }).pipe(Effect.mapError(failure(closeName))),
          }),
          ACTION,
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/browser",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node],
})
