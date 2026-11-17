import { describe, expect, test } from "bun:test"
import { Model } from "@opennovel-ai/llm"
import * as OpenAIChat from "@opennovel-ai/llm/protocols/openai-chat"
import { DateTime } from "effect"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { toLLMMessages } from "@opennovel-ai/core/session/runner/to-llm-message"

const model = Model.make({
  id: "test",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 4_000, output: 50 } }),
})

const created = DateTime.makeUnsafe(1_000)

const compactionMessage = (status?: "queued" | "running" | "completed" | "failed" | "interrupted") =>
  ({
    id: SessionMessage.ID.create(),
    type: "compaction",
    reason: "manual",
    ...(status === undefined ? {} : { status }),
    summary: status === "failed" ? "" : "## Objective\n- Done",
    recent: status === "failed" ? "" : "recent",
    time: { created },
  }) as SessionMessage.Message

describe("toLLMMessages compaction handling", () => {
  test("projects completed and legacy compaction messages as conversation checkpoints", () => {
    for (const message of [compactionMessage("completed"), compactionMessage()]) {
      const result = toLLMMessages([message], model)
      expect(result).toHaveLength(1)
      expect(JSON.stringify(result[0])).toContain("conversation-checkpoint")
    }
  })

  test("drops queued, running, failed, and interrupted compaction messages from provider context", () => {
    for (const status of ["queued", "running", "failed", "interrupted"] as const) {
      const result = toLLMMessages([compactionMessage(status)], model)
      expect(result).toEqual([])
    }
  })
})
