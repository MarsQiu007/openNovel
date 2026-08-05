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
 * - `session.status` for a bound session → immediate invalidation of chapters/detail/tension/outline
 * - `message.part.updated` → 5s debounce then batch invalidate
 * - Active (busy/retry) bound sessions → 15s polling on chapter (approval) queries
 */
export function useNovelLiveInvalidation(directory: string, novelID: string) {
  const serverSDK = useServerSDK()
  const sdk = serverSDK()
  const queryClient = useQueryClient()

  // ---- helpers ----

  const invalidateNovel = () => {
    queryClient.invalidateQueries({ queryKey: novelKeys.detail(directory, novelID) })
    queryClient.invalidateQueries({ queryKey: novelKeys.chapters(directory, novelID) })
    queryClient.invalidateQueries({ queryKey: novelKeys.outline(directory, novelID) })
    queryClient.invalidateQueries({ queryKey: novelKeys.tension(directory, novelID) })
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
      queryClient.invalidateQueries({ queryKey: novelKeys.chapters(directory, novelID) })
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
