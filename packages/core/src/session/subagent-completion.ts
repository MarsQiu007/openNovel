export * as SubagentCompletion from "./subagent-completion"

import { Effect } from "effect"
import type { BackgroundJob } from "../background-job"
import type { SessionV2 } from "../session"
import type { SessionMessage } from "./message"

export const NO_TEXT = "Subagent completed without a text response."

export function text(message: SessionMessage.Assistant | undefined) {
  if (message?.type !== "assistant") return NO_TEXT
  return (
    message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0)
      .join("\n\n") || NO_TEXT
  )
}

export const deliver = Effect.fnUntraced(function* (
  sessions: Pick<SessionV2.Interface, "synthetic">,
  jobs: Pick<BackgroundJob.Interface, "completeBackground">,
  input: Pick<BackgroundJob.Info, "status" | "output" | "error" | "notificationID"> & {
    recovery: Extract<BackgroundJob.Recovery, { kind: "subagent" }>
    resume?: boolean
  },
) {
  if (input.status === "running") return
  const recovery = input.recovery
  const text =
    input.status === "completed"
      ? (input.output ?? NO_TEXT)
      : input.status === "error"
        ? (input.error ?? "Subagent failed")
        : "Subagent cancelled"
  // fork 适配：synthetic 面无 description/metadata 参数（design §4），结构信息由
  // <subagent> 文本块承载
  yield* sessions.synthetic({
    ...(input.notificationID ? { id: input.notificationID } : {}),
    sessionID: recovery.parentSessionID,
    ...(input.resume === false ? { resume: false } : {}),
    text: `<subagent sessionID="${recovery.childSessionID}" state="${input.status}" description="${recovery.description}">\n${text}\n</subagent>`,
  })
  if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
})
