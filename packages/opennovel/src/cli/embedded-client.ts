// 进程内嵌 server 的 V2 SDK client。CLI 命令统一经 V2 HTTP 面访问会话数据：
// AppRuntime 的服务图是 V1 面（无 SessionV2 服务树），V2 服务装配在 server 侧，
// 内嵌 fetch 复用同进程 Server.Default() 的完整 V2 路由。
import {
  createOpenNovelClient,
  type OpenNovelClient,
  type SessionMessage,
  type SessionV2Info,
} from "@opennovel-ai/sdk/v2"

export async function embeddedClient(directory?: string) {
  const { ServerAuth } = await import("@/server/auth")
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Bun 的 typeof fetch 带 preconnect 属性，调用签名一致、仅缺该静态属性。
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { Server } = await import("@/server/server")
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    const auth = ServerAuth.header()
    if (auth) headers.set("Authorization", auth)
    return Server.Default().app.fetch(new Request(request, { headers }))
  }) as typeof globalThis.fetch
  return createOpenNovelClient({
    baseUrl: "http://opennovel.internal",
    fetch: fetchFn,
    directory,
  })
}

// V2 list 全量游标分页（服务端恒生成 next 游标，空页即到底）
export async function listAllSessions(client: OpenNovelClient, project?: string): Promise<SessionV2Info[]> {
  const sessions: SessionV2Info[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await client.v2.session.list({
      limit: 50,
      ...(project === undefined ? {} : { project }),
      ...(cursor === undefined ? {} : { cursor }),
    })
    if (page.error) throw new Error(`Failed to list sessions: ${JSON.stringify(page.error)}`)
    const items = page.data?.data ?? []
    sessions.push(...items)
    const next = page.data?.cursor.next
    if (!next || items.length === 0) break
    cursor = next
  }
  return sessions
}

// 读取失败的会话按空消息计（对齐 V1 容忍 NotFound 的行为）
export async function listAllMessages(client: OpenNovelClient, sessionID: string): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await client.v2.session
      .messages({ sessionID, limit: 50, order: "asc", ...(cursor === undefined ? {} : { cursor }) })
      .then((x) => x.data)
      .catch(() => undefined)
    const items = page?.data ?? []
    messages.push(...items)
    const next = page?.cursor.next
    if (!next || items.length === 0) break
    cursor = next
  }
  return messages
}
