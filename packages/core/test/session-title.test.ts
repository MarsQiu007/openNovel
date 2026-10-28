import { describe, expect, test } from "bun:test"
import { LLMClient, LLMError, LLMEvent, Model, TransportReason, type LLMRequest } from "@opennovel-ai/llm"
import * as OpenAIChat from "@opennovel-ai/llm/protocols/openai-chat"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opennovel-ai/core/database/database"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opennovel-ai/core/effect/app-node-platform"
import { EventV2 } from "@opennovel-ai/core/event"
import { Location } from "@opennovel-ai/core/location"
import { ModelV2 } from "@opennovel-ai/core/model"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { SessionTitle } from "@opennovel-ai/core/session/title"
import { SessionRunnerModel } from "@opennovel-ai/core/session/runner/model"
import { SessionMessageTable, SessionTable } from "@opennovel-ai/core/session/sql"
import { testEffect } from "./lib/effect"

describe("SessionTitle.isDefaultTitle", () => {
  test("matches New session and Child session placeholders", () => {
    expect(SessionTitle.isDefaultTitle("New session - 2026-10-28T03:44:41.231Z")).toBe(true)
    expect(SessionTitle.isDefaultTitle("Child session - 2026-01-01T00:00:00.000Z")).toBe(true)
  })

  test("rejects custom, pipeline, and malformed titles", () => {
    expect(SessionTitle.isDefaultTitle("校验第1章状态delta")).toBe(false)
    expect(SessionTitle.isDefaultTitle("test")).toBe(false)
    expect(SessionTitle.isDefaultTitle("")).toBe(false)
    expect(SessionTitle.isDefaultTitle("New session")).toBe(false)
    expect(SessionTitle.isDefaultTitle("New session - not-a-date")).toBe(false)
  })
})

describe("SessionTitle.cleanTitle", () => {
  test("takes the first non-blank line and trims", () => {
    expect(SessionTitle.cleanTitle("\n  星际航行故事  \n第二行")).toBe("星际航行故事")
  })

  test("strips surrounding quotes", () => {
    expect(SessionTitle.cleanTitle('"星际航行"')).toBe("星际航行")
    expect(SessionTitle.cleanTitle("「星际航行」")).toBe("星际航行")
    expect(SessionTitle.cleanTitle("“星际航行”")).toBe("星际航行")
  })

  test("truncates overlong titles", () => {
    const result = SessionTitle.cleanTitle("字".repeat(120))
    expect(result).toBe("字".repeat(80) + "…")
  })

  test("returns undefined for empty, blank, and quote-only input", () => {
    expect(SessionTitle.cleanTitle("")).toBeUndefined()
    expect(SessionTitle.cleanTitle("  \n\t ")).toBeUndefined()
    expect(SessionTitle.cleanTitle('""')).toBeUndefined()
  })
})

const requests: LLMRequest[] = []
let chunks: string[] = []
let failure: LLMError | undefined
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (request: LLMRequest) => {
      requests.push(request)
      if (failure) return Stream.fail(failure)
      return Stream.fromIterable(chunks.map((text) => LLMEvent.textDelta({ id: "title", text })))
    },
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionRunnerModel.node,
      SessionTitle.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [SessionRunnerModel.node, SessionRunnerModel.layerWith(() => Effect.succeed(model))],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_title_test")
const created = DateTime.makeUnsafe(0)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

const messageRow = (input: { id: string; type: "user" | "assistant"; seq: number; text: string }) => {
  const message =
    input.type === "user"
      ? SessionMessage.User.make({
          id: SessionMessage.ID.make(input.id),
          type: "user",
          text: input.text,
          time: { created },
        })
      : SessionMessage.Assistant.make({
          id: SessionMessage.ID.make(input.id),
          type: "assistant",
          agent: "build",
          model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
          content: [{ type: "text", id: "text-0", text: input.text }],
          time: { created },
        })
  const { id: _, type, ...data } = encodeMessage(message)
  return { id: SessionMessage.ID.make(input.id), session_id: sessionID, type, seq: input.seq, time_created: 0, data }
}

const setup = (title: string, messages: { id: string; type: "user" | "assistant"; seq: number; text: string }[] = []) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    requests.length = 0
    chunks = []
    failure = undefined
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", title, version: "test" })
      .run()
      .pipe(Effect.orDie)
    if (messages.length > 0) yield* db.insert(SessionMessageTable).values(messages.map(messageRow)).run().pipe(Effect.orDie)
  })

const storedTitle = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  return (yield* db.select({ title: SessionTable.title }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    ?.title
})

describe("SessionTitle.ensure", () => {
  const placeholder = "New session - 2026-10-28T03:44:41.231Z"
  const messages = [
    { id: "msg_user", type: "user" as const, seq: 1, text: "帮我写一个星际航行的故事" },
    { id: "msg_assistant", type: "assistant" as const, seq: 2, text: "好的，这是一个星际航行的故事……" },
  ]

  it.effect("generates and writes back a title for a placeholder session", () =>
    Effect.gen(function* () {
      yield* setup(placeholder, messages)
      chunks = ["星际航行故事"]

      yield* SessionTitle.Service.use((title) => title.ensure(sessionID))

      expect(yield* storedTitle).toBe("星际航行故事")
      expect(requests.length).toBe(1)
      expect(JSON.stringify(requests[0]?.system)).toContain("title generator")
      expect(requests[0]?.generation?.maxTokens).toBe(128)
      expect(JSON.stringify(requests[0]?.messages)).toContain("帮我写一个星际航行的故事")
    }),
  )

  it.effect("does not touch a session whose title is not a placeholder", () =>
    Effect.gen(function* () {
      yield* setup("用户自定义标题", messages)

      yield* SessionTitle.Service.use((title) => title.ensure(sessionID))

      expect(requests.length).toBe(0)
      expect(yield* storedTitle).toBe("用户自定义标题")
    }),
  )

  it.effect("keeps the placeholder when generation returns blank output", () =>
    Effect.gen(function* () {
      yield* setup(placeholder, messages)
      chunks = ["  \n "]

      yield* SessionTitle.Service.use((title) => title.ensure(sessionID))

      expect(yield* storedTitle).toBe(placeholder)
    }),
  )

  it.effect("keeps the placeholder and does not throw when generation fails", () =>
    Effect.gen(function* () {
      yield* setup(placeholder, messages)
      failure = new LLMError({
        module: "test",
        method: "stream",
        reason: new TransportReason({ message: "Provider unavailable" }),
      })

      yield* SessionTitle.Service.use((title) => title.ensure(sessionID))

      expect(yield* storedTitle).toBe(placeholder)
    }),
  )

  it.effect("generates only once across repeated ensure calls", () =>
    Effect.gen(function* () {
      yield* setup(placeholder, messages)
      chunks = ["星际航行故事"]

      yield* SessionTitle.Service.use((title) => title.ensure(sessionID))
      yield* SessionTitle.Service.use((title) => title.ensure(sessionID))

      expect(requests.length).toBe(1)
      expect(yield* storedTitle).toBe("星际航行故事")
    }),
  )

  it.effect("skips sessions without a user message", () =>
    Effect.gen(function* () {
      yield* setup(placeholder)

      yield* SessionTitle.Service.use((title) => title.ensure(sessionID))

      expect(requests.length).toBe(0)
      expect(yield* storedTitle).toBe(placeholder)
    }),
  )
})
