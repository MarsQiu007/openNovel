import { beforeAll, afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { SessionV2 } from "@opennovel-ai/core/session"
import { BrowserTool } from "@opennovel-ai/core/tool/browser"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { ToolOutputStore } from "@opennovel-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

const sessionA = SessionV2.ID.make("ses_browser_a")
const sessionB = SessionV2.ID.make("ses_browser_b")
let assertions: PermissionV2.AssertInput[] = []
let postCount = 0

const allow = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)).pipe(Effect.asVoid),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const deny = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.fail(new PermissionV2.BlockedError({ rules: [] })),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const toolLayer = (permission: Layer.Layer<PermissionV2.Service>) =>
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, BrowserTool.node]), [
    [PermissionV2.node, permission],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ])
const it = testEffect(toolLayer(allow))
const denied = testEffect(toolLayer(deny))

const call = (name: string, input: unknown, sessionID = sessionA) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

// ─── 本地页面服务 ───

const PAGES: Record<string, string> = {
  "/js": `<html><head><title>JS 渲染页</title></head><body><div id="app"></div>
<script>document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("app").innerHTML = "<article><h1>天外遗迹</h1><p>JS 注入的正文内容</p></article>"
})</script></body></html>`,
  "/paged": `<html><head><title>分页页</title></head><body><article id="content"><p>第一页内容</p></article>
<button id="next">下一页</button>
<script>document.getElementById("next").addEventListener("click", () => {
  document.getElementById("content").innerHTML = "<p>第二页内容</p>"
})</script></body></html>`,
  "/search": `<html><head><title>搜索页</title></head><body>
<input id="q" placeholder="站内搜索"><button id="go">搜索</button><article id="results"></article>
<script>document.getElementById("go").addEventListener("click", () => {
  document.getElementById("results").innerHTML = "<p>结果：" + document.getElementById("q").value + "</p>"
})</script></body></html>`,
  "/form": `<html><head><title>表单页</title></head><body>
<form method="post" action="/submit"><input name="data" value="x"><button type="submit">提交</button></form>
</body></html>`,
}

