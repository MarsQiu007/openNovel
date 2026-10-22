/**
 * 会话归属继承解析（V2 版，subagent-session-binding D2）：以 ctx.session.get
 * 逐级读取 parentID 作为父链访问器，交由 novel-store 按「自身绑定 → 单书懒绑定 →
 * 最近绑定祖先 → 无归属」解析并幂等写回继承。父链查询失败由解析层按无归属降级，
 * 不阻断调用方流程。
 */
import type { SessionDomain } from "../../v2/effect/session.js"
import { resolveNovelForSessionWithInheritance } from "../session-store.js"

export function resolveSessionNovel(
  session: SessionDomain,
  sessionId: string,
  directory: string | null | undefined,
): Promise<string | undefined> {
  return resolveNovelForSessionWithInheritance(sessionId, directory, async (id) => {
    const ref = await session.get(id).catch(() => undefined)
    return ref?.parentID
  })
}
