// 进程内嵌 server 的 V2 SDK client。CLI 命令统一经 V2 HTTP 面访问会话数据：
// AppRuntime 的服务图是 V1 面（无 SessionV2 服务树），V2 服务装配在 server 侧，
// 内嵌 fetch 复用同进程 Server.Default() 的完整 V2 路由。
import { createOpenNovelClient } from "@opennovel-ai/sdk/v2"

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
