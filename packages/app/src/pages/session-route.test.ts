import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { resolveSessionRoute } from "./session-route"
import type { NovelSessionBinding } from "./novel-sessions"

const directory = "E:/works/novels/demo"

function binding(sessionID: string, novelID: string): NovelSessionBinding {
  return { sessionID, novelID, novelTitle: "三体" }
}

describe("resolveSessionRoute", () => {
  test("bound session routes to its novel workspace", () => {
    const route = resolveSessionRoute({
      sessionID: "s-1",
      directory,
      bindings: [binding("s-1", "n-1"), binding("s-2", "n-2")],
    })
    expect(route).toEqual({ kind: "novel", dir: base64Encode(directory), novelID: "n-1" })
  })

  test("unbound session falls back to the session tab", () => {
    const route = resolveSessionRoute({ sessionID: "s-9", directory, bindings: [binding("s-1", "n-1")] })
    expect(route).toEqual({ kind: "tab" })
  })

  test("missing bindings degrade to the session tab", () => {
    const route = resolveSessionRoute({ sessionID: "s-1", directory, bindings: undefined })
    expect(route).toEqual({ kind: "tab" })
  })

  test("empty binding list falls back to the session tab", () => {
    const route = resolveSessionRoute({ sessionID: "s-1", directory, bindings: [] })
    expect(route).toEqual({ kind: "tab" })
  })
})