let server: ReturnType<typeof Bun.serve>
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (request.method === "POST") {
        postCount++
        return new Response("posted")
      }
      // 中文页面必须声明 charset=utf-8，否则 Chromium 按 latin-1 解码出乱码
      if (url.pathname === "/set-cookie")
        return new Response("<html><body>ok</body></html>", {
          headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "probe=1; Path=/" },
        })
      if (url.pathname === "/show-cookie")
        return new Response(`<html><body>cookie: ${request.headers.get("cookie") ?? "none"}</body></html>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      const page = PAGES[url.pathname]
      return page
        ? new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
        : new Response("not found", { status: 404 })
    },
  })
})
afterAll(() => server.stop(true))

const url = (path: string) => new URL(path, server.url).toString()
const SLOW = { timeout: 60_000 }

describe("BrowserTool 只读约束与输入校验", () => {
  it.effect("非 http/https 协议在权限断言前拒绝", () =>
    Effect.gen(function* () {
      assertions = []
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, call(BrowserTool.navigateName, { url: "file:///etc/passwd" }))
      expect(result.type).toBe("error")
      expect(result.type === "error" && result.value).toContain("http")
      expect(assertions).toEqual([])
    }),
  )

  denied.effect("权限 deny 时不启动浏览器直接失败", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/js") }))
      expect(result.type).toBe("error")
    }),
  )

  it.effect("未 navigate 的会话读取 state 报未启动错误", () =>
    Effect.gen(function* () {
      assertions = []
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, call(BrowserTool.stateName, {}, SessionV2.ID.make("ses_fresh")))
      expect(result.type).toBe("error")
      expect(result.type === "error" && result.value).toContain("browser_navigate")
    }),
  )
})

describe("BrowserTool 页面交互（headless Chromium 集成）", () => {
  it.live("JS 渲染页面的内容提取（webfetch 拿不到的注入内容）", () =>
    Effect.gen(function* () {
      assertions = []
      const registry = yield* ToolRegistry.Service
      expect(yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/js") }))).toEqual({
        type: "text",
        value: `URL: ${url("/js")}\nTitle: JS 渲染页`,
      })
      expect(assertions).toMatchObject([{ action: "browser", resources: [url("/js")] }])

      const extracted = yield* executeTool(registry, call(BrowserTool.extractName, {}))
      expect(extracted.type).toBe("text")
      expect(extracted.type === "text" && extracted.value).toContain("天外遗迹")
      expect(extracted.type === "text" && extracted.value).toContain("JS 注入的正文内容")
    }),
    SLOW,
  )

  it.live("导航 → 状态 → 点击翻页 → 提取新内容", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/paged") }))

      const state = yield* executeTool(registry, call(BrowserTool.stateName, {}))
      expect(state.type).toBe("text")
      const stateText = state.type === "text" ? String(state.value) : ""
      const refMatch = stateText.match(/\[(\d+)\] <button> 下一页/)
      expect(refMatch).not.toBeNull()

      const clicked = yield* executeTool(registry, call(BrowserTool.clickName, { ref: Number(refMatch![1]) }))
      expect(clicked.type).toBe("text")

      const extracted = yield* executeTool(registry, call(BrowserTool.extractName, {}))
      expect(extracted.type === "text" && extracted.value).toContain("第二页内容")
      expect(extracted.type === "text" && extracted.value).not.toContain("第一页内容")
    }),
    SLOW,
  )

  it.live("type 填充站内搜索框并点击搜索", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/search") }))
      const state = yield* executeTool(registry, call(BrowserTool.stateName, {}))
      const stateText = state.type === "text" ? String(state.value) : ""
      const inputRef = stateText.match(/\[(\d+)\] <input> 站内搜索/)
      const buttonRef = stateText.match(/\[(\d+)\] <button> 搜索/)
      expect(inputRef).not.toBeNull()
      expect(buttonRef).not.toBeNull()

      yield* executeTool(registry, call(BrowserTool.typeName, { ref: Number(inputRef![1]), text: "明代服饰" }))
      yield* executeTool(registry, call(BrowserTool.clickName, { ref: Number(buttonRef![1]) }))

      const extracted = yield* executeTool(registry, call(BrowserTool.extractName, {}))
      expect(extracted.type === "text" && extracted.value).toContain("结果：明代服饰")
    }),
    SLOW,
  )

  it.live("只读硬约束：表单提交的非 GET 请求在网络层被拦截", () =>
    Effect.gen(function* () {
      postCount = 0
      const registry = yield* ToolRegistry.Service
      yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/form") }))
      const state = yield* executeTool(registry, call(BrowserTool.stateName, {}))
      const stateText = state.type === "text" ? String(state.value) : ""
      const submitRef = stateText.match(/\[(\d+)\] <button> 提交/)
      expect(submitRef).not.toBeNull()

      yield* executeTool(registry, call(BrowserTool.clickName, { ref: Number(submitRef![1]) }))
      // 等潜在的 POST 导航有时间发出（真实时钟）
      yield* Effect.sleep("500 millis")
      expect(postCount).toBe(0)
      // Chromium 对中止的主文档导航切到错误页——POST 未到达服务器，写操作物理不可达
      const after = yield* executeTool(registry, call(BrowserTool.stateName, {}))
      expect(after.type === "text" && after.value).toContain("chrome-error://")
    }),
    SLOW,
  )

  it.live("BrowserContext 按 sessionID 隔离（cookie 不跨会话）", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/set-cookie") }))
      const mine = yield* executeTool(
        registry,
        call(BrowserTool.navigateName, { url: url("/show-cookie") }),
      )
      expect(mine.type === "text" && mine.value).toContain("Title")
      const mineExtract = yield* executeTool(registry, call(BrowserTool.extractName, {}))
      expect(mineExtract.type === "text" && mineExtract.value).toContain("probe=1")

      const other = yield* executeTool(
        registry,
        call(BrowserTool.navigateName, { url: url("/show-cookie") }, sessionB),
      )
      expect(other.type).toBe("text")
      const otherExtract = yield* executeTool(registry, call(BrowserTool.extractName, {}, sessionB))
      expect(otherExtract.type === "text" && otherExtract.value).toContain("cookie: none")
      yield* executeTool(registry, call(BrowserTool.closeName, {}, sessionB))
    }),
    SLOW,
  )

  it.live("browser_close 释放会话；关闭后 state 报未启动；重复关闭返回 false", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const sid = SessionV2.ID.make("ses_browser_close")
      yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/js") }, sid))

      expect(yield* executeTool(registry, call(BrowserTool.closeName, {}, sid))).toEqual({
        type: "text",
        value: "browser session closed",
      })
      expect(yield* executeTool(registry, call(BrowserTool.closeName, {}, sid))).toEqual({
        type: "text",
        value: "no browser session to close",
      })
      const state = yield* executeTool(registry, call(BrowserTool.stateName, {}, sid))
      expect(state.type === "error" && state.value).toContain("browser_navigate")
    }),
    SLOW,
  )

  it.live("失效 ref 点击报清晰错误并提示刷新 state", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const sid = SessionV2.ID.make("ses_browser_stale")
      yield* executeTool(registry, call(BrowserTool.navigateName, { url: url("/js") }, sid))
      const result = yield* executeTool(registry, call(BrowserTool.clickName, { ref: 99 }, sid))
      expect(result.type === "error" && result.value).toContain("ref 99")
      expect(result.type === "error" && result.value).toContain("browser_state")
      yield* executeTool(registry, call(BrowserTool.closeName, {}, sid))
    }),
    SLOW,
  )
})
