import { expect, test } from "bun:test"
import { archiveHomeSession } from "./home-session-archive"

test("archiving a Home session removes it from the list", async () => {
  let removed = false

  await archiveHomeSession({
    session: { id: "ses_1", directory: "/workspace" },
    update: async () => undefined,
    remove: () => {
      removed = true
    },
  })

  expect(removed).toBe(true)
})

test("reports archive failures without removing the session", async () => {
  const failure = new Error("offline")
  let error: unknown
  let removed = false

  await archiveHomeSession({
    session: { id: "ses_1", directory: "/workspace" },
    update: async () => Promise.reject(failure),
    remove: () => {
      removed = true
    },
    onError: (value) => {
      error = value
    },
  })

  expect(error).toBe(failure)
  expect(removed).toBe(false)
})
