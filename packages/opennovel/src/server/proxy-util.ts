const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

function sanitize(out: Headers) {
  for (const key of hop) out.delete(key)
  out.delete("accept-encoding")
  out.delete("x-opennovel-directory")
  out.delete("x-opennovel-workspace")
}

export function headers(input: Request | HeadersInit | Record<string, string>, extra?: HeadersInit) {
  const raw = input instanceof Request ? input.headers : input
  // Headers 原生支持 Headers、Record 与 [name, value][] 三种形态；走 Object.entries
  // 会把元组数组变成 "0"/"1" 索引键，构造出一堆垃圾头部
  const out = new Headers(raw as HeadersInit)
  sanitize(out)
  if (!extra) return out
  for (const [key, value] of new Headers(extra).entries()) {
    out.set(key, value)
  }
  return out
}

export function websocketProtocols(input: Request | Record<string, string | undefined>) {
  const value = input instanceof Request ? input.headers.get("sec-websocket-protocol") : input["sec-websocket-protocol"]
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function websocketTargetURL(url: string | URL) {
  const next = new URL(url)
  if (next.protocol === "http:") next.protocol = "ws:"
  if (next.protocol === "https:") next.protocol = "wss:"
  return next.toString()
}

export * as ProxyUtil from "./proxy-util"
