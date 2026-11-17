import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { DateTime } from "effect"
import { SessionEvent } from "@opennovel-ai/core/session/event"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionMessageUpdater } from "@opennovel-ai/core/session/message-updater"
import { it } from "./lib/effect"

const timestamp = DateTime.makeUnsafe(1_000)

function queuedEvent(messageID: SessionMessage.ID, reason: "auto" | "manual" = "manual") {
  return {
    id: "evt_1" as never,
    type: SessionEvent.Compaction.Queued.type,
    data: { sessionID: "ses_test" as never, messageID, timestamp, reason },
  }
}

function startedEvent(messageID: SessionMessage.ID, reason: "auto" | "manual" = "manual") {
  return {
    id: "evt_2" as never,
    type: SessionEvent.Compaction.Started.type,
    data: { sessionID: "ses_test" as never, messageID, timestamp, reason },
  }
}

function failedEvent(messageID: SessionMessage.ID, reason: "auto" | "manual" = "manual") {
  return {
    id: "evt_3" as never,
    type: SessionEvent.Compaction.Failed.type,
    data: {
      sessionID: "ses_test" as never,
      messageID,
      timestamp,
      reason,
      error: { type: "compaction.failed", message: "摘要请求超出模型限制" },
    },
  }
}

function interruptedEvent(messageID: SessionMessage.ID, cause: "user" | "restart" = "user") {
  return {
    id: "evt_4" as never,
    type: SessionEvent.Compaction.Interrupted.type,
    data: { sessionID: "ses_test" as never, messageID, timestamp, cause },
  }
}

