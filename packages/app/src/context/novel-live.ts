import { onCleanup } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import { useServerSDK } from "./server-sdk"
import type { Event } from "@opennovel-ai/sdk/v2/client"

// Query keys matching novel-queries.ts pattern
const novelKeys = {
  detail: (directory: string, novelID: string) => ["novel", "detail", directory, novelID] as const,
  chapters: (directory: string, novelID: string) => ["novel", "chapters", directory, novelID] as const,
  outline: (directory: string, novelID: string) => ["novel", "outline", directory, novelID] as const,
  tension: (directory: string, novelID: string) => ["novel", "tension", directory, novelID] as const,
  "for-session": (directory: string, sessionID: string) => ["novel", "for-session", directory, sessionID] as const,
}

/**
 * Subscribes to existing directory SSE events and invalidates novel query keys.
 *
 * - `session.status` for a bound session → immediate broad invalidation (角色/世界观/弧光/章节列表等)
 * - `message.part.updated` → 5s debounce then broad invalidate
 * - Active (busy/retry) bound sessions → 15s polling broad invalidation
 * - 单章正文/版本/批注不在实时失效范围内，挂载时自行刷新
 */
export function useNovelLiveInvalidation(directory: string, novelID: string) {
  const serverSDK = useServerSDK()
  const sdk = serverSDK()
  const queryClient = useQueryClient()

  // ---- helpers ----

  // 失效本小说下的查询。AI 在写作过程中可能改动角色、世界观、伏笔、
  // 结构线/弧光、关系等任意实体，只失效少量 key 会导致这些面板停留在旧数据。
  // 用 predicate 覆盖所有 ["novel", *, directory, novelID, ...] 形态的 key；
  // 但排除单章正文/版本/批注这类 per-chapter 查询——它们会在对应面板挂载时
  // 凭借 refetchOnMount 拉取最新数据，实时失效可能覆盖编辑器里未保存的改动。
  const EXCLUDED_LIVE = new Set(["chapter", "chapter-versions", "chapter-reviews", "annotations"])
  const invalidateNovel = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey
        return (
          Array.isArray(key) &&
          key[0] === "novel" &&
          !EXCLUDED_LIVE.has(String(key[1])) &&
          key.includes(directory) &&
          key.includes(novelID)
        )
      },
    })
  }

  // ---- message.part.updated: 5s debounce ----

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleDebouncedInvalidate = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      invalidateNovel()
    }, 5000)
  }

  // ---- active session polling: 15s refetchInterval on chapter queries ----

  const busySessions = new Set<string>()
  let pollTimer: ReturnType<typeof setInterval> | undefined

  const startPolling = () => {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      invalidateNovel()
    }, 15000)
  }

  const stopPolling = () => {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = undefined
  }

  // ---- SSE subscription ----

  const unsub = sdk.event.on(directory, (event: Event) => {
    if (event.type === "session.status") {
      const { sessionID, status } = event.properties
      const cached = queryClient.getQueryData(novelKeys["for-session"](directory, sessionID))
      if (!cached) return // not a novel-bound session

      const boundNovelID = (cached as { id: string }).id
      if (boundNovelID !== novelID) return

      // Immediate invalidation on status change for a bound session
      invalidateNovel()

      // Track busy/idle for 15s polling
      if (status.type === "busy" || status.type === "retry") {
        busySessions.add(sessionID)
        startPolling()
      } else {
        busySessions.delete(sessionID)
        if (busySessions.size === 0) stopPolling()
      }
      return
    }

    if (event.type === "message.part.updated") {
      scheduleDebouncedInvalidate()
    }
  })

  onCleanup(() => {
    unsub()
    if (debounceTimer) clearTimeout(debounceTimer)
    stopPolling()
  })
}
