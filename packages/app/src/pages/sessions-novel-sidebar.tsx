import type { Session } from "@opennovel-ai/sdk/v2/client"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { useNavigate } from "@solidjs/router"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ScrollView } from "@opennovel-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opennovel-ai/ui/v2/icon"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opennovel-ai/ui/v2/tooltip-v2"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { errorMessage } from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"
import { collectDescendants } from "@/utils/session-descendants"
import { useConfirmDelete } from "@/pages/novel/confirm-dialog"
import { HOME_ROW, HOME_SECTION_LABEL } from "./sessions"
import type { NovelSessionBinding, NovelSessionNovel } from "./novel-sessions"

export type NovelSidebarNovel = NovelSessionNovel
export type NovelSidebarBinding = NovelSessionBinding

type NovelGroup = {
  novel: NovelSessionNovel
  sessions: Session[]
}

function sessionTime(session: Session) {
  return session.time.updated ?? session.time.created
}

function relativeTime(session: Session) {
  return DateTime.fromMillis(sessionTime(session)).toRelative() ?? ""
}

export type NovelSessionGroupListProps = {
  directory: string | undefined
  novels: readonly NovelSessionNovel[]
  bindings: readonly NovelSessionBinding[]
  sessions: readonly Session[]
  loading: boolean
  /** 当前正在查看的会话（聊天页侧边栏用于高亮） */
  activeSessionID?: string
  openSessionById: (sessionID: string) => void
  createNovelSession: (novelID: string, title: string) => Promise<void>
  archiveSession: (session: Session) => Promise<void>
}

/**
 * 按书籍分组的会话列表（会话页侧边栏 & 聊天页侧边栏共用）。
 *
 * 每本书保留一个主会话（点击书名直接打开最新的），展开可查看历史会话；
 * 新对话统一从 + 按钮创建并绑定到对应书籍，避免在书籍工作区反复创建重复会话。
 */
