export * as ConfigCompaction from "./compaction"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export class Keep extends Schema.Class<Keep>("ConfigV2.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(Schema.optional),
}) {}

/** 百分比预留如 "15%"：预留 15% 窗口，即在约 85% 水位触发。 */
export const BufferShare = Schema.String.pipe(Schema.check(Schema.isPattern(/^([1-9]\d?|100)%$/)))
export type BufferShare = typeof BufferShare.Type

export class Info extends Schema.Class<Info>("ConfigV2.Compaction")({
  auto: Schema.Boolean.pipe(Schema.optional),
  prune: Schema.Boolean.pipe(Schema.optional),
  keep: Keep.pipe(Schema.optional),
  buffer: Schema.Union([NonNegativeInt, BufferShare]).pipe(Schema.optional),
  background: Schema.Boolean.pipe(Schema.optional),
}) {}
