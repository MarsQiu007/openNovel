import { describe, expect, test } from "bun:test"
import { hasCustomAgent, resolveAgent, resolveSessionAgent, showAgentSelector } from "./local-agent"

describe("hasCustomAgent", () => {
  test("detects explicitly custom agents", () => {
    expect(hasCustomAgent([{ category: "internal" }, { category: "novel" }])).toBe(true)
  })

  test("ignores built-in agents", () => {
    expect(hasCustomAgent([{ category: "internal" }])).toBe(false)
  })

  test("treats unclassified agents as custom", () => {
    expect(hasCustomAgent([{ category: "internal" }, {}])).toBe(true)
  })
})

describe("showAgentSelector", () => {
  test("hides with a single custom primary agent", () => {
    expect(showAgentSelector([{ category: "internal" }, { category: "novel" }])).toBe(false)
  })

  test("hides with only built-in agents", () => {
    expect(showAgentSelector([{ category: "internal" }, { category: "internal" }])).toBe(false)
  })

  test("shows with two or more custom primary agents", () => {
    expect(showAgentSelector([{ category: "internal" }, { category: "novel" }, { category: "writing" }])).toBe(true)
  })
})

describe("resolveAgent", () => {
  const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

  test("uses the requested available agent", () => {
    expect(resolveAgent(agents, "custom")?.name).toBe("custom")
  })

  test("defaults to build", () => {
    expect(resolveAgent(agents)?.name).toBe("build")
    expect(resolveAgent(agents, "missing")?.name).toBe("build")
  })

  test("uses the first agent when build is unavailable", () => {
    expect(resolveAgent([{ name: "custom" }], "missing")?.name).toBe("custom")
  })
})

describe("resolveSessionAgent", () => {
  const agents = [{ name: "plan" }, { name: "build" }, { name: "director" }]

  test("keeps the persisted workspace selection even when it is built-in plan", () => {
    expect(resolveSessionAgent(agents, "plan", undefined, undefined)?.name).toBe("plan")
  })

  test("resolves the configured default_agent without persisted selection", () => {
    expect(resolveSessionAgent(agents, undefined, "director", undefined)?.name).toBe("director")
  })

  test("falls back to memory when neither persisted selection nor config exists", () => {
    expect(resolveSessionAgent(agents, undefined, undefined, "plan")?.name).toBe("plan")
  })

  test("resolves the server default primary when nothing is set", () => {
    expect(resolveSessionAgent(agents, undefined, undefined, undefined)?.name).toBe("build")
  })

  test("falls back to the server default when the persisted reference is stale", () => {
    expect(resolveSessionAgent(agents, "deleted-agent", undefined, undefined)?.name).toBe("build")
  })

  test("persisted selection wins over config default and memory", () => {
    expect(resolveSessionAgent(agents, "plan", "director", "build")?.name).toBe("plan")
  })

  test("config default wins over memory fallback", () => {
    expect(resolveSessionAgent(agents, undefined, "director", "plan")?.name).toBe("director")
  })
})
