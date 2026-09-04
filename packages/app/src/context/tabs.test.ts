import { describe, expect, test } from "bun:test"
import { nextTabAfterClose, pushClosedTab, takeClosedTab, type ClosedTab } from "./closed-tabs"
import { migrateTabs, novelHref, tabHref, tabKey, type NovelTab } from "./tab-route"
import type { ServerConnection } from "./server"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key
const remote = "remote\nhttp://localhost:4097" as ServerConnection.Key

function novelTab(novelID: string, dir = "dG1w", key = server): NovelTab {
  return { type: "novel", server: key, dir, novelID }
}

describe("closed tab stack", () => {
  test("records novel tabs with their index", () => {
    expect(pushClosedTab([], novelTab("n1"), 1)).toEqual([{ tab: novelTab("n1"), index: 1 }])
  })

  test("caps the stack size", () => {
    const stack = Array.from({ length: 30 }, (_, i) => i).reduce<ClosedTab[]>(
      (acc, i) => pushClosedTab(acc, novelTab(`n${i}`), i),
      [],
    )

    expect(stack).toHaveLength(25)
    expect(stack[0]?.tab.novelID).toBe("n5")
    expect(stack.at(-1)?.tab.novelID).toBe("n29")
  })

  test("pops the most recently closed tab", () => {
    const stack = [
      { tab: novelTab("n1"), index: 0 },
      { tab: novelTab("n2"), index: 1 },
    ]
    const result = takeClosedTab(stack, [])

    expect(result.entry?.tab).toEqual(novelTab("n2"))
    expect(result.stack).toEqual([{ tab: novelTab("n1"), index: 0 }])
  })

  test("skips entries whose tab is already open", () => {
    const stack = [
      { tab: novelTab("n1"), index: 0 },
      { tab: novelTab("n2"), index: 1 },
    ]
    const result = takeClosedTab(stack, [novelTab("n2")])

    expect(result.entry?.tab).toEqual(novelTab("n1"))
    expect(result.stack).toEqual([])
  })

  test("returns no entry when everything is open or empty", () => {
    expect(takeClosedTab([], []).entry).toBeUndefined()

    const result = takeClosedTab([{ tab: novelTab("n1"), index: 0 }], [novelTab("n1")])
    expect(result.entry).toBeUndefined()
    expect(result.stack).toEqual([])
  })

  test("does not navigate when a background tab closes", () => {
    const tabs = [novelTab("n1"), novelTab("n2"), novelTab("n3")]

    expect(nextTabAfterClose(tabs, 1, false)).toBeUndefined()
    expect(nextTabAfterClose(tabs, 1, true)).toEqual(novelTab("n3"))
    expect(nextTabAfterClose([novelTab("n1")], 0, true)).toBeNull()
  })
})

describe("novel tab derivation", () => {
  test("derives the workspace href from dir and novelID", () => {
    expect(novelHref({ dir: "dG1w", novelID: "n1" })).toBe("/dG1w/novel/n1")
    expect(tabHref(novelTab("n1"))).toBe("/dG1w/novel/n1")
  })

  test("same book on the same server yields one stable key", () => {
    expect(tabKey(novelTab("n1"))).toBe(tabKey(novelTab("n1")))
    expect(tabKey(novelTab("n1"))).toBe(`novel:${server}\ndG1w/n1`)
  })

  test("different books, directories, or servers yield different keys", () => {
    expect(tabKey(novelTab("n1"))).not.toBe(tabKey(novelTab("n2")))
    expect(tabKey(novelTab("n1"))).not.toBe(tabKey(novelTab("n1", "ZGly")))
    expect(tabKey(novelTab("n1"))).not.toBe(tabKey(novelTab("n1", "dG1w", remote)))
  })
})

describe("tabs persistence migration", () => {
  test("keeps novel tabs as-is", () => {
    const value: unknown[] = [novelTab("n1"), novelTab("n2", "ZGly", remote)]

    expect(migrateTabs(value)).toEqual(value)
  })

  test("strips legacy session and draft tabs from a mixed array", () => {
    const mixed = [
      { type: "session", server, sessionId: "a" },
      { type: "draft", draftID: "d1", server, directory: "/tmp" },
      novelTab("n1"),
      null,
      "garbage",
    ]

    expect(migrateTabs(mixed)).toEqual([novelTab("n1")])
  })

  test("passes through non-array values untouched", () => {
    expect(migrateTabs(undefined)).toBeUndefined()
    expect(migrateTabs({})).toEqual({})
  })
})
