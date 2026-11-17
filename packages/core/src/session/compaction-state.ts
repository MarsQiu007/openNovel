export * as SessionCompactionState from "./compaction-state"

import { SessionEvent } from "./event"
import { SessionMessage } from "./message"

/**
 * 压缩操作消息的统一状态转换：实时 message updater 与 replay projector 共用，
 * 保证两条路径投影结果一致。所有终态转换幂等，先到的终态为准；
 * 重复 replay 不得追加重复消息。
 */
export type Event =
  | typeof SessionEvent.Compaction.Queued.Type
  | typeof SessionEvent.Compaction.Started.Type
  | typeof SessionEvent.Compaction.Ended.Type
  | typeof SessionEvent.Compaction.Failed.Type
  | typeof SessionEvent.Compaction.Interrupted.Type

type Status = NonNullable<SessionMessage.Compaction["status"]>

const TERMINAL: ReadonlySet<Status | undefined> = new Set(["completed", "failed", "interrupted"])

/** 返回 undefined 表示无变化（丢弃或幂等 no-op）；否则返回应 upsert 的消息。 */
export const transition = (current: SessionMessage.Compaction | undefined, event: Event) => {
  switch (event.type) {
    case "session.next.compaction.queued": {
      if (current) return undefined
      return SessionMessage.Compaction.make({
        id: event.data.messageID,
        type: "compaction",
        metadata: event.metadata,
        reason: event.data.reason,
        status: "queued",
        summary: "",
        recent: "",
        time: { created: event.data.timestamp },
      })
    }
    case "session.next.compaction.started": {
      // 旧路径直发 Started：补一条 running 消息
      if (current === undefined)
        return SessionMessage.Compaction.make({
          id: event.data.messageID,
          type: "compaction",
          metadata: event.metadata,
          reason: event.data.reason,
          status: "running",
          summary: "",
          recent: "",
          time: { created: event.data.timestamp },
        })
      if (current.status === "queued") return { ...current, status: "running" as const }
      return undefined
    }
    case "session.next.compaction.ended": {
      // 旧 Ended 没有前置 Queued：直接生成 completed 消息
      if (current === undefined)
        return SessionMessage.Compaction.make({
          id: event.data.messageID,
          type: "compaction",
          metadata: event.metadata,
          reason: event.data.reason,
          status: "completed",
          summary: event.data.text,
          recent: event.data.recent,
          ...(event.data.usage === undefined ? {} : { usage: event.data.usage }),
          time: { created: event.data.timestamp },
        })
      if (TERMINAL.has(current.status)) return undefined
      return {
        ...current,
        status: "completed" as const,
        summary: event.data.text,
        recent: event.data.recent,
        ...(event.data.usage === undefined ? {} : { usage: event.data.usage }),
      }
    }
    case "session.next.compaction.failed": {
      // 旧路径从未发布 Failed，无前置消息时不伪造
      if (current === undefined || TERMINAL.has(current.status)) return undefined
      return { ...current, status: "failed" as const, error: event.data.error }
    }
    case "session.next.compaction.interrupted": {
      if (current === undefined || TERMINAL.has(current.status)) return undefined
      return { ...current, status: "interrupted" as const, cause: event.data.cause }
    }
  }
}
