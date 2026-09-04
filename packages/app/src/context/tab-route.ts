import { base64Encode } from "@opennovel-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import type { ServerConnection } from "./server"

// Tab types and their route/key derivation live here, detached from the tabs
// context so pure consumers (and unit tests) can import them without pulling in
// the provider graph (solid-router's module side effects break under bun test).

export type NovelTab = {
  type: "novel"
  server: ServerConnection.Key
  dir: string
  novelID: string
}

// 终态：标签栏只承载书籍标签。会话与草稿是页面态，不注册标签。
export type Tab = NovelTab

export type TabInfo = {
  title?: string
  directory?: string
}

// Tab title source chain: the persisted cache wins (so a restart shows the
// title immediately, before the novel query resolves), then the freshly
// fetched novel, then the placeholder.
export const novelTabTitle = (info: TabInfo | undefined, novel: { title?: string } | undefined, placeholder: string) =>
  info?.title ?? novel?.title ?? placeholder

export const draftHref = (draftID: string) => `/new-session?draftId=${encodeURIComponent(draftID)}`

export const novelHref = (tab: { dir: string; novelID: string }) => `/${tab.dir}/novel/${tab.novelID}`

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export const tabHref = (tab: Tab) => novelHref(tab)

export const tabKey = (tab: Tab) => `novel:${tab.server}\n${tab.dir}/${tab.novelID}`

// 终态迁移：一次性清除遗留的会话/草稿标签，只保留书籍标签。
// 最近标签/标题缓存指向已清除条目的孤儿键，由 tabs 的启动清洗 effect 同步移除。
export function migrateTabs(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.filter((tab) => !!tab && typeof tab === "object" && (tab as { type?: unknown }).type === "novel")
}

// Same cast as ServerConnection.Key.make; kept local so this module stays free
// of the provider graph.
export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")
  return key as ServerConnection.Key
}

export type LayoutRoute =
  | { type: "home" }
  | { type: "draft"; draftID: string; server?: ServerConnection.Key }
  | { type: "dir-new-sesssion"; dir: string; dirBase64: string; server?: ServerConnection.Key }
  | { type: "session"; sessionId: string; server?: ServerConnection.Key }
  | { type: "novel"; dir: string; dirBase64: string; novelID: string; server?: ServerConnection.Key }

export const currentRoute = (pathname: string, search: string): LayoutRoute => {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return { type: "home" }

  if (parts[0] === "new-session") {
    const draftID = new URLSearchParams(search).get("draftId")
    if (!draftID) return { type: "home" }
    return { type: "draft", draftID }
  }

  if (parts[0] === "server" && parts[2] === "session" && parts[3]) {
    return {
      type: "session",
      sessionId: parts[3],
      server: requireServerKey(parts[1]),
    }
  }

  const dirBase64 = parts[0]
  const dir = decode64(dirBase64)
  if (!dir) return { type: "home" }

  // The workspace route hosts both the novel main view and in-novel sessions
  // (/:dir/novel/:novelID[/session/:id]) — they are one book route. The wizard
  // registers before the workspace route, so its :novelID segment would swallow
  // "/novel/wizard" and mint a ghost "wizard" book tab; keep it a home route.
  if (parts[1] === "novel" && parts[2] && parts[2] !== "wizard") {
    return { type: "novel", dir, dirBase64, novelID: parts[2] }
  }

  if (parts[1] !== "session") return { type: "home" }

  const id = parts[2]
  if (id) return { type: "session", sessionId: id }
  return { type: "dir-new-sesssion", dir, dirBase64 }
}
