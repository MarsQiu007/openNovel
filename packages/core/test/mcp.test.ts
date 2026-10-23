import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Mcp } from "@opennovel-ai/core/mcp"
import { Config } from "@opennovel-ai/core/config"
import { ConfigMCP } from "@opennovel-ai/core/config/mcp"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { Location } from "@opennovel-ai/core/location"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { Effect, Layer, Schedule } from "effect"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { McpCatalog } from "../src/mcp/catalog"

const fixture = path.join(import.meta.dir, "fixture", "mcp-stdio.ts")

type Servers = Record<string, ConfigMCP.Local>

const local = (extra?: Partial<Pick<ConfigMCP.Local, "disabled" | "environment">>): ConfigMCP.Local =>
  new ConfigMCP.Local({ type: "local", command: [process.execPath, fixture], ...extra })

function testLayer(servers: Servers) {
  return Layer.unwrap(
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.map((tmp) =>
        AppNodeBuilder.build(Mcp.node, [
          [
            Location.node,
            Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
            ),
          ],
          [
            Config.node,
            Layer.succeed(
              Config.Service,
              Config.Service.of({
                entries: () =>
                  Effect.succeed([
                    new Config.Document({
                      type: "document",
                      info: new Config.Info({ mcp: new ConfigMCP.Info({ servers }) }),
                    }),
                  ]),
              }),
            ),
          ],
        ]),
      ),
    ),
  )
}

// 初始连接是 fork 出去的异步过程：轮询 status 直到目标状态
const waitStatus = (mcp: Mcp.Interface, name: string, status: Mcp.Status["status"]) =>
  mcp.status().pipe(
    Effect.filterOrElse(
      (record) => record[name]?.status === status,
      (record) => Effect.fail(new Error(`status: ${JSON.stringify(record)}`)),
    ),
    Effect.retry(Schedule.spaced("100 millis").pipe(Schedule.both(Schedule.recurs(200)))),
  )

describe("Mcp", () => {
  it.live(
    "connects to a configured stdio server and lists its tools",
    () =>
      Effect.gen(function* () {
        const mcp = yield* Mcp.Service
        yield* waitStatus(mcp, "fixture", "connected")

        const listed = yield* mcp.tools()
        expect(Object.keys(listed)).toContain("fixture_echo")
        expect(listed["fixture_echo"]?.server).toBe("fixture")
        expect(listed["fixture_echo"]?.def.description).toBe("Echo text back")

        const instructions = yield* mcp.instructions()
        expect(instructions).toEqual([
          { name: "fixture", instructions: "fixture instructions", tools: expect.arrayContaining(["fixture_echo"]) },
        ])

        const result = yield* mcp.callTool({ server: "fixture", name: "echo", args: { text: "hi" } })
        expect(result.content).toEqual([{ type: "text", text: "hi" }])
      }).pipe(Effect.provide(testLayer({ fixture: local() }))),
    { timeout: 60_000 },
  )

  it.live(
    "reports failed status for an unreachable command",
    () =>
      Effect.gen(function* () {
        const mcp = yield* Mcp.Service
        const record = yield* waitStatus(mcp, "broken", "failed")
        const entry = record["broken"]
        expect(entry?.status).toBe("failed")
        expect(entry && "error" in entry ? entry.error : undefined).toBeTruthy()
        expect(yield* mcp.tools()).toEqual({})
      }).pipe(
        Effect.provide(
          testLayer({
            broken: new ConfigMCP.Local({ type: "local", command: ["opennovel-no-such-command-xyz"] }),
          }),
        ),
      ),
    { timeout: 60_000 },
  )

  it.live(
    "keeps a disabled server disabled",
    () =>
      Effect.gen(function* () {
        const mcp = yield* Mcp.Service
        yield* Effect.sleep("500 millis")
        expect(yield* mcp.status()).toEqual({ fixture: { status: "disabled" } })
        expect(yield* mcp.tools()).toEqual({})
      }).pipe(Effect.provide(testLayer({ fixture: local({ disabled: true }) }))),
    { timeout: 60_000 },
  )

  it.live(
    "disconnect drops tools and parks the server as disabled",
    () =>
      Effect.gen(function* () {
        const mcp = yield* Mcp.Service
        yield* waitStatus(mcp, "fixture", "connected")
        expect(Object.keys(yield* mcp.tools())).toContain("fixture_echo")

        yield* mcp.disconnect("fixture")
        expect(yield* mcp.status()).toEqual({ fixture: { status: "disabled" } })
        expect(yield* mcp.tools()).toEqual({})

        const exit = yield* mcp.callTool({ server: "fixture", name: "echo", args: {} }).pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }).pipe(Effect.provide(testLayer({ fixture: local() }))),
    { timeout: 60_000 },
  )

  it.live(
    "reconnects a disconnected server through connect",
    () =>
      Effect.gen(function* () {
        const mcp = yield* Mcp.Service
        yield* waitStatus(mcp, "fixture", "connected")
        yield* mcp.disconnect("fixture")
        yield* mcp.connect("fixture")
        yield* waitStatus(mcp, "fixture", "connected")
        expect(Object.keys(yield* mcp.tools())).toContain("fixture_echo")
      }).pipe(Effect.provide(testLayer({ fixture: local() }))),
    { timeout: 60_000 },
  )
})

describe("McpCatalog", () => {
  test("paginates until the cursor runs out", async () => {
    const pages = new Map<string | undefined, { items: number[]; nextCursor?: string }>([
      [undefined, { items: [1, 2], nextCursor: "b" }],
      ["b", { items: [3], nextCursor: "c" }],
      ["c", { items: [4] }],
    ])
    const result = await McpCatalog.paginate(
      (cursor) => Promise.resolve(pages.get(cursor)!),
      (page) => page.items,
    )
    expect(result).toEqual([1, 2, 3, 4])
  })

  test("rejects a duplicate cursor", async () => {
    const page = { items: [1], nextCursor: "loop" }
    const outcome = await McpCatalog.paginate(
      () => Promise.resolve(page),
      (page) => page.items,
    ).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    expect(outcome).toContain("duplicate cursor")
  })

  test("rejects listings beyond the page cap", async () => {
    let cursor = 0
    const outcome = await McpCatalog.paginate(
      () => Promise.resolve({ items: [], nextCursor: String(++cursor) }),
      (page) => page.items,
    ).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    expect(outcome).toContain("exceeded")
  })

  test("sanitizes server and tool names into registry keys", () => {
    expect(McpCatalog.toolName("my-server", "do.thing")).toBe("my-server_do_thing")
    expect(McpCatalog.sanitize("a b/c.d")).toBe("a_b_c_d")
  })
})
