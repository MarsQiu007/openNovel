/**
 * 书内会话切换器（对话面板顶部常驻一条）：
 * 当前会话标题 + 下拉列出该书全部未归档绑定会话（子代理按父会话嵌套收纳，
 * 默认折叠，展开控件在子代理存在时显示）+ 新建轻会话入口。
 * 切换即更新工作台路由 session/:id 段——params.id 是当前会话的唯一事实来源；
 * 无论是否存在绑定会话都渲染（0 会话时下拉触发器显示占位并禁用，"+"号新建
 * 入口始终可用，空态引导见 workspace-frame）。
 */
import { For, Show, createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useQueryClient } from "@tanstack/solid-query"
import type { Session } from "@opennovel-ai/sdk/v2/client"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Icon } from "@opennovel-ai/ui/v2/icon"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opennovel-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opennovel-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  useBindSession,
  useBoundNovelSessions,
  novelKeys,
  type NovelSessionBinding,
  type NovelSessionOption,
} from "@/context/novel-queries"
import { archiveSessionCascade, exportSessionJson } from "@/pages/novel-sessions"
import { useConfirmDelete } from "./confirm-dialog"
import { collectDescendants } from "@/utils/session-descendants"
import { errorMessage } from "@/pages/layout/helpers"
import { sessionSwitcherTrigger } from "./workspace-data"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"

export function NovelSessionSwitcher(props: { dir: string; novelID: string }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const params = useParams()
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const confirm = useConfirmDelete()
  const bindSession = useBindSession()
  const sessions = useBoundNovelSessions(() => props.novelID)
  const [creating, setCreating] = createSignal(false)
  // 子代理收纳展开态：仅记录用户手动展开/收起；当前打开的子会话所在父会话始终展开（见下）
  const [childrenExpanded, setChildrenExpanded] = createSignal<Record<string, boolean>>({})

  const trigger = () =>
    sessionSwitcherTrigger({
      status: sessions.isPending ? "pending" : sessions.isError ? "error" : "ready",
      // 拍平嵌套列表供当前会话命中查找：子会话是合法打开目标（params.id），
      // 顶层查找落空会把触发器标签错误回退成面板名
      sessions: (sessions.data ?? []).flatMap((option) => [option, ...option.children]),
      paramsID: params.id,
      fallbackLabel: language.t("novel.workspace.chat"),
      emptyLabel: language.t("novel.workspace.sessionEmpty"),
      pendingLabel: language.t("common.loading"),
      // 失败占位沿用书内面板内联中文先例（panel-ai-artifacts），不新增 i18n key
      errorLabel: "会话列表加载失败",
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

  // 归档（承接已退役列表页的会话管理动作）：级联目标含全部未归档子代理；
  // 归档的是当前打开会话（或其子代理）时，刷新列表移除归档项后切到最近剩余会话
  // （无剩余回工作台空态），避免工作台自动回跳读到旧缓存抢跳到已归档会话。
  function archiveSession(input: { sessionID: string; title: string }) {
    const sdkCtx = sdk()
    const list = toSwitcherSessionList(props.novelID, sessions.data ?? [], sdkCtx.directory)
    const session = list.find((candidate) => candidate.id === input.sessionID)
    if (!session) return
    const unarchivedChildren = collectDescendants(session.id, list).filter((item) => !item.time.archived)
    const confirmAndArchive = () =>
      void archiveSessionCascade({
        session,
        sessions: list,
        update: (value) => sdkCtx.client.session.update(value),
        remove: () => {},
        onError: (error) =>
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(error, language.t("common.requestFailed")),
          }),
      }).then(async () => {
        const refreshed = await queryClient.fetchQuery<NovelSessionOption[]>({
          queryKey: novelKeys["bound-sessions"](sdkCtx.directory, props.novelID),
        })
        // 工作台的未选中自动回跳读缓存列表：移除归档项后再导航，避免其在刷新落地前
        // 按旧列表抢跳到已归档会话（当前会话被归档时表现为在书内"原地不动"）
        const archivedIDs = new Set([session.id, ...unarchivedChildren.map((item) => item.id)])
        const remaining = refreshed.filter((option) => !archivedIDs.has(option.sessionID))
        queryClient.setQueryData(novelKeys["bound-sessions"](sdkCtx.directory, props.novelID), remaining)
        if (params.id !== session.id && !unarchivedChildren.some((item) => item.id === params.id)) return
        navigate(`/${props.dir}/novel/${props.novelID}/session/${remaining[0]?.sessionID ?? ""}`)
      })
    if (unarchivedChildren.length > 0) {
      confirm({
        title: language.t("home.sessions.sidebar.archiveTitle"),
        message: language.t("home.sessions.sidebar.archiveWithChildren", { count: unarchivedChildren.length }),
        confirmLabel: language.t("common.archive"),
        onConfirm: confirmAndArchive,
      })
      return
    }
    confirmAndArchive()
  }

  function exportSession(input: { sessionID: string; title: string }) {
    const sdkCtx = sdk()
    const session = toSwitcherSessionList(props.novelID, sessions.data ?? [], sdkCtx.directory).find(
      (candidate) => candidate.id === input.sessionID,
    )
    if (!session) return
    void exportSessionJson({ session, client: sdkCtx.client })
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
                      <SwitcherSessionEntry
                        option={option}
                        activeSessionID={params.id}
                        expanded={() => !!childrenExpanded()[option.sessionID]}
                        onToggleChildren={() =>
                          setChildrenExpanded((prev) => ({ ...prev, [option.sessionID]: !prev[option.sessionID] }))
                        }
                        actions={{ archive: archiveSession, export: exportSession }}
                      />
                    )}
                  </For>
                </MenuV2.RadioGroup>
              </MenuV2.Group>
            </MenuV2.Content>
          </MenuV2.Portal>
        </Show>
      </MenuV2>
      <Show when={trigger().showRetry}>
        <ButtonV2 size="small" variant="ghost-muted" onClick={() => void sessions.refetch()}>
          重试
        </ButtonV2>
      </Show>
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

