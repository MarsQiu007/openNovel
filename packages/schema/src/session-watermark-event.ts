export * as SessionWatermarkEvent from "./session-watermark-event"

import { Event } from "./event"
import { DateTimeUtcFromMillis } from "./schema"
import { Session } from "./session"
import { SessionID } from "./session-id"

const Base = {
  timestamp: DateTimeUtcFromMillis,
  sessionID: SessionID,
}

/**
 * 上下文水位刷新通知（live-only，非 durable）：快照随时可经 session.get 重取，
 * 事件只驱动实时 UI，无需持久化与重放。
 */
export const Refreshed = Event.define({
  type: "session.context.watermark",
  schema: {
    ...Base,
    watermark: Session.ContextWatermark,
  },
})
export type Refreshed = typeof Refreshed.Type

export const Definitions = Event.inventory(Refreshed)
