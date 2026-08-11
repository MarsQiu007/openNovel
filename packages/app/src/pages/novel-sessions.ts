/**
 * 书籍会话分组数据逻辑（会话页侧边栏 & 聊天页侧边栏共用）
 *
 * 负责：novel API client 构建、书籍列表 / 绑定关系 / 目录完整会话列表的查询、
 * 按会话 ID 打开会话（tab）、为书籍创建并绑定新会话、归档会话。
 */
import { type Accessor, createMemo, startTransition } from "solid-js"
import { produce } from "solid-js/store"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import type { Session } from "@opennovel-ai/sdk/v2/client"
import { OpenNovel } from "@opennovel-ai/client"
import { Binary } from "@opennovel-ai/core/util/binary"
import { ServerConnection } from "@/context/server"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { authTokenFromCredentials } from "@/utils/server"
import { archiveHomeSession } from "./home-session-archive"
import { errorMessage } from "@/pages/layout/helpers"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"
import { collectDescendants } from "@/utils/session-descendants"

export type NovelSessionBinding = {
  sessionID: string
  novelID: string
  novelTitle: string
}

export type NovelSessionNovel = {
  id: string
  title: string
}

type SessionArchiveUpdate = {
  directory: string
  sessionID: string
  time: { archived: number }
}

/**
 * 级联归档主会话及其全部子代理会话（侧边栏归档、删除书籍共用）。
 */
export async function archiveSessionCascade(input: {
  server: ServerConnection.Key
  session: Session
  /** 当前目录完整会话列表，用于收集子代理后代 */
  sessions: readonly Session[]
  update: (value: SessionArchiveUpdate) => Promise<unknown>
  remove: (session: Session) => void
  onError: (error: unknown) => void
}) {
  const descendants = collectDescendants(input.session.id, input.sessions).filter((s) => !s.time.archived)
  for (const target of [input.session, ...descendants]) {
    await archiveHomeSession({
      server: input.server,
      session: target,
      update: input.update,
      remove: () => input.remove(target),
      onError: input.onError,
    })
  }
}

export function useNovelSessions(input: {
  conn: Accessor<ServerConnection.Any | undefined>
  directory: Accessor<string | undefined>
  /** 服务器标识，仅用于 query key 区分不同服务器的数据 */
  server: Accessor<string>
}) {
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const queryClient = useQueryClient()

  const novelClient = createMemo(() => {
    const conn = input.conn()
    if (!conn) return null
    const auth = conn.http.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: conn.http.username,
            password: conn.http.password,
          })}`,
        }
      : undefined
    return OpenNovel.make({ baseUrl: conn.http.url, headers: auth })
  })

  const novelsQuery = useQuery(() => ({
    queryKey: ["sessions-novels", input.server(), input.directory()],
    enabled: !!novelClient() && !!input.directory(),
    queryFn: async () => {
      const result = await novelClient()!["server.novel"].list({ location: { directory: input.directory()! } })
      return result as readonly NovelSessionNovel[]
    },
    staleTime: 30_000,
  }))

  const bindingsQuery = useQuery(() => ({
    queryKey: ["sessions-novel-bindings", input.server(), input.directory()],
    enabled: !!novelClient() && !!input.directory(),
    queryFn: async () => {
      const result = await novelClient()!["server.novel"]["session-bindings"]({
        location: { directory: input.directory()! },
      })
      return result as readonly NovelSessionBinding[]
    },
    staleTime: 10_000,
    refetchOnMount: true,
  }))

  // 绑定会话可能超出主页 64 条最近会话上限，这里拉取当前目录完整会话列表，
  // 保证老会话也能在侧边栏显示并打开
  const sessionsQuery = useQuery(() => ({
    queryKey: ["sessions-novel-sessions", input.server(), input.directory()],
    enabled: !!input.conn() && !!input.directory(),
    queryFn: async () => {
      const ctx = global.ensureServerCtx(input.conn()!)
      const res = await ctx.sdk.client.session.list({ directory: input.directory() })
      return res.data ?? []
    },
    staleTime: 15_000,
    refetchOnMount: true,
  }))

  const boundSessionIds = createMemo(() => new Set((bindingsQuery.data ?? []).map((binding) => binding.sessionID)))

  const loading = createMemo(() => novelsQuery.isLoading || bindingsQuery.isLoading)

  function refresh() {
    const directory = input.directory()
    void queryClient.invalidateQueries({ queryKey: ["sessions-novel-bindings", input.server(), directory] })
    void queryClient.invalidateQueries({ queryKey: ["sessions-novel-sessions", input.server(), directory] })
  }

  // 直接按会话 ID 打开（绑定的老会话可能不在最近 records 里，
  // 拿不到完整 Session 对象，因此走 tabs 而非按对象打开）
  function openSessionById(sessionID: string) {
    const conn = input.conn()
    if (!conn) return
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: sessionID })
      tabs.select(tab)
    })
  }

  // 为指定书籍创建新会话并绑定，创建后直接打开
  async function createNovelSession(novelID: string, title: string) {
    const conn = input.conn()
    const client = novelClient()
    const directory = input.directory()
    if (!conn || !client || !directory) return
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    const res = await ctx.sdk.client.session.create({ directory, title })
    const sessionID = res.data?.id
    if (!sessionID) throw new Error("No session data returned")
    await client["server.novel"].bind({ novelID, location: { directory }, sessionID })
    refresh()
    openSessionById(sessionID)
  }

  // 归档主会话时级联归档其全部子代理会话，避免遗留孤儿会话
  async function archiveSession(session: Session) {
    const conn = input.conn()
    if (!conn) return
    const ctx = global.ensureServerCtx(conn)
    const [, setStore] = ctx.sync.child(session.directory)
    await archiveSessionCascade({
      server: ServerConnection.key(conn),
      session,
      sessions: sessionsQuery.data ?? [],
      update: (value) => ctx.sdk.client.session.update(value),
      remove: (target) =>
        setStore(
          produce((draft) => {
            const match = Binary.search(draft.session, target.id, (s) => s.id)
            if (match.found) draft.session.splice(match.index, 1)
          }),
        ),
      onError: (error) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(error, language.t("common.requestFailed")),
        }),
    })
    refresh()
  }

  return {
    novels: () => novelsQuery.data ?? [],
    bindings: () => bindingsQuery.data ?? [],
    sessions: () => sessionsQuery.data ?? [],
    boundSessionIds,
    loading,
    refresh,
    openSessionById,
    createNovelSession,
    archiveSession,
  }
}
