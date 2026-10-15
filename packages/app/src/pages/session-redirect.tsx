/**
 * 独立会话路由的重定向宿主（spec「会话归属书籍」+ subagent-session-binding）：
 * 归属解析按「自身绑定行 → 沿父链最近绑定祖先 → 无归属」——自身未绑定但祖先
 * 命中的子代理会话 replace 进所属书籍工作台，整条链无归属的遗留会话降级书架
 * 并提示。目录来源由调用方给定（新布局经 lineage 解析，旧布局直接取路由段）；
 * 祖先链经 server sync lineage 落定后注入决策，链不可得（查询失败、缓存缺失）
 * 时按仅自身绑定判定；绑定查询失败同样按无绑定降级，保证路由始终有去处。
 */
import { createEffect, createResource } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { createQuery } from "@tanstack/solid-query"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { novelClientFor, type NovelSessionBinding } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { resolveSessionRoute } from "./session-route"

export function SessionRedirect(props: { sessionID: string; directory: () => string | undefined }) {
  const navigate = useNavigate()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()

  const bindings = createQuery(() => ({
    queryKey: ["session-redirect", "bindings", props.directory()],
    queryFn: async () => {
      const dir = props.directory()
      if (!dir) return undefined
      return novelClientFor(serverSDK())["server.novel"]["session-bindings"]({
        location: { directory: dir },
      }) as Promise<readonly NovelSessionBinding[]>
    },
    enabled: !!props.directory(),
  }))

  // 目标会话的完整父链（自近到远，含自身）：未绑定子代理经最近绑定祖先兜底进书。
  // resolve 缓存优先；查询失败（链断、会话缺失、parentID 环）统一降级为仅自身判定。
  const [lineage] = createResource(
    () => props.sessionID,
    (sessionID) =>
      serverSync()
        .session.lineage.resolve(sessionID)
        .then((resolved) => resolved.chain)
        .catch(() => undefined),
  )

  createEffect(() => {
    const dir = props.directory()
    if (!dir || bindings.isPending || lineage.loading) return
    const route = resolveSessionRoute({
      sessionID: props.sessionID,
      directory: dir,
      bindings: bindings.data,
      lineage: lineage(),
    })
    if (route.kind === "novel") {
      navigate(`/${route.dir}/novel/${route.novelID}/session/${props.sessionID}`, { replace: true })
      return
    }
    // 内联中文沿用书内面板罕见错误路径先例（session-switcher 的 errorLabel）
    showToast({
      title: "会话未绑定书籍",
      description: "自由会话已下线，请在书籍内开始对话",
    })
    navigate("/", { replace: true })
  })

  return null
}