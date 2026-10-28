export * as SessionTitle from "./title"

import { LLM, LLMClient, LLMEvent, Message } from "@opennovel-ai/llm"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema, Stream } from "effect"
import { Database } from "../database/database"
import { llmClient } from "../effect/app-node-platform"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { PROMPT_TITLE } from "../plugin/agent"
import { SessionEvent } from "./event"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { SessionMessageTable } from "./sql"
import { SessionStore } from "./store"

// 默认占位标题：与 app/src/utils/session-title.ts 同一模式，core 自带实现不跨包依赖
const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const isDefaultTitle = (title: string) => DEFAULT_TITLE.test(title)

const MAX_TITLE_LENGTH = 80
const USER_SOURCE_LIMIT = 4_000
const ASSISTANT_SOURCE_LIMIT = 2_000
const TITLE_OUTPUT_TOKENS = 128

// 生成文本清洗：取首个非空行、去包围引号、超长截断；空结果返回 undefined 表示放弃命名
export const cleanTitle = (text: string) => {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item)
  if (!line) return undefined
  const unquoted = line.replace(/^(?:["'「『“”]+)|(?:["'」』“”]+)$/g, "").trim()
  if (!unquoted) return undefined
  return unquoted.length > MAX_TITLE_LENGTH ? `${unquoted.slice(0, MAX_TITLE_LENGTH)}…` : unquoted
}

const SourceData = Schema.Struct({
  text: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }))),
})
const decodeSource = Schema.decodeUnknownOption(SourceData)

const titleSource = Effect.fnUntraced(function* (db: Database.Interface["db"], sessionID: SessionSchema.ID) {
  const rows = yield* db
    .select({ type: SessionMessageTable.type, data: SessionMessageTable.data })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), inArray(SessionMessageTable.type, ["user", "assistant"])))
    .orderBy(asc(SessionMessageTable.seq))
    .limit(4)
    .all()
    .pipe(Effect.orDie)
  const sources = rows.flatMap((row) => {
    const decoded = decodeSource(row.data)
    return decoded._tag === "Some" ? [{ type: row.type, ...decoded.value }] : []
  })
  const user = sources.find((row) => row.type === "user")?.text?.trim()
  if (!user) return undefined
  const assistant = sources
    .find((row) => row.type === "assistant")
    ?.content?.filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
    .trim()
  return [
    `[User]: ${user.slice(0, USER_SOURCE_LIMIT)}`,
    assistant ? `[Assistant]: ${assistant.slice(0, ASSISTANT_SOURCE_LIMIT)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
})

export interface Interface {
  // 自动命名仅一次机会、全错误静默：任何失败保留原标题，绝不影响会话主流程
  readonly ensure: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SessionTitle") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const store = yield* SessionStore.Service
    const models = yield* SessionRunnerModel.Service
    const db = (yield* Database.Service).db

    const ensure = Effect.fn("SessionTitle.ensure")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session || !isDefaultTitle(session.title)) return
      const source = yield* titleSource(db, sessionID)
      if (!source) return
      const model = yield* models.resolve(session)
      const chunks: string[] = []
      let failed = false
      const generated = yield* llm
        .stream(
          LLM.request({
            model,
            system: PROMPT_TITLE,
            messages: [Message.user(source)],
            tools: [],
            providerOptions: { openai: { reasoningEffort: "none" } },
            generation: { maxTokens: TITLE_OUTPUT_TOKENS },
          }),
        )
        .pipe(
          Stream.runForEach((event) => {
            if (LLMEvent.is.providerError(event)) failed = true
            if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
            return Effect.void
          }),
          Effect.as(true),
          Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
        )
      if (!generated || failed) return
      const title = cleanTitle(chunks.join(""))
      if (!title) return
      yield* events.publish(SessionEvent.Updated, {
        sessionID,
        timestamp: yield* DateTime.now,
        title,
      })
    })

    return Service.of({
      ensure: (sessionID) =>
        ensure(sessionID).pipe(
          Effect.catch((error) => Effect.logWarning(`SessionTitle.ensure skipped for ${sessionID}: ${String(error)}`)),
        ),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [EventV2.node, llmClient, SessionStore.node, SessionRunnerModel.node, Database.node],
})
