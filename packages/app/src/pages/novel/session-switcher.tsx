/**
 * 书内会话切换器（对话面板顶部常驻一条）：
 * 当前会话标题 + 下拉列出该书全部未归档绑定会话 + 新建轻会话入口。
 * 切换即更新工作台路由 session/:id 段——params.id 是当前会话的唯一事实来源，
 * 切换器自身不持有任何会话状态；无论是否存在绑定会话都渲染（0 会话时下拉
 * 触发器显示占位并禁用，"+"号新建入口始终可用，空态引导见 workspace-frame）。
 */
import { For, Show, createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { Icon } from "@opennovel-ai/ui/v2/icon"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opennovel-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opennovel-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useBindSession, useBoundNovelSessions } from "@/context/novel-queries"
import { sessionSwitcherTrigger } from "./workspace-data"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"

export function NovelSessionSwitcher(props: { dir: string; novelID: string }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const params = useParams()
  const sdk = useSDK()
  const bindSession = useBindSession()
  const sessions = useBoundNovelSessions(() => props.novelID)
  const [creating, setCreating] = createSignal(false)

  const trigger = () =>
    sessionSwitcherTrigger({
      sessions: sessions.data ?? [],
      paramsID: params.id,
      fallbackLabel: language.t("novel.workspace.chat"),
      emptyLabel: language.t("novel.workspace.sessionEmpty"),
    })

  function switchTo(sessionID: string) {
    navigate(`/${props.dir}/novel/${props.novelID}/session/${sessionID}`)
  }

  // 新建轻会话：创建 + 绑定 + 切入，不发送任何自动 prompt（与主线写作流职责分离）。
  // 不传标题——服务端落 "New session - {时间戳}" 默认标题，首条真实消息发出后由
  // 服务端 ensureTitle（小模型）自动命名（与通用 agent 工具一致：首次对话后才算真正建会话）
  async function createLightSession() {
    if (creating()) return
    setCreating(true)
    try {
      const result = await sdk().client.session.create({ directory: sdk().directory })
      if (!result.data) throw new Error("No session data returned")
      await bindSession.mutateAsync({ novelID: props.novelID, sessionID: result.data.id })
      switchTo(result.data.id)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("novel.error.createFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div class="flex items-center gap-0.5 px-2 py-1 border-b border-v2-border-border-base shrink-0">
      <MenuV2 gutter={4} placement="bottom-start" modal={false}>
        <MenuV2.Trigger
          class="flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-v2-text-text-secondary hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-primary disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
          aria-label={language.t("novel.workspace.sessionSwitcher")}
          disabled={trigger().disabled}
        >
          <span class="truncate">{trigger().label}</span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
        </MenuV2.Trigger>
        <Show when={(sessions.data?.length ?? 0) > 0}>
          <MenuV2.Portal>
            <MenuV2.Content class="min-w-48 max-w-72">
              <MenuV2.Group>
                <MenuV2.GroupLabel>{language.t("novel.workspace.sessionSwitcher")}</MenuV2.GroupLabel>
                <MenuV2.RadioGroup value={params.id} onChange={(value) => switchTo(value)}>
                  <For each={sessions.data ?? []}>
                    {(option) => (
                      <MenuV2.RadioItem value={option.sessionID}>
                        <span class="truncate">{sessionTitle(option.title) ?? option.title}</span>
                      </MenuV2.RadioItem>
                    )}
                  </For>
                </MenuV2.RadioGroup>
              </MenuV2.Group>
            </MenuV2.Content>
          </MenuV2.Portal>
        </Show>
      </MenuV2>
      <TooltipV2 placement="bottom" value={language.t("novel.workspace.sessionNew")}>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="plus" />}
          disabled={creating()}
          aria-label={language.t("novel.workspace.sessionNew")}
          onClick={() => void createLightSession()}
        />
      </TooltipV2>
    </div>
  )
}
