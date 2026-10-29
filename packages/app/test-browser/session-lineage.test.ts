import { expect, test } from "bun:test"
import { ErrorBoundary, createRoot, createSignal } from "solid-js"
import { createSessionLineage } from "@/pages/session/session-lineage"
import { isLocalSessionNotFoundError } from "@/utils/server-errors"

type Lineage = { session: { id: string; directory: string } }

const lineageOf = (id: string): Lineage => ({ session: { id, directory: `/dir/${id}` } })

// Fake sync lineage store: peek reads a reactive cache, resolve returns a
// deferred promise the test settles or fails explicitly. The lineage memo is
// live (read below), so it recomputes eagerly on cache/status writes — throws
// surface at the write site, which is also where the enclosing ErrorBoundary
// would see them in the app. Assertions wrap write + read to cover both.
function createFixture(initial: Record<string, Lineage> = {}) {
  const [cache, setCache] = createSignal(initial)
  const deferred = new Map<string, PromiseWithResolvers<unknown>>()
  const resolves: string[] = []
  return {
    resolves,
    lineage: {
      peek: (id: string) => cache()[id],
      resolve: (id: string) => {
        resolves.push(id)
        const entry = deferred.get(id) ?? Promise.withResolvers<unknown>()
        deferred.set(id, entry)
        return entry.promise
      },
    },
    settle(id: string) {
      setCache({ ...cache(), [id]: lineageOf(id) })
      deferred.get(id)?.resolve(undefined)
    },
    fail(id: string, error: unknown) {
      deferred.get(id)?.reject(error)
      // The real store does not cache failures: the inflight request entry is
      // dropped on rejection so the next resolve retries (server-session.ts).
      deferred.delete(id)
    },
    remove(id: string) {
      const next = { ...cache() }
      delete next[id]
      setCache(next)
    },
  }
}

// Two microtask ticks: one for the resolve promise handed back by the fixture,
// one for the .then/.catch chain inside createSessionLineage.
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test("resolves an uncached session and exposes its lineage", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const current = createSessionLineage(
      () => "ses_a",
      () => fixture.lineage,
    )

    expect(current()).toBeUndefined()
    await flush()
    expect(fixture.resolves).toEqual(["ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

// Session tabs on the same server share one route instance, so navigating to
// another session changes the id in place; resolution must follow it instead
// of reporting the new session as missing.
test("re-resolves when navigating to an uncached session without a remount", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: lineageOf("ses_a") })
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    expect(current()?.session.id).toBe("ses_a")

    expect(() => {
      setId("ses_b")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_b"])

    fixture.settle("ses_b")
    await flush()
    expect(current()?.session.id).toBe("ses_b")

    dispose()
  })
})

// A late failure from a session the user already navigated away from must not
// poison the currently viewed session.
test("ignores a stale resolution failure after the target changes", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("Session not found: ses_a"))
    await flush()

    expect(() => current()).not.toThrow()
    fixture.settle("ses_b")
    await flush()
    expect(current()?.session.id).toBe("ses_b")

    dispose()
  })
})

test("returning to a pruned session re-resolves instead of throwing not found", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    fixture.settle("ses_a")
    await flush()

    setId("ses_b")
    fixture.settle("ses_b")
    await flush()

    fixture.remove("ses_a")
    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

// A resolution that fails while its session is unfocused must not leave a
// poisoned status behind: revisiting that session retries cleanly instead of
// rethrowing the stale failure before the retry can start.
test("revisiting a session whose resolution failed while unfocused retries cleanly", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("resolve failed"))
    await flush()

    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

// The lineage accessor is reactive: replacing the sync store (for example after
// the server context is rebuilt) must gate out the old store's status and
// re-resolve against the new one instead of fabricating a not-found.
test("re-resolves against a replaced lineage store", async () => {
  await createRoot(async (dispose) => {
    const first = createFixture()
    const second = createFixture()
    const [store, setStore] = createSignal(first.lineage)
    const current = createSessionLineage(() => "ses_a", store)

    await flush()
    first.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    expect(() => {
      setStore(second.lineage)
      current()
    }).not.toThrow()
    await flush()
    expect(second.resolves).toEqual(["ses_a"])

    second.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

// The viewed session is pinned in the cache, so disappearing after settlement
// means it was deleted; the boundary must show the not found fallback.
test("throws not found when the settled session is deleted", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const current = createSessionLineage(
      () => "ses_a",
      () => fixture.lineage,
    )

    await flush()
    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    expect(() => {
      fixture.remove("ses_a")
      current()
    }).toThrow("Session not found: ses_a")

    dispose()
  })
})

// Resolution failures from the server carry a named error body, not the local
// message. The lineage must normalize a named not-found so the boundary shows
// the session not found fallback instead of the generic error page.
// Memos re-evaluate eagerly on status writes, so a failure for the viewed
// session surfaces at the write site; the boundary is the component that sees
// it (WorkspaceSessionGate renders inside SessionRouteErrorBoundary).
function captureBoundary(fixture: ReturnType<typeof createFixture>) {
  const seen: unknown[] = []
  const boundary = ErrorBoundary({
    get children() {
      return createSessionLineage(
        () => "ses_a",
        () => fixture.lineage,
      )
    },
    fallback: (error: unknown) => {
      seen.push(error)
    },
  })
  return { seen, boundary }
}

test("normalizes a named not-found resolve failure into the local not-found error", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const { seen } = captureBoundary(fixture)

    await flush()
    fixture.fail("ses_a", { _tag: "SessionNotFoundError", sessionID: "ses_a", message: "Session not found" })
    await flush()

    expect(isLocalSessionNotFoundError(seen[0], "ses_a")).toBe(true)

    dispose()
  })
})

// Other resolve failures (network, 5xx) are not session deletion; they must keep
// the original error so the boundary still renders the generic error page.
test("keeps the original error for non-not-found resolve failures", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const { seen } = captureBoundary(fixture)

    const failure = new Error("network down")
    await flush()
    fixture.fail("ses_a", failure)
    await flush()

    expect(seen[0]).toBe(failure)
    expect(isLocalSessionNotFoundError(seen[0], "ses_a")).toBe(false)

    dispose()
  })
})
