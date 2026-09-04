import { createSimpleContext } from "@opennovel-ai/ui/context"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted, removePersisted, draftPersistedKeys } from "@/utils/persist"
import { ServerConnection, useServer } from "./server"
import { createEffect, createRoot, onCleanup, startTransition } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { usePlatform } from "./platform"
import { uuid } from "@/utils/uuid"
import { nextTabAfterClose, pushClosedTab, takeClosedTab, type ClosedTab } from "./closed-tabs"
import { createDraftPromptSession, type PromptModel, type PromptSession } from "./prompt-state"
import {
  draftHref,
  migrateTabs,
  tabHref,
  tabKey,
  type NovelTab,
  type Tab,
} from "./tab-route"

export type { NovelTab, Tab } from "./tab-route"
export { draftHref, migrateTabs, novelHref, tabHref, tabKey } from "./tab-route"

export type TabInfo = {
  title?: string
  directory?: string
}

// 草稿页面态：/new-session 页面的草稿不再注册标签，状态挂在内存注册表上。
// 提交后导航会话路由；离开 /new-session 草稿即失去入口，注册表整体清理。
export type DraftPageState = {
  server: ServerConnection.Key
  directory: string
  draftID: string
}

type RecentTab = {
  key?: string
}

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.window("tabs"),
        migrate: (value: unknown) => migrateTabs(value),
      },
      createStore<Tab[]>([]),
    )
    const [recent, setRecent, , recentReady] = persisted(Persist.window("tabs.recent"), createStore<RecentTab>({}))
    const [info, setInfo] = persisted(Persist.window("tabs.info"), createStore<Record<string, TabInfo>>({}))
    const [closed, setClosed, , closedReady] = persisted(Persist.window("tabs.closed"), createStore<ClosedTab[]>([]))

    const navigate = useNavigate()
    const location = useLocation()

    const closing = new Set<string>()
    let recentWrite = 0
    let recentValue: string | undefined

    const recentKey = () => (recentWrite ? recentValue : recent.key)

    const setRecentKey = (key: string | undefined) => {
      const write = ++recentWrite
      recentValue = key
      if (recentReady()) {
        setRecent("key", key)
        return
      }
      void recentReady.promise?.then(() => {
        if (write === recentWrite) setRecent("key", key)
      })
    }

    const updateClosed = (update: (stack: ClosedTab[]) => ClosedTab[]) => {
      const apply = () => setClosed((stack) => update(stack))
      if (closedReady()) {
        apply()
        return
      }
      void closedReady.promise?.then(apply)
    }

    const removeDraftPersisted = (draftID: string) => {
      for (const key of draftPersistedKeys()) removePersisted(Persist.draft(draftID, key), platform)
    }

    const removeInfo = (key: string) => {
      if (!info[key]) return
      setInfo(
        produce((draft) => {
          delete draft[key]
        }),
      )
    }

    // 草稿页面态注册表（内存态）：draftID → 页面参数 + prompt session。
    // prompt 实例单独放 Map，避免被 store 代理化破坏其内部响应式。
    const [draftPages, setDraftPages] = createStore<Record<string, DraftPageState>>({})
    const draftPrompts = new Map<string, PromptSession>()
    const draftDisposers = new Map<string, VoidFunction>()

    const disposeDraftPage = (draftID: string) => {
      if (!draftDisposers.has(draftID)) return
      setDraftPages(
        produce((draft) => {
          delete draft[draftID]
        }),
      )
      draftPrompts.delete(draftID)
      const dispose = draftDisposers.get(draftID)
      draftDisposers.delete(draftID)
      dispose?.()
      removeDraftPersisted(draftID)
    }

    // 提交成功后的导航与手动离开都会切换路由，草稿此刻失去入口，就地清理。
    // 切换项目只更新注册表条目（URL 不变），不会触发。
    createEffect(() => {
      if (location.pathname === "/new-session") return
      for (const draftID of [...draftDisposers.keys()]) disposeDraftPage(draftID)
    })

    createEffect(() => {
      if (!ready() || !recentReady()) return
      const servers = new Set(server.list.map(ServerConnection.key))
      const next = store.filter((tab) => servers.has(tab.server))
      if (next.length !== store.length) {
        for (const tab of store) {
          if (!servers.has(tab.server)) {
            const key = tabKey(tab)
            removeInfo(key)
          }
        }
        setStore(() => next)
      }
      if (recent.key && !next.some((tab) => tabKey(tab) === recent.key)) setRecentKey(undefined)
      const keys = new Set(next.map(tabKey))
      for (const key of Object.keys(info)) {
        if (!keys.has(key)) removeInfo(key)
      }
    })

    createEffect(() => {
      if (!closedReady()) return
      // 遗留会话/草稿的最近关闭条目在终态一并清除（迁移只清洗标签栈本身）。
      const servers = new Set(server.list.map(ServerConnection.key))
      const next = closed.filter((entry) => entry.tab.type === "novel" && servers.has(entry.tab.server))
      if (next.length !== closed.length) setClosed(() => next)
    })

    const navigateTab = (tab: Tab) => {
      const href = tabHref(tab)
      setRecentKey(tabKey(tab))
      navigate(href)
    }

    const removeTab = (index: number) => {
      const tab = store[index]
      if (!tab) return
      const key = tabKey(tab)
      const nextTab = nextTabAfterClose(store, index, recentKey() === key && location.pathname !== "/")
      closing.add(key)
      void startTransition(() => {
        setStore(
          produce((tabs) => {
            tabs.splice(index, 1)
          }),
        )
        if (nextTab === null) {
          setRecentKey(undefined)
          navigate("/")
        }
        if (nextTab) navigateTab(nextTab)
      }).finally(() => closing.delete(key))
      removeInfo(key)
    }

    const actions = {
      addNovelTab: (tab: Omit<NovelTab, "type">) => {
        const next = { type: "novel" as const, ...tab }
        const existing = store.find((item) => tabKey(item) === tabKey(next))
        if (existing) return existing
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              if (tabs.some((item) => tabKey(item) === tabKey(next))) return
              tabs.push(next)
            }),
          )
        })
        return next
      },
      reorder(keys: string[]) {
        setStore(
          produce((tabs) => {
            const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]))
            const next = keys.map((key) => byKey.get(key)).filter((tab): tab is Tab => !!tab)
            if (next.length !== tabs.length) return
            tabs.splice(0, tabs.length, ...next)
          }),
        )
      },
      draftPage: (draftID: string | undefined) => (draftID ? draftPages[draftID] : undefined),
      draftPrompt: (draftID: string) => draftPrompts.get(draftID),
      async newDraft(draft: { server: ServerConnection.Key; directory: string }, prompt?: string, model?: PromptModel) {
        // 同一时刻只有一个可达草稿（没有标签入口），新草稿注册时清理旧的。
        for (const draftID of [...draftDisposers.keys()]) disposeDraftPage(draftID)
        const draftID = uuid()
        const owned = createRoot((dispose) => ({ dispose, prompt: createDraftPromptSession(draftID, { prompt, model }) }))
        draftDisposers.set(draftID, owned.dispose)
        draftPrompts.set(draftID, owned.prompt)
        setDraftPages(draftID, { server: draft.server, directory: draft.directory, draftID })
        await startTransition(() => {
          navigate(draftHref(draftID))
        })
      },
      updateDraft(draftID: string, draft: Partial<Pick<DraftPageState, "server" | "directory">>) {
        if (!draftPages[draftID]) return
        setDraftPages(draftID, draft)
      },
      removeTab,
      // User-initiated close: records the tab so it can be reopened.
      // Cleanup paths (missing sessions, archive, server removal) go through
      // removeTab and friends directly and are not recorded.
      closeTab(index: number) {
        const tab = store[index]
        if (!tab) return
        updateClosed((stack) => pushClosedTab(stack, tab, index))
        removeTab(index)
      },
      reopenClosedTab() {
        if (!closedReady()) {
          void closedReady.promise?.then(() => actions.reopenClosedTab())
          return
        }
        const result = takeClosedTab(closed, store)
        if (result.stack.length === closed.length) return
        setClosed(() => result.stack)
        const entry = result.entry
        if (!entry) return
        const index = Math.min(entry.index, store.length)
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              if (tabs.some((item) => tabKey(item) === tabKey(entry.tab))) return
              tabs.splice(index, 0, entry.tab)
            }),
          )
          navigateTab(entry.tab)
        })
      },
      removeServer(key: ServerConnection.Key) {
        updateClosed((stack) => stack.filter((entry) => entry.tab.server !== key))
        for (const page of Object.values(draftPages)) {
          if (page.server === key) disposeDraftPage(page.draftID)
        }
        const removed = store.filter((tab) => tab.server === key).map(tabKey)
        setStore((tabs) => tabs.filter((tab) => tab.server !== key))
        for (const key of removed) removeInfo(key)
        if (recent.key && removed.includes(recent.key)) setRecentKey(undefined)
        if (server.key === key) navigate("/")
      },
      rememberNovelInfo(tab: NovelTab, novel: { title?: string }) {
        const key = tabKey(tab)
        const next = { title: novel.title }
        const current = info[key]
        if (current?.title === next.title) return
        setInfo(key, next)
      },
      select: navigateTab,
      remember(tab: Tab) {
        const key = tabKey(tab)
        if (recentKey() !== key) setRecentKey(key)
      },
      toggleHome(input: { home: boolean; current?: Tab }) {
        if (input.home) {
          const tab = store.find((tab) => tabKey(tab) === recentKey())
          if (tab) navigateTab(tab)
          return
        }
        if (input.current) {
          setRecentKey(tabKey(input.current))
          navigate("/")
          return
        }
        navigate("/")
      },
    }
    return { ...actions, store, info, ready, recentReady }
  },
})
