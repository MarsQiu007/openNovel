import { createSimpleContext } from "@opennovel-ai/ui/context"
import { createStore } from "solid-js/store"
import { createMemo } from "solid-js"
import { useSDK } from "./sdk"
import { useServerSDK } from "./server-sdk"
import { OpenNovel } from "@opennovel-ai/client"
import { authTokenFromCredentials } from "@/utils/server"

export const { use: useNovel, provider: NovelProvider } = createSimpleContext({
  name: "Novel",
  init: () => {
    const sdk = useSDK()
    const serverSDK = useServerSDK()

    const [store, setStore] = createStore({
      novels: [] as ReadonlyArray<{
        readonly id: string
        readonly title: string
        readonly genre: string
        readonly synopsis: string
        readonly status: string
        readonly createdAt: number
        readonly updatedAt: number
      }>,
      currentNovel: null as {
        readonly id: string
        readonly title: string
        readonly genre: string
        readonly synopsis: string
        readonly status: string
        readonly createdAt: number
        readonly updatedAt: number
        readonly styleGuide: {
          readonly id: string
          readonly novelId: string
          readonly rules: { readonly [x: string]: string }
          readonly tone: string
          readonly pov: string
          readonly tense: string
        }
        readonly stats: {
          readonly chapterCount: number
          readonly volumeCount: number
          readonly characterCount: number
          readonly wordCount: number
        }
      } | null,
      loading: false,
      error: null as string | null,
    })

    const novelClient = createMemo(() => {
      const s = serverSDK()
      const auth = s.server.http.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({ username: s.server.http.username, password: s.server.http.password })}`,
          }
        : undefined
      return OpenNovel.make({
        baseUrl: s.url,
        headers: auth,
      })
    })

    const directory = createMemo(() => sdk().directory)

    async function fetchNovels() {
      setStore("loading", true)
      setStore("error", null)
      try {
        const result = await novelClient()["server.novel"].list({
          location: { directory: directory() },
        })
        setStore("novels", result as typeof store.novels)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Failed to fetch novels"
        setStore("error", message)
      } finally {
        setStore("loading", false)
      }
    }

    async function setCurrentNovel(id: string) {
      setStore("loading", true)
      setStore("error", null)
      try {
        const result = await novelClient()["server.novel"].detail({
          novelID: id,
          location: { directory: directory() },
        })
        setStore("currentNovel", result as typeof store.currentNovel)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Failed to fetch novel detail"
        setStore("error", message)
      } finally {
        setStore("loading", false)
      }
    }

    async function getNovelForSession(sessionID: string) {
      setStore("loading", true)
      setStore("error", null)
      try {
        const result = await novelClient()["server.novel"]["for-session"]({
          sessionID,
          location: { directory: directory() },
        })
        return result
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Failed to get novel for session"
        setStore("error", message)
        return null
      } finally {
        setStore("loading", false)
      }
    }

    async function listSessionBindings() {
      try {
        const result = await novelClient()["server.novel"]["session-bindings"]({
          location: { directory: directory() },
        })
        return result as readonly { sessionID: string; novelID: string; novelTitle: string }[]
      } catch {
        return null
      }
    }

    return {
      get novels() {
        return store.novels
      },
      get currentNovel() {
        return store.currentNovel
      },
      get directory() {
        return directory()
      },
      get loading() {
        return store.loading
      },
      get error() {
        return store.error
      },
      fetchNovels,
      setCurrentNovel,
      getNovelForSession,
      listSessionBindings,
    }
  },
})
