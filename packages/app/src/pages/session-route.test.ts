import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { resolveSessionRoute } from "./session-route"
import type { NovelSessionBinding } from "./novel-sessions"

const directory = "E:/works/novels/demo"

function binding(sessionID: string, novelID: string): NovelSessionBinding {
  return { sessionID, novelID, novelTitle: "三体" }
}

function parent(id: string, parentID?: string) {
  return { id, parentID }
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

  test("unbound legacy session degrades to orphan", () => {
    const route = resolveSessionRoute({ sessionID: "s-9", directory, bindings: [binding("s-1", "n-1")] })
    expect(route).toEqual({ kind: "orphan" })
  })

  test("missing bindings degrade to orphan", () => {
    const route = resolveSessionRoute({ sessionID: "s-1", directory, bindings: undefined })
    expect(route).toEqual({ kind: "orphan" })
  })

  test("empty binding list degrades to orphan", () => {
    const route = resolveSessionRoute({ sessionID: "s-1", directory, bindings: [] })
    expect(route).toEqual({ kind: "orphan" })
  })
})

describe("resolveSessionRoute 祖先链兜底", () => {
  const self = parent("s-3", "s-2")
  const mid = parent("s-2", "s-1")
  const root = parent("s-1")

  test("self binding wins over ancestor bindings", () => {
    const route = resolveSessionRoute({
      sessionID: "s-3",
      directory,
      bindings: [binding("s-3", "n-3"), binding("s-2", "n-2"), binding("s-1", "n-1")],
      lineage: [self, mid, root],
    })
    expect(route).toEqual({ kind: "novel", dir: base64Encode(directory), novelID: "n-3" })
  })

  test("unbound session routes by its nearest bound ancestor", () => {
    const route = resolveSessionRoute({
      sessionID: "s-3",
      directory,
      bindings: [binding("s-1", "n-1"), binding("s-2", "n-2")],
      lineage: [self, mid, root],
    })
    expect(route).toEqual({ kind: "novel", dir: base64Encode(directory), novelID: "n-2" })
  })

  test("grandchild resolves through an unbound middle ancestor", () => {
    const route = resolveSessionRoute({
      sessionID: "s-3",
      directory,
      bindings: [binding("s-1", "n-1")],
      lineage: [self, mid, root],
    })
    expect(route).toEqual({ kind: "novel", dir: base64Encode(directory), novelID: "n-1" })
  })

  test("unbound lineage chain degrades to orphan", () => {
    const route = resolveSessionRoute({
      sessionID: "s-3",
      directory,
      bindings: [binding("s-9", "n-9")],
      lineage: [self, mid, root],
    })
    expect(route).toEqual({ kind: "orphan" })
  })

  test("missing lineage keeps the self-only decision", () => {
    const route = resolveSessionRoute({ sessionID: "s-3", directory, bindings: [binding("s-1", "n-1")] })
    expect(route).toEqual({ kind: "orphan" })
  })

  test("walk stops at a missing chain entry", () => {
    const route = resolveSessionRoute({
      sessionID: "s-3",
      directory,
      bindings: [binding("s-1", "n-1")],
      lineage: [self],
    })
    expect(route).toEqual({ kind: "orphan" })
  })

  test("parent cycle terminates and uses reachable bindings", () => {
    const route = resolveSessionRoute({
      sessionID: "s-3",
      directory,
      bindings: [binding("s-2", "n-2")],
      lineage: [parent("s-3", "s-2"), parent("s-2", "s-3")],
    })
    expect(route).toEqual({ kind: "novel", dir: base64Encode(directory), novelID: "n-2" })
  })
})