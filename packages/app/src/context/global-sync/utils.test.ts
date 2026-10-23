import { describe, expect, test } from "bun:test"
import type { AgentV2Info } from "@opennovel-ai/sdk/v2/client"
import { directoryKey, mapAgent } from "./utils"

const agent = (id = "build") =>
  ({
    id,
    mode: "primary",
    hidden: false,
    permissions: [],
    request: { headers: {}, body: {} },
  }) as AgentV2Info

describe("mapAgent", () => {
  test("maps id to name and carries display fields", () => {
    expect(mapAgent(agent("build"))).toEqual({ name: "build", mode: "primary", hidden: false })
  })

  test("maps V2 model ref id to modelID", () => {
    expect(
      mapAgent({ ...agent(), model: { id: "gpt-5", providerID: "openai" }, description: "desc", category: "internal" }),
    ).toEqual({
      name: "build",
      mode: "primary",
      hidden: false,
      description: "desc",
      category: "internal",
      model: { providerID: "openai", modelID: "gpt-5" },
    })
  })
})

describe("directoryKey", () => {
  test("normalizes slashes", () => {
    expect(String(directoryKey("C:\\Repos\\sst\\opennovel"))).toBe("C:/Repos/sst/opennovel")
    expect(String(directoryKey("C:/Repos/sst/opennovel"))).toBe("C:/Repos/sst/opennovel")
  })

  test("preserves backslashes in posix paths", () => {
    expect(String(directoryKey("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
  })

  test("trims trailing slashes without breaking roots", () => {
    expect(String(directoryKey("C:/Repos/sst/opennovel/"))).toBe("C:/Repos/sst/opennovel")
    expect(String(directoryKey("C:/"))).toBe("C:/")
    expect(String(directoryKey("/"))).toBe("/")
  })
})
