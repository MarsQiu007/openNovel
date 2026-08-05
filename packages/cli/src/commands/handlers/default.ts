import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect } from "effect"

export default Runtime.handler(Commands, () =>
  Effect.log("CLI 模式已停用。请使用 Electron 桌面客户端：bun run dev:desktop"),
)
