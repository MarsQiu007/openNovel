/**
 * 会话打开路由决策（纯逻辑，供统一打开动作 openSessionRouted 与独立会话路由
 * 重定向宿主使用）。独立成模块以便单测：不引入 router / context 等只能在浏览器
 * 环境加载的依赖。
 */
import { base64Encode } from "@opennovel-ai/core/util/encode"
import type { NovelSessionBinding } from "./novel-sessions"

type SessionParent = { id: string; parentID?: string }

export type SessionRoute =
  | { kind: "novel"; dir: string; novelID: string }
  | { kind: "orphan" }

/**
 * 会话统一路由决策：归属解析按「自身绑定行 → 沿父链最近绑定祖先 → 无归属」
 * （subagent-session-binding D3）。有归属的会话在书的工作台打开（唯一宿主）；
 * 整条链都未绑定书籍的遗留会话返回 orphan，由调用方降级到书架并提示。
 * 绑定关系或链数据缺失（查询失败）时按仅自身绑定判定，保证会话路由始终有去处。
 */
export function resolveSessionRoute(input: {
  sessionID: string
  directory: string
  bindings: readonly NovelSessionBinding[] | undefined
  /**
   * 目标会话及其祖先的会话数据（含各自 parentID，含自身条目才能沿链回溯）。
   * 逐级沿 parentID 构成自近到远的会话链，缺条目即视为链端；不传或不可得时
   * 按仅自身绑定判定，与既有降级一致。
   */
  lineage?: readonly SessionParent[]
}): SessionRoute {
  for (const id of walkAncestry(input.sessionID, input.lineage)) {
    const binding = input.bindings?.find((item) => item.sessionID === id)
    if (binding) return { kind: "novel", dir: base64Encode(input.directory), novelID: binding.novelID }
  }
  return { kind: "orphan" }
}

/** 从目标会话起沿 parentID 逐级回溯，返回自近到远的会话 ID 链（visited 防环）。 */
function walkAncestry(sessionID: string, lineage: readonly SessionParent[] | undefined): string[] {
  const parents = new Map(lineage?.map((session) => [session.id, session.parentID]) ?? [])
  const seen = new Set<string>()
  const chain: string[] = []
  let current: string | undefined = sessionID
  while (current && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = parents.get(current)
  }
  return chain
}