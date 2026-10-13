/**
 * 会话打开路由决策（纯逻辑，供统一打开动作 openSessionRouted 与独立会话路由
 * 重定向宿主使用）。独立成模块以便单测：不引入 router / context 等只能在浏览器
 * 环境加载的依赖。
 */
import { base64Encode } from "@opennovel-ai/core/util/encode"
import type { NovelSessionBinding } from "./novel-sessions"

export type SessionRoute =
  | { kind: "novel"; dir: string; novelID: string }
  | { kind: "orphan" }

/**
 * 会话统一路由决策：绑定到书的会话在书的工作台打开（唯一宿主）；未绑定书籍的
 * 遗留会话返回 orphan，由调用方降级到书架并提示。绑定关系缺失（查询失败）时
 * 同样按 orphan 降级，保证会话路由始终有去处。
 */
export function resolveSessionRoute(input: {
  sessionID: string
  directory: string
  bindings: readonly NovelSessionBinding[] | undefined
}): SessionRoute {
  const binding = input.bindings?.find((item) => item.sessionID === input.sessionID)
  if (binding) return { kind: "novel", dir: base64Encode(input.directory), novelID: binding.novelID }
  return { kind: "orphan" }
}
