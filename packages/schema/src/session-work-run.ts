export * as SessionWorkRun from "./session-work-run"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

export const RunStatus = Schema.Literals(["active", "paused", "complete"])
export type RunStatus = typeof RunStatus.Type

export const ItemStatus = Schema.Literals(["pending", "in_progress", "done", "skipped", "blocked"])
export type ItemStatus = typeof ItemStatus.Type

export const Item = Schema.Struct({
  seq: NonNegativeInt,
  title: Schema.String,
  status: ItemStatus,
  note: optional(Schema.String),
}).annotate({ identifier: "SessionWorkRun.Item" })
export interface Item extends Schema.Schema.Type<typeof Item> {}

export const Run = Schema.Struct({
  id: Schema.String,
  sessionID: SessionID,
  goal: Schema.String,
  status: RunStatus,
  progressNote: Schema.String,
  continuationCount: NonNegativeInt,
  noProgressCount: NonNegativeInt,
  timeCreated: DateTimeUtcFromMillis,
  timeUpdated: DateTimeUtcFromMillis,
  items: Schema.Array(Item),
}).annotate({ identifier: "SessionWorkRun.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}

const Updated = define({
  type: "workrun.updated",
  schema: {
    sessionID: SessionID,
    run: Run,
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
