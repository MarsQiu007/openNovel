import { base64Encode } from "@opennovel-ai/core/util/encode"

export { sessionHref, requireServerKey } from "@/context/tab-route"

export function legacySessionHref(directory: string, sessionID: string) {
  return `/${base64Encode(directory)}/session/${sessionID}`
}

type SessionParent = { id: string; parentID?: string }

/**
 * 自目标会话沿 parentID 逐级回溯到根，返回自近到远的完整会话链
 * （含目标会话自身；visited 防环，环上抛错）。
 */
export async function sessionChain<T extends SessionParent>(session: T, get: (sessionID: string) => Promise<T>) {
  const seen = new Set([session.id])
  const chain = [session]
  let current = session
  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
    chain.push(current)
  }
  return chain
}
