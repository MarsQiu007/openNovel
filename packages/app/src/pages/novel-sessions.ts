/**
 * 书籍会话数据逻辑（入口收敛后：统一打开动作、级联归档、导出会话）。
 *
 * 负责：novel API client 构建、按会话 ID 打开会话（绑定进书内工作台、未绑定走降级）、
 * 会话级联归档与完整 JSON 导出。会话列表查询与展示由书内切换器组件自行承担。
 */
import type { Session } from "@opennovel-ai/sdk/v2/client"
import { OpenNovel } from "@opennovel-ai/client"
import { resolveSessionRoute } from "./session-route"
import { sessionHref } from "@/utils/session-route"
import { ServerConnection } from "@/context/server"
import { useGlobal } from "@/context/global"
import { authTokenFromCredentials } from "@/utils/server"
import { archiveHomeSession } from "./home-session-archive"
import { showToast } from "@/utils/toast"
import { collectDescendants } from "@/utils/session-descendants"
import type { DirectorySDK } from "@/context/sdk"
import type { NovelSessionBinding } from "@/context/novel-queries"

export type { NovelSessionBinding } from "@/context/novel-queries"

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
 * `/:dir/novel/:novelID/session/:sessionID`（工作台写作视图）；未绑定会话直接进入
 * 会话路由——自由会话不注册标签，切换经由会话页面完成（spec「会话退出标签体系」）。
 */
export async function openSessionRouted(input: {
  conn: ServerConnection.Any
  /** 会话所属目录，决定绑定关系的查询范围 */
  directory: string
  sessionID: string
  navigate: (path: string) => void
  global: ReturnType<typeof useGlobal>
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
  ctx.projects.touch(input.directory)
  input.navigate(sessionHref(ServerConnection.key(input.conn), input.sessionID))
}

/**
 * 级联归档主会话及其全部子代理会话（侧边栏归档、删除书籍共用）。
 */
export async function archiveSessionCascade(input: {
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
      session: target,
      update: input.update,
      remove: () => input.remove(target),
      onError: input.onError,
    })
  }
}

/**
 * 导出完整会话（含每条消息的工具调用参数与结果）为 JSON 文件，供问题排查时交给开发者分析。
 * 调用方提供 directory 作用域的 SDK client（如书内切换器、遗留侧栏项）。
 */
export async function exportSessionJson(input: {
  session: Session
  client: DirectorySDK["client"]
}): Promise<void> {
  const [info, messages] = await Promise.all([
    input.client.session.get({ sessionID: input.session.id }).then((r) => r.data),
    input.client.session.messages({ sessionID: input.session.id }).then((r) => r.data),
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
  a.download = `session-${input.session.id}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast({ title: "已导出会话 JSON", variant: "success" })
}
