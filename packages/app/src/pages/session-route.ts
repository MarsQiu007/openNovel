/**
 * 会话打开路由决策（纯逻辑，供统一打开动作 openSessionRouted 使用）。
 * 独立成模块以便单测：不引入 router / context 等只能在浏览器环境加载的依赖。
 */
import { base64Encode } from "@opennovel-ai/core/util/encode"
import type { NovelSessionBinding } from "./novel-sessions"

export type SessionRoute =
  | { kind: "novel"; dir: string; novelID: string }
  | { kind: "tab" }

/**
 * 绑定会话统一路由决策：绑定到书的会话在书的工作台打开（唯一宿主），其余走独立会话 tab。
 * 绑定关系缺失（查询失败）时按未绑定降级，保证会话始终能打开。
 */
export function resolveSessionRoute(input: {
  sessionID: string
  directory: string
  bindings: readonly NovelSessionBinding[] | undefined
}): SessionRoute {
  const binding = input.bindings?.find((item) => item.sessionID === input.sessionID)
  if (binding) return { kind: "novel", dir: base64Encode(input.directory), novelID: binding.novelID }
  return { kind: "tab" }
}
