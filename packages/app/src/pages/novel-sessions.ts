/**
 * 书籍会话分组数据逻辑（会话页侧边栏 & 聊天页侧边栏共用）
 *
 * 负责：novel API client 构建、书籍列表 / 绑定关系 / 目录完整会话列表的查询、
 * 按会话 ID 打开会话（tab）、为书籍创建并绑定新会话、归档会话。
 */
import { type Accessor, createEffect, createMemo, startTransition } from "solid-js"
import { produce } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import type { Session } from "@opennovel-ai/sdk/v2/client"
import { OpenNovel } from "@opennovel-ai/client"
import { Binary } from "@opennovel-ai/core/util/binary"
import { resolveSessionRoute } from "./session-route"
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

/** 构建目录级 novel API client（会话侧栏查询与统一打开动作共用） */
function makeNovelClient(conn: ServerConnection.Any) {
  const auth = conn.http.password
    ? {
        Authorization: `Basic ${authTokenFromCredentials({
          username: conn.http.username,
          password: conn.http.password,
        })}`,
      }
    : undefined
  return OpenNovel.make({ baseUrl: conn.http.url, headers: auth })
}

/**
 * 统一的会话打开动作。所有"打开会话"入口（工作台写作按钮、sessions 页最近列表、
 * 小说分组侧栏、会话内小说面板、命令面板）都必须经过这里：绑定会话路由到
 * `/:dir/novel/:novelID/session/:sessionID`（工作台写作视图，不注册会话标签），
 * 未绑定会话保持既有独立会话 tab 行为。
 */
export async function openSessionRouted(input: {
  conn: ServerConnection.Any
  /** 会话所属目录，决定绑定关系的查询范围 */
  directory: string
  sessionID: string
  navigate: (path: string) => void
  tabs: ReturnType<typeof useTabs>
  global: ReturnType<typeof useGlobal>
  /** 后台打开：仅对未绑定的自由会话生效（注册标签但不切换） */
  background?: boolean
}): Promise<void> {
  const ctx = input.global.ensureServerCtx(input.conn)
  ctx.projects.open(input.directory)
  const client = makeNovelClient(input.conn)
  const bindings = await client["server.novel"]
    ["session-bindings"]({
      location: { directory: input.directory },
    })
    .then((result) => result as readonly NovelSessionBinding[])
    .catch(() => undefined)
  const route = resolveSessionRoute({
    sessionID: input.sessionID,
    directory: input.directory,
    bindings,
  })
  if (route.kind === "novel") {
    input.navigate(`/${route.dir}/novel/${route.novelID}/session/${input.sessionID}`)
    return
  }
  if (input.background) {
    input.tabs.addSessionTab({ server: ServerConnection.key(input.conn), sessionId: input.sessionID })
    return
  }
  ctx.projects.touch(input.directory)
  void startTransition(() => {
    const tab = input.tabs.addSessionTab({
      server: ServerConnection.key(input.conn),
      sessionId: input.sessionID,
    })
    input.tabs.select(tab)
  })
}

/** 将绑定会话 tab 从标签栏移除——入口收敛前的持久化存量清洗；幂等，可多处调用 */
export function purgeBoundSessionTabs(input: {
  tabs: ReturnType<typeof useTabs>
  bindings: readonly NovelSessionBinding[]
}) {
  const boundIds = new Set(input.bindings.map((binding) => binding.sessionID))
  for (const tab of input.tabs.store) {
    if (tab.type === "session" && boundIds.has(tab.sessionId)) {
      input.tabs.removeSessionTab({ server: tab.server, sessionId: tab.sessionId })
    }
  }
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
  const navigate = useNavigate()
  const language = useLanguage()
  const queryClient = useQueryClient()

  const novelClient = createMemo(() => {
    const conn = input.conn()
    if (!conn) return null
    return makeNovelClient(conn)
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

  // 清洗遗留 tab：入口收敛前注册的绑定会话 tab 跨重启持久化残留，绑定关系就绪后从标签栏移除
  // （spec「绑定会话不进入会话标签栏」的存量数据收尾；清洗逻辑与工作台共用，见 purgeBoundSessionTabs）
  createEffect(() => {
    if (!tabs.ready()) return
    const bindings = bindingsQuery.data
    if (!bindings) return
    purgeBoundSessionTabs({ tabs, bindings })
  })

  const loading = createMemo(() => novelsQuery.isLoading || bindingsQuery.isLoading)

  function refresh() {
    const directory = input.directory()
    void queryClient.invalidateQueries({ queryKey: ["sessions-novel-bindings", input.server(), directory] })
    void queryClient.invalidateQueries({ queryKey: ["sessions-novel-sessions", input.server(), directory] })
  }

  // 统一打开动作：绑定会话进书的工作台，未绑定会话走独立 tab（见 openSessionRouted）
  function openSessionById(sessionID: string) {
    const conn = input.conn()
    const directory = input.directory()
    if (!conn || !directory) return
    void openSessionRouted({ conn, directory, sessionID, navigate, tabs, global })
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
  // 导出会话完整内容为 JSON（调试用）
  async function exportSession(session: Session) {
    const conn = input.conn()
    if (!conn) return
    const ctx = global.ensureServerCtx(conn)
    const client = ctx.sdk.client
    const [info, messages] = await Promise.all([
      client.session.get({ sessionID: session.id }).then((r) => r.data),
      client.session.messages({ sessionID: session.id }).then((r) => r.data),
    ]).catch(() => [undefined, undefined])
    if (!info || !messages) {
      showToast({ title: "导出会话失败", description: "无法从服务器获取会话数据", variant: "error" })
      return
    }
    const payload = { exported_at: new Date().toISOString(), info, messages }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `session-${session.id}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast({ title: "已导出会话 JSON", variant: "success" })
  }

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
    exportSession,
  }
}
