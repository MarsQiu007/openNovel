import { createEffect, on, onCleanup, type Accessor } from "solid-js"
import { useQueryClient, type QueryClient } from "@tanstack/solid-query"
import { useServerSDK } from "./server-sdk"
import { useNovel } from "./novel"
import type { Event } from "@opennovel-ai/sdk/v2/client"

// Query keys matching novel-queries.ts pattern
const novelKeys = {
  detail: (directory: string, novelID: string) => ["novel", "detail", directory, novelID] as const,
  chapters: (directory: string, novelID: string) => ["novel", "chapters", directory, novelID] as const,
  outline: (directory: string, novelID: string) => ["novel", "outline", directory, novelID] as const,
  tension: (directory: string, novelID: string) => ["novel", "tension", directory, novelID] as const,
}

// 失效范围排除清单：单章正文/版本/批注在对应面板挂载时凭 refetchOnMount 自行拉取，
// 实时失效可能覆盖编辑器里未保存的改动。
const EXCLUDED_LIVE = new Set(["chapter", "chapter-versions", "chapter-reviews", "annotations"])

/** 查询 key 是否落在指定小说的实时失效范围内（覆盖全部 ["novel", *, directory, novelID, ...] 形态）。 */
export function isNovelLiveKey(queryKey: readonly unknown[], directory: string, novelID: string) {
  return (
    queryKey[0] === "novel" &&
    !EXCLUDED_LIVE.has(String(queryKey[1])) &&
    queryKey.includes(directory) &&
    queryKey.includes(novelID)
  )
}

/**
 * 构造"失效当前小说作用域"的执行器（book-open-transition D5）。
 * 工作台在书与书之间切换时组件不重挂（单 Route 仅 params 变化），作用域必须经 accessor
 * 在调用时读取——值参数会让失效停留在挂载时的第一本书（切书后会话事件失效错书）。
 */
export function createNovelInvalidator(input: {
  queryClient: QueryClient
  directory: Accessor<string>
  novelID: Accessor<string>
}) {
  return () =>
    input.queryClient.invalidateQueries({
      predicate: (query) => isNovelLiveKey(query.queryKey, input.directory(), input.novelID()),
    })
}

/**
 * Subscribes to directory SSE events and invalidates novel query keys.
 *
 * - `session.status` for a session bound to this novel → immediate broad invalidation
 * - V2 内容进展事件（text.delta/tool.success/step.ended）for a bound session → 5s debounce then broad invalidate
 * - Active (busy/retry) bound sessions → 15s polling broad invalidation
 * - 单章正文/版本/批注不在实时失效范围内，挂载时自行刷新
 *
 * 订阅与定时器保持单份（组件不随切书重挂）；directory / novelID 以 accessor 传入，
 * 失效判定与 bindings 过滤在调用时读取当前位置。
 */
export function useNovelLiveInvalidation(directory: Accessor<string>, novelID: Accessor<string>) {
  const serverSDK = useServerSDK()
  const sdk = serverSDK()
  const queryClient = useQueryClient()
  const novel = useNovel()

  const invalidateNovel = createNovelInvalidator({ queryClient, directory, novelID })

  // ---- bound session tracking ----
  // 之前依赖 getQueryData(for-session) 判断会话归属，但该 hook 从未被组件调用，
  // 导致所有 session.status 事件被跳过、UI 不刷新。改为主动拉取 bindings。

  const boundSessionIds = new Set<string>()

  async function refreshBindings() {
    const bindings = await novel.listSessionBindings()
    boundSessionIds.clear()
    if (!bindings) return
    // await 期间可能已切书：按落地时的当前书过滤，不把旧书的绑定留作本作用域
    const current = novelID()
    for (const b of bindings) {
      if (b.novelID === current) boundSessionIds.add(b.sessionID)
    }
  }

  void refreshBindings()

  // 切书立即重拉绑定（订阅保持单份；周期刷新兜底）
  createEffect(
    on(novelID, () => void refreshBindings(), { defer: true }),
  )

  // ---- 内容进展事件: 5s debounce ----

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleDebouncedInvalidate = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      invalidateNovel()
    }, 5000)
  }

  // ---- active session polling: 15s refetchInterval ----

  const busySessions = new Set<string>()
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let bindingsTimer: ReturnType<typeof setInterval> | undefined

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

  // Periodically refresh bindings so newly created sessions are picked up
  bindingsTimer = setInterval(() => {
    void refreshBindings()
  }, 10000)

  // ---- SSE subscription ----

  const unsub = sdk.event.on(directory(), (event: Event) => {
    if (event.type === "session.status") {
      const { sessionID, status } = event.properties
      // Refresh bindings if we don't know this session yet (may be newly bound)
      if (!boundSessionIds.has(sessionID)) {
        void refreshBindings().then(() => {
          if (boundSessionIds.has(sessionID)) {
            invalidateNovel()
            trackBusy(sessionID, status.type)
          }
        })
        return
      }

      invalidateNovel()
      trackBusy(sessionID, status.type)
      return
    }

    // V1 message.part.updated 已裁撤；以 V2 内容进展事件（流式文本/工具结算/step 完成）替代。
    if (
      event.type === "session.next.text.delta" ||
      event.type === "session.next.tool.success" ||
      event.type === "session.next.step.ended"
    ) {
      if (boundSessionIds.has(event.properties.sessionID)) {
        scheduleDebouncedInvalidate()
      }
    }
  })

  function trackBusy(sessionID: string, statusType: string) {
    if (statusType === "busy" || statusType === "retry") {
      busySessions.add(sessionID)
      startPolling()
    } else {
      busySessions.delete(sessionID)
      if (busySessions.size === 0) stopPolling()
    }
  }

  onCleanup(() => {
    unsub()
    if (debounceTimer) clearTimeout(debounceTimer)
    if (bindingsTimer) clearInterval(bindingsTimer)
    stopPolling()
  })
}