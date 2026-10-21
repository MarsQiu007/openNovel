import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent"

const decode = Schema.decodeUnknownSync(Agent.Info)

const base = {
  id: "writer",
  request: { headers: {}, body: {} },
  mode: "subagent",
  hidden: false,
  permissions: [],
}

describe("agent category", () => {
  test("category is optional", () => {
    expect(decode(base).category).toBeUndefined()
  })

  test("category accepts every known value", () => {
    for (const category of ["orchestration", "creation", "review", "memory", "research", "internal"] as const) {
      expect(decode({ ...base, category }).category).toBe(category)
    }
  })

  test("category rejects unknown values", () => {
    expect(() => decode({ ...base, category: "coding" })).toThrow()
  })
})
