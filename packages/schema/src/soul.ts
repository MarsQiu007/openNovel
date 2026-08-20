export * as Soul from "./soul"

import { Schema } from "effect"

/** 全局灵魂：应用级默认人格文本，对所有会话生效，可被小说灵魂覆盖。 */
export interface Global extends Schema.Schema.Type<typeof Global> {}
export const Global = Schema.Struct({
  content: Schema.String,
}).annotate({ identifier: "Soul.Global" })

export interface UpdateGlobalInput extends Schema.Schema.Type<typeof UpdateGlobalInput> {}
export const UpdateGlobalInput = Schema.Struct({
  content: Schema.String,
}).annotate({ identifier: "Soul.UpdateGlobalInput" })
