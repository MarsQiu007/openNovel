import { createOpenNovelClient } from "@opennovel-ai/sdk/v2"
import { SessionV2 } from "@opennovel-ai/core/session"
import { Schema } from "effect"

const decodeSessionID = Schema.decodeUnknownSync(SessionV2.ID)

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (!input.sessionID) return

  let sessionID: Schema.Schema.Type<typeof SessionV2.ID>
  try {
    sessionID = decodeSessionID(input.sessionID)
  } catch (error) {
    throw new Error(`Invalid session ID: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error })
  }

  await createOpenNovelClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
    headers: input.headers,
  }).v2.session.get({ sessionID }, { throwOnError: true })
}
