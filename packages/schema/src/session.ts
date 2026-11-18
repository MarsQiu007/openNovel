export * as Session from "./session"

import { Schema } from "effect"
import { Agent } from "./agent"
import { Location } from "./location"
import { Model } from "./model"
import { Project } from "./project"
import { DateTimeUtcFromMillis, NonNegativeInt, optional, RelativePath } from "./schema"
import { SessionEvent } from "./session-event"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"
import { Revert } from "./revert"

export const ID = SessionID
export type ID = SessionID

export const Event = SessionEvent

/** 统一上下文水位：驱动自动触发、溢出恢复与 UI 展示的唯一派生读模型。 */
export interface ContextWatermark extends Schema.Schema.Type<typeof ContextWatermark> {}
export const ContextWatermark = Schema.Struct({
  model: Model.Ref,
  window: NonNegativeInt.pipe(optional),
  measured: NonNegativeInt,
  estimated: NonNegativeInt,
  total: NonNegativeInt,
  ratio: Schema.Finite,
  trigger: Schema.Struct({
    share: Schema.Union([Schema.Finite, Schema.String]).pipe(optional),
    tokens: NonNegativeInt.pipe(optional),
  }).pipe(optional),
  source: Schema.Literals(["measured", "estimated", "mixed"]),
  /** 后台候选摘要正在准备（未改历史、未发送压缩增量）；快照与刷新通知共用同一信号 */
  preparing: Schema.Boolean.pipe(optional),
  degraded: Schema.String.pipe(optional),
}).annotate({ identifier: "Session.ContextWatermark" })

/** 手动压缩受理结果：status 为消息状态词表加 skipped（无窗口/无可压缩内容时不创建操作）。 */
export interface CompactionAdmission extends Schema.Schema.Type<typeof CompactionAdmission> {}
export const CompactionAdmission = Schema.Struct({
  messageID: SessionMessage.ID.pipe(optional),
  status: Schema.Literals(["queued", "running", "completed", "failed", "interrupted", "skipped"]),
  retryOf: SessionMessage.ID.pipe(optional),
}).annotate({ identifier: "Session.CompactionAdmission" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    archived: DateTimeUtcFromMillis.pipe(optional),
  }),
  title: Schema.String,
  location: Location.Ref,
  subpath: RelativePath.pipe(optional),
  revert: Revert.State.pipe(optional),
  context: ContextWatermark.pipe(optional),
}).annotate({ identifier: "SessionV2.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
}).annotate({ identifier: "Session.ListAnchor" })
export interface ListAnchor extends Schema.Schema.Type<typeof ListAnchor> {}
