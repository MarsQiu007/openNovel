export * from "./client.js"
export * from "./server.js"

import { createOpenNovelClient } from "./client.js"
import { createOpenNovelServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createOpenNovel(options?: ServerOptions) {
  const server = await createOpenNovelServer({
    ...options,
  })

  const client = createOpenNovelClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
