import { describe, expect, test } from "bun:test"
import { fetchChangelogJson } from "./highlights-source"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("fetchChangelogJson", () => {
  test("远端成功时不读快照", async () => {
    const calls: string[] = []
    const fetcher: typeof fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return json({ releases: [{ tag: "remote" }] })
    }) as unknown as typeof fetch

    const result = await fetchChangelogJson(fetcher, new AbortController().signal)
    expect(result).toEqual({ releases: [{ tag: "remote" }] })
    expect(calls).toEqual(["https://opennovel.ai/changelog.json"])
  })

  test("远端 404 回退内置快照", async () => {
    const fetcher: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "https://opennovel.ai/changelog.json") return json({}, 404)
      return json({ releases: [{ tag: "bundled" }] })
    }) as unknown as typeof fetch

    const result = await fetchChangelogJson(fetcher, new AbortController().signal)
    expect(result).toEqual({ releases: [{ tag: "bundled" }] })
  })

  test("远端网络失败回退内置快照", async () => {
    const fetcher: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "https://opennovel.ai/changelog.json") throw new TypeError("network down")
      return json({ releases: [{ tag: "bundled" }] })
    }) as unknown as typeof fetch

    const result = await fetchChangelogJson(fetcher, new AbortController().signal)
    expect(result).toEqual({ releases: [{ tag: "bundled" }] })
  })

  test("远端格式非法回退内置快照", async () => {
    const fetcher: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "https://opennovel.ai/changelog.json") {
        return new Response("<html>not json</html>", { status: 200 })
      }
      return json({ releases: [{ tag: "bundled" }] })
    }) as unknown as typeof fetch

    const result = await fetchChangelogJson(fetcher, new AbortController().signal)
    expect(result).toEqual({ releases: [{ tag: "bundled" }] })
  })

  test("双源皆不可用返回 undefined", async () => {
    const fetcher: typeof fetch = (async () => json({}, 404)) as unknown as typeof fetch
    const result = await fetchChangelogJson(fetcher, new AbortController().signal)
    expect(result).toBeUndefined()
  })
})