export function NovelSessionGroupList(props: NovelSessionGroupListProps) {
  const language = useLanguage()
  const navigate = useNavigate()
  const confirmDelete = useConfirmDelete()
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [creating, setCreating] = createSignal<string | null>(null)

  const groups = createMemo<NovelGroup[]>(() => {
    const sessionsById = new Map<string, Session>()
    for (const session of props.sessions) {
      // 子代理会话（带 parentID）不单独展示，随主代理会话级联管理，与主列表行为一致
      if (session.time.archived || session.parentID) continue
      sessionsById.set(session.id, session)
    }
    const byNovel = new Map<string, string[]>()
    for (const binding of props.bindings) {
      const list = byNovel.get(binding.novelID) ?? []
      list.push(binding.sessionID)
      byNovel.set(binding.novelID, list)
    }
    return props.novels.map((novel) => ({
      novel,
      sessions: (byNovel.get(novel.id) ?? [])
        .flatMap((id) => {
          const session = sessionsById.get(id)
          return session ? [session] : []
        })
        .sort((a, b) => sessionTime(b) - sessionTime(a)),
    }))
  })

  const isExpanded = (novelID: string) => expanded[novelID] ?? true
  const toggle = (novelID: string) => setExpanded(novelID, !isExpanded(novelID))

  // 子代理会话（parentID 指向主会话）按父会话分组，嵌套展示在主会话下方；
  // 只收录直接子会话——写作流水线的子代理均直接挂在书籍主会话下
  const childrenByParent = createMemo(() => {
    const map = new Map<string, Session[]>()
    for (const session of props.sessions) {
      if (!session.parentID || session.time.archived) continue
      const list = map.get(session.parentID) ?? []
      list.push(session)
      map.set(session.parentID, list)
    }
    for (const list of map.values()) list.sort((a, b) => sessionTime(b) - sessionTime(a))
    return map
  })

  async function handleCreate(novel: NovelSessionNovel) {
    if (creating()) return
    setCreating(novel.id)
    try {
      await props.createNovelSession(novel.id, novel.title)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      })
    } finally {
      setCreating(null)
    }
  }

  function openMain(group: NovelGroup) {
    const main = group.sessions[0]
    if (main) {
      props.openSessionById(main.id)
      return
    }
    void handleCreate(group.novel)
  }

  function openNovel(novel: NovelSessionNovel) {
    if (!props.directory) return
    navigate(`/${base64Encode(props.directory)}/novel/${novel.id}`)
  }

  // 归档主会话时若存在子代理会话，先确认再级联归档
  function handleArchive(session: Session) {
    const childCount = collectDescendants(session.id, props.sessions).filter((s) => !s.time.archived).length
    if (childCount === 0) {
      void props.archiveSession(session)
      return
    }
    confirmDelete({
      title: language.t("home.sessions.sidebar.archiveTitle"),
      message: language.t("home.sessions.sidebar.archiveWithChildren", { count: childCount }),
      confirmLabel: language.t("common.archive"),
      onConfirm: () => props.archiveSession(session),
    })
  }

  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="flex items-center justify-center py-6 text-v2-text-text-muted">
          <Spinner class="size-4" />
        </div>
      }
    >
      <Show
        when={groups().length > 0}
        fallback={
          <div class="flex flex-col gap-1.5 px-3 pt-6 text-center">
            <span class="text-[13px] text-v2-text-text-base [font-weight:530]">
              {language.t("home.sessions.sidebar.empty")}
            </span>
            <p class="text-[13px] text-v2-text-text-muted [font-weight:440]">
              {language.t("home.sessions.sidebar.empty.description")}
            </p>
          </div>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div class="flex min-w-0 flex-col">
              <div class="group/novel relative flex h-9 min-w-0 items-center rounded-[6px] transition-colors hover:bg-v2-overlay-simple-overlay-hover">
                <button
                  type="button"
                  class="flex h-full w-6 shrink-0 items-center justify-center text-v2-icon-icon-muted"
                  aria-label={language.t("home.sessions.sidebar.books")}
                  onClick={() => toggle(group.novel.id)}
                >
                  <IconV2
                    name="chevron-down"
                    size="small"
                    class={isExpanded(group.novel.id) ? "transition-transform" : "-rotate-90 transition-transform"}
                  />
                </button>
                <button
                  type="button"
                  data-component="novel-sidebar-group"
                  class="flex h-full min-w-0 flex-1 items-center gap-2 pr-16 text-left"
                  onClick={() => openMain(group)}
                >
                  <Show
                    when={creating() === group.novel.id}
                    fallback={<IconV2 name="book" size="small" class="shrink-0 text-v2-icon-icon-muted" />}
                  >
                    <Spinner class="size-3 shrink-0 text-v2-text-text-muted" />
                  </Show>
                  <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:530]">
                    {group.novel.title}
                  </span>
                  <Show when={group.sessions.length > 0}>
                    <span class="shrink-0 text-[11px] text-v2-text-text-faint">{group.sessions.length}</span>
                  </Show>
                </button>
                <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/novel:opacity-100 focus-within:opacity-100">
                  <TooltipV2
                    class="flex shrink-0 items-center"
                    placement="bottom"
                    value={language.t("home.sessions.sidebar.newChat")}
                  >
                    <IconButtonV2
                      data-action="novel-sidebar-new-chat"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="plus" />}
                      aria-label={language.t("home.sessions.sidebar.newChat")}
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleCreate(group.novel)
                      }}
                    />
                  </TooltipV2>
                  <TooltipV2
                    class="flex shrink-0 items-center"
                    placement="bottom"
                    value={language.t("home.sessions.sidebar.openNovel")}
                  >
                    <IconButtonV2
                      data-action="novel-sidebar-open-novel"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="folder" />}
                      aria-label={language.t("home.sessions.sidebar.openNovel")}
                      onClick={(event) => {
                        event.stopPropagation()
                        openNovel(group.novel)
                      }}
                    />
                  </TooltipV2>
                </div>
              </div>
              <Show when={isExpanded(group.novel.id)}>
                <div class="flex min-w-0 flex-col gap-px">
                  <For each={group.sessions}>
                    {(session) => {
                      const active = () => props.activeSessionID === session.id
                      const children = () => childrenByParent().get(session.id) ?? []
                      return (
                        <>
                          <div
                            class="group/sidebar-session relative flex h-8 min-w-0 items-center rounded-[6px]"
                            classList={{ "bg-v2-overlay-simple-overlay-hover": active() }}
                          >
                            <button
                              type="button"
                              data-component="novel-sidebar-session"
                              class={`${HOME_ROW} h-8 min-w-0 flex-1 gap-2 py-1.5 pl-9 pr-8`}
                              onClick={() => props.openSessionById(session.id)}
                            >
                              <span
                                class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted [font-weight:440]"
                                classList={{ "text-v2-text-text-base [font-weight:530]": active() }}
                              >
                                {sessionTitle(session.title) || language.t("home.sessions.sidebar.untitled")}
                              </span>
                              <Show when={children().length > 0}>
                                <span class="flex shrink-0 items-center gap-0.5 text-[11px] text-v2-text-text-faint">
                                  <IconV2 name="branch" size="small" />
                                  {children().length}
                                </span>
                              </Show>
                              <span class="shrink-0 text-[11px] text-v2-text-text-faint">{relativeTime(session)}</span>
                            </button>
                            <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/sidebar-session:opacity-100 focus-within:opacity-100">
                              <TooltipV2
                                class="flex shrink-0 items-center"
                                placement="bottom"
                                value={language.t("common.archive")}
                              >
                                <IconButtonV2
                                  data-action="novel-sidebar-archive"
                                  variant="ghost-muted"
                                  size="small"
                                  icon={<IconV2 name="archive" />}
                                  aria-label={language.t("common.archive")}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleArchive(session)
                                  }}
                                />
                              </TooltipV2>
                            </div>
                          </div>
                          {/* 子代理会话：只读，随主会话级联归档，这里仅提供查看入口 */}
                          <For each={children()}>
                            {(child) => {
                              const childActive = () => props.activeSessionID === child.id
                              return (
                                <div
                                  class="relative flex h-8 min-w-0 items-center rounded-[6px]"
                                  classList={{ "bg-v2-overlay-simple-overlay-hover": childActive() }}
                                >
                                  <button
                                    type="button"
                                    data-component="novel-sidebar-sub-session"
                                    aria-label={language.t("home.sessions.sidebar.subagent")}
                                    class={`${HOME_ROW} h-8 min-w-0 flex-1 gap-2 py-1.5 pl-12 pr-2`}
                                    onClick={() => props.openSessionById(child.id)}
                                  >
                                    <IconV2 name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                                    <span
                                      class="min-w-0 flex-1 truncate text-[12px] italic text-v2-text-text-faint [font-weight:440]"
                                      classList={{ "text-v2-text-text-muted": childActive() }}
                                    >
                                      {sessionTitle(child.title) || language.t("home.sessions.sidebar.subagent")}
                                    </span>
                                    <span class="shrink-0 text-[11px] text-v2-text-text-faint">
                                      {relativeTime(child)}
                                    </span>
                                  </button>
                                </div>
                              )
                            }}
                          </For>
                        </>
                      )
                    }}
                  </For>
                  <Show when={group.sessions.length === 0}>
                    <div class="py-1.5 pl-9 pr-2 text-[12px] italic text-v2-text-text-faint">
                      {language.t("home.sessions.sidebar.noChats")}
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </Show>
  )
}

/**
 * 会话页左侧「书籍对话」侧边栏。
 */
export function SessionsNovelSidebar(props: Omit<NovelSessionGroupListProps, "activeSessionID">) {
  const language = useLanguage()
  return (
    <aside
      class="hidden lg:flex min-h-0 min-w-0 flex-col lg:sticky lg:top-0 lg:h-[100cqh] lg:self-start"
      aria-label={language.t("home.sessions.sidebar.books")}
    >
      <div class="flex h-9 shrink-0 items-center justify-between pl-3 pr-2 pt-12 pb-3">
        <span class={HOME_SECTION_LABEL}>{language.t("home.sessions.sidebar.books")}</span>
      </div>
      <ScrollView class="min-h-0 flex-1">
        <div class="flex min-w-0 flex-col gap-px px-1.5 pb-16">
          <NovelSessionGroupList {...props} />
        </div>
      </ScrollView>
    </aside>
  )
}