describe("SessionMessageUpdater compaction lifecycle", () => {
  it.effect("queued -> started -> ended produces a single completed message", () =>
    Effect.gen(function* () {
      const state: SessionMessageUpdater.MemoryState = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)
      const messageID = SessionMessage.ID.create()

      yield* SessionMessageUpdater.update(adapter, queuedEvent(messageID) as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ type: "compaction", status: "queued" })

      yield* SessionMessageUpdater.update(adapter, startedEvent(messageID) as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ status: "running" })

      const ended = {
        id: "evt_5" as never,
        type: SessionEvent.Compaction.Ended.type,
        data: {
          sessionID: "ses_test" as never,
          messageID,
          timestamp,
          reason: "manual",
          text: "summary",
          recent: "recent",
        },
      }
      yield* SessionMessageUpdater.update(adapter, ended as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ status: "completed", summary: "summary", recent: "recent" })
    }),
  )

  it.effect("started without queued appends a running message", () =>
    Effect.gen(function* () {
      const state: SessionMessageUpdater.MemoryState = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)
      const messageID = SessionMessage.ID.create()

      yield* SessionMessageUpdater.update(adapter, startedEvent(messageID, "auto") as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ type: "compaction", status: "running", reason: "auto" })
    }),
  )

  it.effect("failed and interrupted transition running state without appending", () =>
    Effect.gen(function* () {
      const state: SessionMessageUpdater.MemoryState = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)
      const failedID = SessionMessage.ID.create()
      const interruptedID = SessionMessage.ID.create()

      yield* SessionMessageUpdater.update(adapter, startedEvent(failedID) as never)
      yield* SessionMessageUpdater.update(adapter, failedEvent(failedID) as never)
      expect(state.messages[0]).toMatchObject({
        status: "failed",
        error: { type: "compaction.failed", message: "摘要请求超出模型限制" },
      })

      yield* SessionMessageUpdater.update(adapter, startedEvent(interruptedID) as never)
      yield* SessionMessageUpdater.update(adapter, interruptedEvent(interruptedID, "restart") as never)
      expect(state.messages[1]).toMatchObject({ status: "interrupted" })
      expect(state.messages).toHaveLength(2)
    }),
  )

  it.effect("decodes legacy compaction messages without status field", () =>
    Effect.gen(function* () {
      const legacy = {
        id: SessionMessage.ID.create(),
        type: "compaction",
        reason: "manual",
        summary: "old summary",
        recent: "old recent",
        time: { created: 1_000 },
      }
      const decoded = Schema.decodeUnknownSync(SessionMessage.Message)(legacy)
      expect(decoded).toMatchObject({ type: "compaction", summary: "old summary" })
    }),
  )

  it.effect("重复 replay 幂等：不追加重复消息，终态不回退", () =>
    Effect.gen(function* () {
      const state: SessionMessageUpdater.MemoryState = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)
      const messageID = SessionMessage.ID.create()
      const ended = {
        id: "evt_5" as never,
        type: SessionEvent.Compaction.Ended.type,
        data: { sessionID: "ses_test" as never, messageID, timestamp, reason: "manual", text: "summary", recent: "recent" },
      }

      yield* SessionMessageUpdater.update(adapter, queuedEvent(messageID) as never)
      yield* SessionMessageUpdater.update(adapter, queuedEvent(messageID) as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ status: "queued" })

      yield* SessionMessageUpdater.update(adapter, startedEvent(messageID) as never)
      yield* SessionMessageUpdater.update(adapter, startedEvent(messageID) as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ status: "running" })

      yield* SessionMessageUpdater.update(adapter, ended as never)
      yield* SessionMessageUpdater.update(adapter, ended as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ status: "completed", summary: "summary" })

      // 终态不回退：replay 乱序或重复事件不能把 completed 拉回 running/failed
      yield* SessionMessageUpdater.update(adapter, startedEvent(messageID) as never)
      yield* SessionMessageUpdater.update(adapter, failedEvent(messageID) as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ status: "completed" })
    }),
  )

  it.effect("interrupted 记录 cause，先到的终态为准", () =>
    Effect.gen(function* () {
      const state: SessionMessageUpdater.MemoryState = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)
      const userStopID = SessionMessage.ID.create()
      const failedID = SessionMessage.ID.create()

      yield* SessionMessageUpdater.update(adapter, startedEvent(userStopID) as never)
      yield* SessionMessageUpdater.update(adapter, interruptedEvent(userStopID, "user") as never)
      expect(state.messages[0]).toMatchObject({ status: "interrupted", cause: "user" })

      yield* SessionMessageUpdater.update(adapter, startedEvent(failedID) as never)
      yield* SessionMessageUpdater.update(adapter, failedEvent(failedID) as never)
      yield* SessionMessageUpdater.update(adapter, interruptedEvent(failedID, "restart") as never)
      expect(state.messages[1]).toMatchObject({ status: "failed" })
      expect(state.messages[1]).not.toHaveProperty("cause")
    }),
  )

  it.effect("无 status 的旧消息视为终态，后续转换不再改动", () =>
    Effect.gen(function* () {
      const state: SessionMessageUpdater.MemoryState = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)
      const legacy = Schema.decodeUnknownSync(SessionMessage.Message)({
        id: SessionMessage.ID.create(),
        type: "compaction",
        reason: "manual",
        summary: "old summary",
        recent: "old recent",
        time: { created: 1_000 },
      })
      state.messages.push(legacy)

      yield* SessionMessageUpdater.update(
        adapter,
        startedEvent(legacy.id as SessionMessage.ID) as never,
      )
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ summary: "old summary" })
    }),
  )

  it.effect("started 丢失时 ended 可直接结算 queued", () =>
    Effect.gen(function* () {
      const state: SessionMessageUpdater.MemoryState = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)
      const messageID = SessionMessage.ID.create()

      yield* SessionMessageUpdater.update(adapter, queuedEvent(messageID) as never)
      yield* SessionMessageUpdater.update(adapter, {
        id: "evt_5" as never,
        type: SessionEvent.Compaction.Ended.type,
        data: { sessionID: "ses_test" as never, messageID, timestamp, reason: "manual", text: "s", recent: "r" },
      } as never)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toMatchObject({ status: "completed", summary: "s" })
    }),
  )
})
