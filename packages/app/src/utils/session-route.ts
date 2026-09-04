import { base64Encode } from "@opennovel-ai/core/util/encode"

export { sessionHref, requireServerKey } from "@/context/tab-route"

export function legacySessionHref(directory: string, sessionID: string) {
  return `/${base64Encode(directory)}/session/${sessionID}`
}

type SessionParent = { id: string; parentID?: string }

export async function rootSession<T extends SessionParent>(session: T, get: (sessionID: string) => Promise<T>) {
  const seen = new Set([session.id])
  let current = session
  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
  }
  return current
}
