/**
 * 独立会话路由的重定向宿主（spec「会话归属书籍」）：绑定会话 replace 进所属书籍
 * 工作台，未绑定遗留会话降级书架并提示。目录来源由调用方给定（新布局经 lineage
 * 解析，旧布局直接取路由段），绑定查询失败按未绑定降级，保证路由始终有去处。
 */
import { createEffect } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { novelClientFor, type NovelSessionBinding } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { resolveSessionRoute } from "./session-route"

export function SessionRedirect(props: { sessionID: string; directory: () => string | undefined }) {
  const navigate = useNavigate()
  const language = useLanguage()
  const serverSDK = useServerSDK()

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

  createEffect(() => {
    const dir = props.directory()
    if (!dir || bindings.isPending) return
    const route = resolveSessionRoute({ sessionID: props.sessionID, directory: dir, bindings: bindings.data })
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
