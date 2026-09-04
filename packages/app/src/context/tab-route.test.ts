import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { currentRoute, novelTabTitle } from "./tab-route"
import type { ServerConnection } from "./server"

const dir = "/tmp/novels"
const dirBase64 = base64Encode(dir)

describe("currentRoute novel parsing", () => {
  test("parses the workspace route as a novel route", () => {
    expect(currentRoute(`/${dirBase64}/novel/n1`, "")).toEqual({
      type: "novel",
      dir,
      dirBase64,
      novelID: "n1",
    })
  })

  test("the in-novel session route resolves to the same novel route", () => {
    const main = currentRoute(`/${dirBase64}/novel/n1`, "")
    const withSession = currentRoute(`/${dirBase64}/novel/n1/session/s1`, "")

    expect(withSession).toEqual(main)
  })

  test("the wizard route does not produce a novel route", () => {
    expect(currentRoute(`/${dirBase64}/novel/wizard`, "")).toEqual({ type: "home" })
  })

  test("novel routes without a novelID fall back to home", () => {
    expect(currentRoute(`/${dirBase64}/novel`, "")).toEqual({ type: "home" })
  })

  test("home stays home", () => {
    expect(currentRoute("/", "")).toEqual({ type: "home" })
    expect(currentRoute(`/${dirBase64}`, "")).toEqual({ type: "home" })
  })
})

describe("currentRoute session parsing (regression)", () => {
  test("parses the server-scoped session route", () => {
    const serverKey = "local\nhttp://localhost:4096" as ServerConnection.Key
    const serverBase64 = base64Encode(serverKey)

    expect(currentRoute(`/server/${serverBase64}/session/s1`, "")).toEqual({
      type: "session",
      sessionId: "s1",
      server: serverKey,
    })
  })

  test("parses the directory-scoped session routes", () => {
    expect(currentRoute(`/${dirBase64}/session/s1`, "")).toEqual({ type: "session", sessionId: "s1" })
    expect(currentRoute(`/${dirBase64}/session`, "")).toEqual({
      type: "dir-new-sesssion",
      dir,
      dirBase64,
    })
  })
})

describe("novelTabTitle", () => {
  test("prefers the persisted cache so a restart shows the title immediately", () => {
    expect(novelTabTitle({ title: "缓存书名" }, { title: "查询书名" }, "加载中…")).toBe("缓存书名")
  })

  test("falls back to the fetched novel title once it lands", () => {
    expect(novelTabTitle(undefined, { title: "查询书名" }, "加载中…")).toBe("查询书名")
  })

  test("shows the placeholder before anything is ready", () => {
    expect(novelTabTitle(undefined, undefined, "加载中…")).toBe("加载中…")
    expect(novelTabTitle({}, { title: undefined }, "加载中…")).toBe("加载中…")
  })
})
