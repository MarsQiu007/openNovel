import type { Session } from "@opennovel-ai/sdk/v2/client"

/**
 * 收集会话的全部后代（子代理会话）。
 * 写作流水线会以主会话为 parent 派生子代理会话，归档主会话时需要级联处理。
 */
export function collectDescendants(rootID: string, sessions: readonly Session[]): Session[] {
  const byParent = new Map<string, Session[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const list = byParent.get(session.parentID) ?? []
    list.push(session)
    byParent.set(session.parentID, list)
  }
  const out: Session[] = []
  // visited 防护：异常环状 parent 数据（a→b→a）不会导致死循环
  const visited = new Set([rootID])
  const queue = [rootID]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const child of byParent.get(id) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      out.push(child)
      queue.push(child.id)
    }
  }
  return out
}