/**
 * 切换器数据是 NovelSessionOption 投影，归档/导出接口按 SDK Session 形状取参：
 * 按「该书绑定关系 × 切换器列表」补出最小 Session 记录（title/time 供列表与回跳显示，
 * parentID 供级联归档收集子代理）。
 */
function toSwitcherSessionList(
  novelID: string,
  options: readonly NovelSessionOption[],
  directory: string,
): Session[] {
  const bindings: NovelSessionBinding[] = [
    ...options.map((option) => ({ sessionID: option.sessionID, novelID, novelTitle: "" })),
    ...options.flatMap((option) =>
      option.children.map((child) => ({ sessionID: child.sessionID, novelID, novelTitle: "" })),
    ),
  ]
  const session = (option: { sessionID: string; title: string; updatedAt: number }, parentID?: string) => ({
    id: option.sessionID,
    slug: option.sessionID,
    projectID: "",
    directory,
    title: option.title,
    version: "0",
    time: { created: option.updatedAt, updated: option.updatedAt },
    bindings,
    ...(parentID ? { parentID } : {}),
  })
  return options.flatMap((option) => [
    session(option),
    ...option.children.map((child) => session(child, option.sessionID)),
  ])
}

/**
 * 切换器下拉的单个主会话条目：展开控件（有子代理时）+ 主会话选择项 + 行内动作菜单；
 * 展开后在主会话下方渲染子代理子项（缩进 + 分支图标 + 斜体弱化，与主会话视觉区分）。
 * 当前打开的是子会话时其父会话始终展开，保证活动项可见（与首页侧栏同规则）。
 * 动作菜单承接已退役列表页的会话管理动作：归档（子代理级联）与导出会话 JSON；
 * hover/focus 显现，键盘可 Tab 到达（拖动条目的选中语义不受影响）。
 */
type SwitcherSessionActions = {
  archive: (input: { sessionID: string; title: string }) => void
  export: (input: { sessionID: string; title: string }) => void
}

function SwitcherSessionEntry(props: {
  option: NovelSessionOption
  activeSessionID: string | undefined
  expanded: () => boolean
  onToggleChildren: () => void
  actions: SwitcherSessionActions
}) {
  const language = useLanguage()
  const showChildren = () =>
    props.expanded() || props.option.children.some((child) => child.sessionID === props.activeSessionID)
  return (
    <>
      <div class="group/switcher-row flex items-center">
        <Show
          when={props.option.children.length > 0}
          fallback={<span class="w-5 shrink-0" aria-hidden="true" />}
        >
          <button
            type="button"
            data-action="novel-switcher-toggle-children"
            class="flex h-7 w-5 shrink-0 items-center justify-center text-v2-icon-icon-muted"
            aria-label={language.t("home.sessions.sidebar.subagent")}
            onClick={(event) => {
              event.stopPropagation()
              props.onToggleChildren()
            }}
          >
            <Icon
              name="chevron-down"
              size="small"
              class={showChildren() ? "transition-transform" : "-rotate-90 transition-transform"}
            />
          </button>
        </Show>
        <MenuV2.RadioItem value={props.option.sessionID} class="min-w-0 flex-1">
          <span class="truncate">{sessionTitle(props.option.title) ?? props.option.title}</span>
        </MenuV2.RadioItem>
        <SwitcherSessionActionsMenu title={props.option.title} actions={props.actions} sessionID={props.option.sessionID} />
      </div>
      <Show when={showChildren()}>
        <For each={props.option.children}>
          {(child) => (
            <div class="group/switcher-row flex items-center">
              <MenuV2.RadioItem value={child.sessionID} class="min-w-0 flex-1 pl-10">
                <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                <span class="truncate italic text-v2-text-text-faint [font-weight:440]">
                  {sessionTitle(child.title) ?? child.title}
                </span>
              </MenuV2.RadioItem>
              <SwitcherSessionActionsMenu title={child.title} actions={props.actions} sessionID={child.sessionID} />
            </div>
          )}
        </For>
      </Show>
    </>
  )
}

/** 行内会话动作菜单：hover/focus 显现，提供归档（子代理级联）与导出会话 JSON */
function SwitcherSessionActionsMenu(props: {
  sessionID: string
  title: string
  actions: SwitcherSessionActions
}) {
  const language = useLanguage()
  return (
    <MenuV2 gutter={4} placement="bottom-end" modal={false}>
      <MenuV2.Trigger
        as={IconButtonV2}
        data-action="novel-switcher-actions"
        variant="ghost-muted"
        size="small"
        class="mr-1 shrink-0 opacity-0 transition-opacity group-hover/switcher-row:opacity-100 has-[[data-expanded]]:opacity-100 focus-visible:opacity-100"
        icon={<Icon name="outline-dots" />}
        aria-label={language.t("common.moreOptions")}
      />
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.Item
            data-action="novel-switcher-archive"
            onSelect={() => props.actions.archive({ sessionID: props.sessionID, title: props.title })}
          >
            {language.t("common.archive")}
          </MenuV2.Item>
          <MenuV2.Item
            data-action="novel-switcher-export"
            onSelect={() => props.actions.export({ sessionID: props.sessionID, title: props.title })}
          >
            导出会话（JSON）
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
