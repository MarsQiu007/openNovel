import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createRefCountMap } from "./refcount"
import { pathKey } from "./path-key"

describe("createRefCountMap", () => {
  test("manual dispose releases an ownerless acquire once", () => {
    const removed: string[] = []
    const map = createRefCountMap(
      (key) => ({ key }),
      (key) => removed.push(key),
    )

    const first = map("/project")
    const second = map("/project")
    expect(removed).toEqual([])
    first.dispose?.()
    expect(removed).toEqual([])
    second.dispose?.()
    second.dispose?.()
    expect(removed).toEqual(["/project"])
  })

  test("creates one shared resource for equivalent ownerless consumers", () => {
    let created = 0
    const removed: string[] = []
    const map = createRefCountMap(
      (key) => {
        created += 1
        return { key, ready: true }
      },
      (key) => removed.push(key),
      pathKey,
    )

    const first = map("C:\\repo")
    const second = map("C:/repo/")
    expect(created).toBe(1)
    expect(second.ready).toBe(true)
    first.dispose?.()
    expect(removed).toEqual([])
    second.dispose?.()
    expect(removed).toEqual(["C:/repo"])
  })

  test("releases once after mixed reactive and ownerless consumers finish", () => {
    const removed: string[] = []
    const map = createRefCountMap(
      (key) => ({ key }),
      (key) => removed.push(key),
    )
    const disposeRoot = createRoot((dispose) => {
      map("/project")
      return dispose
    })
    const manual = map("/project")

    manual.dispose?.()
    expect(removed).toEqual([])
    disposeRoot()
    expect(removed).toEqual(["/project"])
  })

  test("removes an item after its last owner is disposed", () => {
    const removed: string[] = []
    const map = createRefCountMap(
      (key) => ({ key }),
      (key) => removed.push(key),
    )
    const first = createRoot((dispose) => {
      map("/project")
      return dispose
    })
    const second = createRoot((dispose) => {
      map("/project")
      return dispose
    })

    first()
    expect(removed).toEqual([])
    second()
    expect(removed).toEqual(["/project"])
  })

  test("keeps equivalent path consumers until the last owner is disposed", () => {
    const removed: string[] = []
    const map = createRefCountMap(
      (key) => ({ key }),
      (key) => removed.push(key),
      pathKey,
    )
    const first = createRoot((dispose) => {
      map("C:\\repo")
      return dispose
    })
    const second = createRoot((dispose) => {
      map("C:/repo/")
      return dispose
    })

    first()
    expect(removed).toEqual([])
    second()
    expect(removed).toEqual(["C:/repo"])
  })
})
