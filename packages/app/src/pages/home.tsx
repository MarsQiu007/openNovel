import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  startTransition,
  Switch,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opennovel-ai/ui/button"
import { Logo } from "@opennovel-ai/ui/logo"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ScrollView } from "@opennovel-ai/ui/scroll-view"
import { ProjectAvatar } from "@opennovel-ai/ui/v2/project-avatar-v2"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opennovel-ai/ui/v2/icon"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opennovel-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opennovel-ai/ui/v2/tooltip-v2"
import { getProjectAvatarVariant, useLayout, type HomeProjectSelection, type LocalProject } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { Icon } from "@opennovel-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useSettingsCommand } from "@/components/settings-dialog"
import { DialogSelectServer, useServerManagementController } from "@/components/dialog-select-server"
import { DialogServerV2 } from "@/components/settings-v2/dialog-server-v2"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { containHomeWheel } from "./sessions"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import {
  closeHomeProject,
  displayName,
  errorMessage,
  getProjectAvatarSource,
  homeProjectDirectories,
  toggleHomeProjectSelection,
} from "@/pages/layout/helpers"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { pathKey } from "@/utils/path-key"
import { useGlobal } from "@/context/global"
import { useCommand } from "@/context/command"
import { ServerRowMenu } from "@/components/server/server-row-menu"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { type ServerHealth } from "@/utils/server-health"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { fileManagerApp } from "@/utils/file-manager"
import { useNovels, useDeleteNovel, useNovelClient } from "@/context/novel-queries"
import { useQueryClient } from "@tanstack/solid-query"
import { Binary } from "@opennovel-ai/core/util/binary"
import { archiveSessionCascade, type NovelSessionBinding } from "./novel-sessions"

const HOME_ROW_LAYOUT =
  "flex min-w-0 w-full shrink-0 cursor-default items-center rounded-[6px] bg-transparent text-left transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out focus-visible:outline-none"
const HOME_PROJECT_NAV_LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
const HOME_PROJECT_NAV_ROW = `${HOME_ROW_LAYOUT} h-7 gap-2 px-1.5 [font-weight:440] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base hover:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base data-[selected]:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] data-[selected]:hover:bg-v2-background-bg-layer-03 focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]`
let pendingHomeNavigation: { server: ServerConnection.Key; href: string } | undefined

export function NewHome() {
  const sync = useServerSync()
  const layout = useLayout()
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const command = useCommand()
  const notification = useNotification()
  const openSettings = useSettingsCommand()
  const selection = layout.home.selection

  const focusedServer = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === selection().server) ?? server.current,
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())
  const recentlyClosed = createMemo(
    () => focusedServerCtx()?.projects.recentlyClosed() ?? layout.projects.recentlyClosed(),
  )
  const homedir = createMemo(() => focusedSync().data.path.home ?? "")
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))
  const newSessionProject = createMemo(
    () =>
      selectedProject() ??
      projects().find((project) => project.worktree === focusedServerCtx()?.projects.last()) ??
      projects()[0],
  )
  // The bookshelf is the landing view, so it must resolve a directory even when no
  // project is selected: selected project > last used > first project > home dir.
  const bookshelfDirectory = createMemo(
    () => selection().directory ?? focusedServerCtx()?.projects.last() ?? projects()[0]?.worktree ?? homedir(),
  )
  const novelsQuery = useNovels(bookshelfDirectory)
  const novels = () => novelsQuery.data ?? []

  const GENRES = ["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"] as const

  const [searchQuery, setSearchQuery] = createSignal("")
  const [selectedGenre, setSelectedGenre] = createSignal("")
  const [sortOrder, setSortOrder] = createSignal<"newest" | "oldest" | "title">("newest")
  const [deletingNovelId, setDeletingNovelId] = createSignal<string | null>(null)

  const deleteNovel = useDeleteNovel()
  const novelClient = useNovelClient()
  const queryClient = useQueryClient()

  // 删除书籍并级联归档其绑定的会话（含子代理会话），避免残留为「未绑定书籍的对话」
  async function handleDeleteNovel(novelID: string) {
    const directory = bookshelfDirectory()
    const conn = focusedServer()
    // 绑定关系随书籍删除级联清除，必须在删除前取出
    let boundIds: string[] = []
    try {
      const bindings = (await novelClient()["server.novel"]["session-bindings"]({
        location: { directory },
      })) as readonly NovelSessionBinding[]
      boundIds = bindings.filter((b) => b.novelID === novelID).map((b) => b.sessionID)
    } catch {
      // 绑定查询失败不阻塞删除，相关会话会残留为未绑定对话
    }
    await deleteNovel.mutateAsync({ novelID, directory })
    setDeletingNovelId(null)
    if (!conn || boundIds.length === 0) return
    const ctx = global.ensureServerCtx(conn)
    const res = await ctx.sdk.client.session.list({ directory }).catch(() => undefined)
    const sessions = res?.data ?? []
    const [, setStore] = ctx.sync.child(directory)
    for (const sessionID of boundIds) {
      const session = sessions.find((s) => s.id === sessionID)
      if (!session || session.time.archived) continue
      await archiveSessionCascade({
        server: ServerConnection.key(conn),
        session,
        sessions,
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
    }
    void queryClient.invalidateQueries({ queryKey: ["sessions-novel-bindings"] })
    void queryClient.invalidateQueries({ queryKey: ["sessions-novel-sessions"] })
  }

  const filteredNovels = createMemo(() => {
    let result = novels()
    const query = searchQuery().trim().toLowerCase()
    if (query) {
      result = result.filter(
        (novel) => novel.title.toLowerCase().includes(query) || novel.synopsis.toLowerCase().includes(query),
      )
    }
    const genre = selectedGenre()
    if (genre) {
      result = result.filter((novel) => novel.genre === genre)
    }
    const sort = sortOrder()
    if (sort === "newest") {
      result = [...result].sort((a, b) => b.createdAt - a.createdAt)
    } else if (sort === "oldest") {
      result = [...result].sort((a, b) => a.createdAt - b.createdAt)
    } else if (sort === "title") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title))
    }
    return result
  })

  function formatRelativeTime(timestamp: number, t: ReturnType<typeof useLanguage>["t"]) {
    const diffMs = Date.now() - timestamp
    const diffMinutes = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMinutes < 1) return t("common.time.justNow")
    if (diffHours < 1) return t("common.time.minutesAgo", { count: diffMinutes })
    if (diffDays < 1) return t("common.time.hoursAgo", { count: diffHours })
    if (diffDays < 30) return t("common.time.daysAgo", { count: diffDays })
    return new Date(timestamp).toISOString().slice(0, 10)
  }

  const directories = (project: LocalProject) => [project.worktree, ...(project.sandboxes ?? [])]

  command.register("home", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = focusedServer()
        if (!conn) return
        const ctx = global.ensureServerCtx(conn)
        const { DialogHomeCommandPaletteV2 } = await import("@/components/dialog-command-palette-v2")
        void dialog.show(() => (
          <DialogHomeCommandPaletteV2
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const sessionID = entry.sessionID
              const server = entry.server
              const directory = entry.project?.worktree ?? entry.directory
              ctx.projects.open(directory)
              ctx.projects.touch(directory)
              void startTransition(() => {
                const tab = tabs.addSessionTab({ server, sessionId: sessionID })
                tabs.select(tab)
              })
            }}
          />
        ))
      },
    },
  ])

  createEffect(() => {
    const list = global.servers.list()
    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })

  createEffect(() => {
    const pending = pendingHomeNavigation
    if (!pending || pending.server !== server.key) return
    pendingHomeNavigation = undefined
    navigate(pending.href)
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  function focusServer(conn: ServerConnection.Any) {
    setSelection({ server: ServerConnection.key(conn) })
  }

  function selectProject(conn: ServerConnection.Any, directory: string) {
    const key = ServerConnection.key(conn)
    if (global.servers.health[key]?.healthy === false) return
    if (
      !global
        .ensureServerCtx(conn)
        .projects.list()
        .some((project) => project.worktree === directory)
    )
      return
    setSelection(toggleHomeProjectSelection(selection(), key, directory))
  }

  function addProjects(conn: ServerConnection.Any, directories: string[]) {
    const directory = directories[0]
    if (!directory) return
    const ctx = global.ensureServerCtx(conn)
    directories.forEach(ctx.projects.open)
    ctx.projects.touch(directory)
    setSelection({ server: ServerConnection.key(conn), directory })
  }

  function openNewSession() {
    const conn = focusedServer()
    const project = newSessionProject()
    if (!conn || !project) return
    openProjectNewSession(conn, project.worktree)
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  function editProject(conn: ServerConnection.Any, project: LocalProject) {
    void import("@/components/dialog-edit-project-v2").then((x) => {
      void dialog.show(() => <x.DialogEditProjectV2 server={conn} project={project} />)
    })
  }

  function unseenCount(conn: ServerConnection.Any, project: LocalProject) {
    const state = notification.ensureServerState(ServerConnection.key(conn))
    return directories(project).reduce((total, directory) => total + state.project.unseenCount(directory), 0)
  }

  function clearNotifications(conn: ServerConnection.Any, project: LocalProject) {
    const state = notification.ensureServerState(ServerConnection.key(conn))
    directories(project)
      .filter((directory) => state.project.unseenCount(directory) > 0)
      .forEach((directory) => state.project.markViewed(directory))
  }

  function chooseProject(conn: ServerConnection.Any) {
    if (global.servers.health[ServerConnection.key(conn)]?.healthy === false) return

    function resolve(result: string | string[] | null) {
      addProjects(conn, homeProjectDirectories(result))
    }

    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: resolve,
    })
  }

  let viewport: HTMLDivElement | undefined

  return (
    <div class="rounded-[10px] shadow-[var(--v2-elevation-raised)] m-2 min-h-0 overflow-hidden bg-v2-background-bg-base self-stretch flex-1">
      <ScrollView
        class="h-full [container-type:size]"
        viewportRef={(el) => {
          viewport = el
        }}
        onWheel={(event) => {
          if (!viewport) return
          if (event.target instanceof Node && viewport.contains(event.target)) return
          containHomeWheel(event, viewport)
        }}
      >
        <div class="mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-3 lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6">
          <HomeProjectColumn
            projects={projects()}
            recentlyClosed={recentlyClosed()}
            homedir={homedir()}
            selected={selection()}
            focusServer={focusServer}
            selectProject={selectProject}
            openNewSession={openProjectNewSession}
            openRecentProject={(conn, directory) => addProjects(conn, [directory])}
            chooseProject={(conn) => void chooseProject(conn)}
            editProject={editProject}
            closeProject={(conn, directory) => {
              const next = closeHomeProject(
                selection(),
                ServerConnection.key(conn),
                global.ensureServerCtx(conn).projects,
                directory,
              )
              if (next) setSelection(next)
            }}
            clearNotifications={clearNotifications}
            unseenCount={unseenCount}
            openSettings={openSettings}
            openHelp={() => platform.openLink("https://opennovel.ai/desktop-feedback")}
            language={language}
            onWheel={(event) => {
              if (viewport) containHomeWheel(event, viewport)
            }}
          />

          <section class="min-h-0 min-w-0 flex-1 flex flex-col pt-6 lg:pt-12">
            <div class="flex items-center justify-between pb-4 pr-3">
              <div class="flex flex-col gap-0.5">
                <h1 class="text-v2-text-text-base text-[22px] [font-weight:590] leading-tight">
                  {language.t("novel.bookshelf.title")}
                </h1>
                <Show when={bookshelfDirectory()}>
                  <p class="text-v2-text-text-muted text-sm">{language.t("novel.bookshelf.subTitle")}</p>
                </Show>
              </div>
              <ButtonV2
                variant="ghost-muted"
                size="normal"
                icon="add"
                class="h-7 px-2 [font-weight:530]"
                disabled={!bookshelfDirectory()}
                onClick={() => navigate(`/${base64Encode(bookshelfDirectory())}/novel/wizard`)}
              >
                {language.t("novel.bookshelf.create")}
              </ButtonV2>
            </div>

            <div class="flex items-center gap-2 pb-4 pr-3">
              <input
                type="text"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                placeholder={language.t("common.search.placeholder")}
                class="flex-1 min-w-0 h-7 px-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-base text-sm placeholder-v2-text-text-faint outline-none focus:border-v2-border-border-focus transition-colors"
              />
              <select
                value={selectedGenre()}
                onChange={(e) => setSelectedGenre(e.currentTarget.value)}
                class="shrink-0 h-7 px-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-base text-sm outline-none focus:border-v2-border-border-focus transition-colors cursor-pointer"
              >
                <option value="">{language.t("novel.bookshelf.allGenres")}</option>
                <For each={GENRES}>
                  {(g) => <option value={g}>{language.t(`novel.wizard.genres.${g}` as any)}</option>}
                </For>
              </select>
              <select
                value={sortOrder()}
                onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest" | "title")}
                class="shrink-0 h-7 px-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-base text-sm outline-none focus:border-v2-border-border-focus transition-colors cursor-pointer"
              >
                <option value="newest">{language.t("novel.bookshelf.sort.newest")}</option>
                <option value="oldest">{language.t("novel.bookshelf.sort.oldest")}</option>
                <option value="title">{language.t("novel.bookshelf.sort.title")}</option>
              </select>
            </div>

            <div class="-mr-3 min-h-0 flex-1 overflow-y-auto pr-3 pb-16">
              <Show
                when={bookshelfDirectory()}
                fallback={
                  <div class="flex flex-col items-center justify-center gap-3 pt-20 text-center">
                    <IconV2 name="folder" size="large" class="text-v2-icon-icon-muted opacity-40" />
                    <div class="flex flex-col gap-1">
                      <div class="text-v2-text-text-muted [font-weight:530]">
                        {language.t("novel.bookshelf.emptyProject")}
                      </div>
                    </div>
                  </div>
                }
              >
                <Show
                  when={!novelsQuery.isLoading}
                  fallback={
                    <div class="flex items-center justify-center pt-16">
                      <Spinner class="size-5 text-v2-icon-icon-muted" />
                    </div>
                  }
                >
                  <Show
                    when={filteredNovels().length > 0}
                    fallback={
                      <div class="flex flex-col items-center justify-center gap-3 pt-20 text-center">
                        <IconV2 name="bookshelf" size="large" class="text-v2-icon-icon-muted opacity-40" />
                        <div class="flex flex-col gap-1">
                          <div class="text-v2-text-text-muted [font-weight:530]">
                            {language.t("novel.bookshelf.empty")}
                          </div>
                        </div>
                      </div>
                    }
                  >
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <For each={filteredNovels()}>
                        {(novel) => (
                          <div class="group relative flex cursor-pointer flex-col gap-3 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 transition-[background-color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-02 hover:[box-shadow:var(--v2-elevation-raised)]">
                            <div
                              onClick={() => navigate(`/${base64Encode(bookshelfDirectory())}/novel/${novel.id}`)}
                              class="contents"
                            >
                              <div class="flex h-28 items-center justify-center rounded-[4px] bg-v2-background-bg-layer-03">
                                <IconV2 name="book" size="large" class="text-v2-icon-icon-muted opacity-30" />
                              </div>
                              <div class="flex min-w-0 flex-col gap-1.5">
                                <div class="flex items-center gap-2">
                                  <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:590]">
                                    {novel.title}
                                  </span>
                                  <span class="shrink-0 rounded-[3px] bg-v2-background-bg-layer-03 px-1.5 py-0.5 text-[10px] leading-none text-v2-text-text-muted [font-weight:530]">
                                    {language.t(`novel.wizard.genres.${novel.genre}` as any)}
                                  </span>
                                </div>
                                <p class="line-clamp-2 text-xs leading-relaxed text-v2-text-text-muted">
                                  {novel.synopsis}
                                </p>
                                <div class="flex items-center gap-2 text-[11px] text-v2-text-text-faint">
                                  <span>{language.t(`novel.status.${novel.status}` as any)}</span>
                                  <span>·</span>
                                  <span>{formatRelativeTime(novel.createdAt, language.t)}</span>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeletingNovelId(novel.id)
                              }}
                              class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-[4px] text-v2-text-text-faint opacity-0 transition-opacity hover:bg-v2-background-bg-layer-03 hover:text-v2-icon-icon-critical group-hover:opacity-100"
                              type="button"
                              title={language.t("common.action.delete")}
                            >
                              <IconV2 name="delete" size="small" />
                            </button>
                            <Show when={deletingNovelId() === novel.id}>
                              <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[8px] bg-v2-background-bg-base/90 p-3 backdrop-blur-sm">
                                <p class="text-center text-sm text-v2-text-text-base [font-weight:530]">
                                  {language.t("novel.bookshelf.confirmDelete")}
                                </p>
                                <div class="flex items-center gap-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleDeleteNovel(novel.id)
                                    }}
                                    class="px-3 py-1.5 text-xs font-medium rounded bg-v2-icon-icon-critical text-white hover:opacity-90"
                                    type="button"
                                  >
                                    {language.t("common.action.confirm")}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setDeletingNovelId(null)
                                    }}
                                    class="px-3 py-1.5 text-xs font-medium rounded border border-v2-border-border-base text-v2-text-text-secondary hover:bg-v2-background-bg-layer-02"
                                    type="button"
                                  >
                                    {language.t("common.action.cancel")}
                                  </button>
                                </div>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </Show>
            </div>
          </section>
          <HomeUtilityNav
            class="flex lg:hidden"
            openSettings={openSettings}
            openHelp={() => platform.openLink("https://opennovel.ai/desktop-feedback")}
            language={language}
          />
        </div>
      </ScrollView>
    </div>
  )
}

function HomeProjectColumn(props: {
  projects: LocalProject[]
  recentlyClosed: LocalProject[]
  homedir: string
  selected: HomeProjectSelection
  focusServer: (server: ServerConnection.Any) => void
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  openRecentProject: (server: ServerConnection.Any, directory: string) => void
  chooseProject: (server: ServerConnection.Any) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  openSettings: () => void
  openHelp: () => void
  language: ReturnType<typeof useLanguage>
  onWheel: (event: WheelEvent) => void
}) {
  const global = useGlobal()
  const dialog = useDialog()
  const controller = useServerManagementController({ navigateOnAdd: false })
  const [_state, setState, _, ready] = persisted(
    Persist.global("home.servers", ["home.servers.v1"]),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (p) => p.then(() => _state),
    { initialValue: _state },
  )

  return (
    <aside
      class="mt-6 flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden lg:sticky lg:top-14 lg:mt-14 lg:h-[calc(100cqh-56px)] lg:self-start lg:pt-[52px]"
      aria-label={props.language.t("home.projects")}
      onWheel={(event) => {
        if (event.target === event.currentTarget) return
        props.onWheel(event)
      }}
    >
      <div class="flex h-7 min-w-0 shrink-0 items-center justify-between pl-1.5 pr-3">
        <div class="text-v2-text-text-muted [font-weight:530]">{props.language.t("home.projects")}</div>
        <Show
          when={global.servers.list().length === 1 && !(props.projects.length === 0 && props.recentlyClosed.length > 0)}
        >
          <TooltipV2 placement="bottom" value={props.language.t("home.project.add")}>
            <IconButtonV2
              data-action="home-add-project"
              variant="ghost-muted"
              size="large"
              class="titlebar-icon [&_[data-slot=icon-svg]]:text-v2-icon-icon-muted"
              icon={<IconV2 name="folder-add-left" />}
              disabled={global.servers.health[ServerConnection.key(global.servers.list()[0]!)]?.healthy === false}
              onClick={() => props.chooseProject(global.servers.list()[0]!)}
              aria-label={props.language.t("home.project.add")}
            />
          </TooltipV2>
        </Show>
      </div>
      <ScrollView data-slot="home-projects-scroll" class="min-h-0 min-w-0 shrink">
        <Show
          when={global.servers.list().length > 1}
          fallback={
            <div class="pr-3">
              <Show
                when={props.projects.length > 0}
                fallback={
                  <HomeProjectEmpty
                    server={global.servers.list()[0]!}
                    recentlyClosed={props.recentlyClosed}
                    homedir={props.homedir}
                    chooseProject={props.chooseProject}
                    openRecentProject={props.openRecentProject}
                    language={props.language}
                  />
                }
              >
                <HomeProjectList {...props} server={global.servers.list()[0]!} />
              </Show>
            </div>
          }
        >
          <div class="flex min-w-0 flex-col gap-4 pr-3">
            <For each={global.servers.list()}>
              {(item) => {
                const key = ServerConnection.key(item)
                const healthy = () => !!global.servers.health[key]?.healthy
                const serverCtx = global.ensureServerCtx(item)
                const projects = () => serverCtx.projects.list()
                const hasProjects = () => projects().length > 0
                const collapsed = () => !!state().collapsed[key]
                return (
                  <div class="flex min-w-0 flex-col gap-1">
                    <HomeServerRow
                      server={item}
                      selected={props.selected.server === key && !props.selected.directory}
                      collapsed={collapsed()}
                      health={global.servers.health[key]}
                      controller={controller}
                      focusServer={props.focusServer}
                      chooseProject={props.chooseProject}
                      openEdit={(server) => dialog.show(() => <DialogServerV2 mode="edit" server={server} />)}
                      toggleCollapsed={() => setState("collapsed", key, !state().collapsed[key])}
                      language={props.language}
                    />
                    <Show when={healthy() && hasProjects() && !collapsed()}>
                      <div class="mx-3 h-px bg-v2-border-border-base" />
                      <HomeProjectList {...props} server={item} projects={projects()} />
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </ScrollView>
      <HomeUtilityNav
        class="mb-8 mt-4 hidden shrink-0 lg:flex"
        openSettings={props.openSettings}
        openHelp={props.openHelp}
        language={props.language}
      />
    </aside>
  )
}

function HomeUtilityNav(props: {
  class?: string
  openSettings: () => void
  openHelp: () => void
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div class={`${props.class ?? ""} min-w-0 flex-col gap-1 pr-3`}>
      <button
        type="button"
        class={`${HOME_PROJECT_NAV_ROW} text-v2-text-text-faint [&>[data-slot=icon-svg]]:text-v2-icon-icon-muted`}
        onClick={props.openSettings}
      >
        <IconV2 name="settings-gear" size="small" />
        <span class={HOME_PROJECT_NAV_LABEL}>{props.language.t("sidebar.settings")}</span>
      </button>
      <button
        type="button"
        class={`${HOME_PROJECT_NAV_ROW} text-v2-text-text-faint [&>[data-slot=icon-svg]]:text-v2-icon-icon-muted`}
        onClick={props.openHelp}
      >
        <IconV2 name="help" size="small" />
        <span class={HOME_PROJECT_NAV_LABEL}>{props.language.t("sidebar.help")}</span>
      </button>
    </div>
  )
}

function HomeServerRow(props: {
  server: ServerConnection.Any
  selected: boolean
  collapsed: boolean
  health: ServerHealth | undefined
  controller: ReturnType<typeof useServerManagementController>
  focusServer: (server: ServerConnection.Any) => void
  chooseProject: (server: ServerConnection.Any) => void
  openEdit: (server: ServerConnection.Http) => void
  toggleCollapsed: () => void
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const [state, setState] = createStore({ menuOpen: false })
  const healthy = () => !!props.health?.healthy
  const canToggle = () => healthy() && global.ensureServerCtx(props.server).projects.list().length > 0
  return (
    <div class="group/server relative flex h-7 min-w-0 items-center rounded-[6px]">
      <button
        type="button"
        class={`${HOME_PROJECT_NAV_ROW} pr-16 disabled:opacity-60`}
        data-selected={props.selected ? "" : undefined}
        disabled={!healthy()}
        onClick={() => props.focusServer(props.server)}
      >
        <span
          data-action="home-server-collapse"
          class="inline-flex -ml-0.5 -mr-1.5 size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted"
          classList={{
            "hover:bg-v2-overlay-simple-overlay-hover": canToggle(),
            "cursor-default opacity-40": !canToggle(),
          }}
          aria-label={
            props.collapsed ? props.language.t("home.server.expand") : props.language.t("home.server.collapse")
          }
          aria-disabled={!canToggle()}
          aria-expanded={canToggle() ? !props.collapsed : undefined}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!canToggle()) return
            props.toggleCollapsed()
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <IconV2
            name="chevron-down"
            size="small"
            class="transition-transform duration-150 ease-in-out"
            style={{ transform: `rotate(${props.collapsed ? -90 : 0}deg)` }}
          />
        </span>
        <div class="flex size-4 shrink-0 items-center justify-center -mr-0.5">
          <ServerHealthIndicator health={props.health} />
        </div>
        <span class="flex min-w-0 items-center gap-1">
          <span class={HOME_PROJECT_NAV_LABEL}>{props.server.displayName ?? new URL(props.server.http.url).host}</span>
          <Show when={props.server.label}>
            {(label) => (
              <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                {label()}
              </span>
            )}
          </Show>
        </span>
      </button>
      <div
        class="hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 group-hover/server:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
        data-menu={state.menuOpen}
      >
        <ServerRowMenu
          server={props.server}
          controller={props.controller}
          onEdit={props.openEdit}
          open={state.menuOpen}
          onOpenChange={(open) => setState("menuOpen", open)}
        />
        <TooltipV2 class="flex shrink-0 items-center" placement="bottom" value={props.language.t("home.project.add")}>
          <IconButtonV2
            data-action="home-add-project"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="folder-add-left" />}
            aria-label={props.language.t("home.project.add")}
            disabled={props.health?.healthy === false}
            onClick={() => props.chooseProject(props.server)}
          />
        </TooltipV2>
      </div>
    </div>
  )
}

function HomeProjectList(props: {
  server: ServerConnection.Any
  projects: LocalProject[]
  selected: HomeProjectSelection
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <For each={props.projects}>
        {(project) => (
          <HomeProjectRow
            project={project}
            server={props.server}
            selected={
              props.selected.server === ServerConnection.key(props.server) &&
              props.selected.directory === project.worktree
            }
            unseenCount={props.unseenCount(props.server, project)}
            selectProject={props.selectProject}
            openNewSession={props.openNewSession}
            editProject={props.editProject}
            closeProject={props.closeProject}
            clearNotifications={props.clearNotifications}
            language={props.language}
          />
        )}
      </For>
    </div>
  )
}

function HomeProjectEmpty(props: {
  server: ServerConnection.Any
  recentlyClosed: LocalProject[]
  homedir: string
  chooseProject: (server: ServerConnection.Any) => void
  openRecentProject: (server: ServerConnection.Any, directory: string) => void
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const unreachable = () => global.servers.health[ServerConnection.key(props.server)]?.healthy === false
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        data-action="home-add-project-row"
        class={`${HOME_PROJECT_NAV_ROW} disabled:opacity-60 [&>[data-slot=icon-svg]]:text-v2-icon-icon-muted`}
        disabled={unreachable()}
        onClick={() => props.chooseProject(props.server)}
      >
        <IconV2 name="folder-add-left" size="small" />
        <span class={HOME_PROJECT_NAV_LABEL}>{props.language.t("home.project.add")}</span>
      </button>
      <Show when={props.recentlyClosed.length > 0}>
        <div class="mt-3 flex h-7 min-w-0 shrink-0 items-center pl-1.5 pr-3">
          <div class="text-v2-text-text-faint [font-weight:530]">{props.language.t("home.recentlyClosed")}</div>
        </div>
        <For each={props.recentlyClosed}>
          {(project) => (
            <HomeRecentlyClosedRow
              project={project}
              server={props.server}
              homedir={props.homedir}
              openRecentProject={props.openRecentProject}
              language={props.language}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

function HomeRecentlyClosedRow(props: {
  project: LocalProject
  server: ServerConnection.Any
  homedir: string
  openRecentProject: (server: ServerConnection.Any, directory: string) => void
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const unreachable = () => global.servers.health[ServerConnection.key(props.server)]?.healthy === false
  const path = () => {
    const home = props.homedir
    const worktree = props.project.worktree
    if (home && (worktree === home || worktree.startsWith(`${home}/`))) return `~${worktree.slice(home.length)}`
    return worktree
  }
  return (
    <TooltipV2 placement="right" value={path()}>
      <button
        type="button"
        data-component="home-recently-closed-row"
        class={`${HOME_PROJECT_NAV_ROW} disabled:opacity-60`}
        disabled={unreachable()}
        onClick={() => props.openRecentProject(props.server, props.project.worktree)}
      >
        <HomeProjectAvatar project={props.project} outline />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
      </button>
    </TooltipV2>
  )
}

function HomeProjectRow(props: {
  project: LocalProject
  server: ServerConnection.Any
  selected: boolean
  unseenCount: number
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const platform = usePlatform()
  const serverUnreachable = () => global.servers.health[ServerConnection.key(props.server)]?.healthy === false
  const [state, setState] = createStore({ menuOpen: false })
  const canRevealInFileManager = () =>
    platform.platform === "desktop" && !!platform.openPath && ServerConnection.local(props.server)
  const fileManagerActionLabel = () =>
    props.language.t(
      fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown").actionLabel,
    )
  const revealInFileManager = () => {
    if (!platform.openPath) return
    platform.openPath(props.project.worktree).catch((err: unknown) =>
      showToast({
        title: props.language.t("common.requestFailed"),
        description: errorMessage(err, props.language.t("common.requestFailed")),
      }),
    )
  }
  return (
    <div class="group/project relative flex h-7 min-w-0 items-center rounded-[6px]">
      <button
        type="button"
        data-component="home-project-row"
        class={`${HOME_PROJECT_NAV_ROW} pr-16 disabled:opacity-60`}
        data-selected={props.selected ? "" : undefined}
        aria-current={props.selected ? "page" : undefined}
        disabled={serverUnreachable()}
        onClick={() => props.selectProject(props.server, props.project.worktree)}
      >
        <HomeProjectAvatar project={props.project} />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
      </button>
      <div
        class="hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
        data-menu={state.menuOpen}
      >
        <MenuV2
          gutter={6}
          modal={false}
          placement="bottom-end"
          open={state.menuOpen}
          onOpenChange={(open) => setState("menuOpen", open)}
        >
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="home-project-menu"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={props.language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.openNewSession(props.server, props.project.worktree)}>
                {props.language.t("command.session.new")}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => props.editProject(props.server, props.project)}>
                {props.language.t("dialog.project.edit.title")}
              </MenuV2.Item>
              <Show when={canRevealInFileManager()}>
                <MenuV2.Item onSelect={revealInFileManager}>{fileManagerActionLabel()}</MenuV2.Item>
              </Show>
              <MenuV2.Item
                disabled={props.unseenCount === 0}
                onSelect={() => props.clearNotifications(props.server, props.project)}
              >
                {props.language.t("sidebar.project.clearNotifications")}
              </MenuV2.Item>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => props.closeProject(props.server, props.project.worktree)}>
                {props.language.t("common.close")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
        <IconButtonV2
          data-action="home-project-new-session"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="edit" />}
          aria-label={props.language.t("command.session.new")}
          onClick={() => props.openNewSession(props.server, props.project.worktree)}
        />
      </div>
    </div>
  )
}

function HomeProjectAvatar(props: { project: LocalProject; outline?: boolean }) {
  const name = createMemo(() => displayName(props.project))
  return (
    <ProjectAvatar
      fallback={name()}
      src={props.outline ? undefined : getProjectAvatarSource(props.project.id, props.project.icon)}
      variant={props.outline ? "outline" : getProjectAvatarVariant(props.project.icon?.color)}
    />
  )
}

export function LegacyHome() {
  const sync = useServerSync()
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const navigate = useNavigate()
  const global = useGlobal()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync().data.path.home)
  const serverUnreachable = createMemo(() => global.servers.health[server.key]?.healthy === false)
  const recent = createMemo(() => {
    return sync()
      .data.project.slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = global.servers.health[server.key]?.healthy
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(server: ServerConnection.Any, directory: string) {
    const serverCtx = global.ensureServerCtx(server)
    serverCtx.projects.open(directory)
    serverCtx.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  function chooseProject() {
    if (serverUnreachable()) return
    const s = server.current
    if (!s) return

    const resolve = (result: string | string[] | null) => {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(s, directory)
        }
      } else if (result) {
        openProject(s, result)
      }
    }

    pickDirectory({
      server: s,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: resolve,
    })
  }

  return (
    <div class="mx-auto mt-55 w-full md:w-auto px-4">
      <Logo class="md:w-xl opacity-12" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        {server.name}
      </Button>
      <Switch>
        <Match when={sync().data.project.length > 0}>
          <div class="mt-20 w-full flex flex-col gap-4">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
              <Button
                icon="folder-add-left"
                size="normal"
                class="pl-2 pr-3"
                disabled={serverUnreachable()}
                onClick={chooseProject}
              >
                {language.t("command.project.open")}
              </Button>
            </div>
            <ul class="flex flex-col gap-2">
              <For each={recent()}>
                {(project) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="text-14-mono text-left justify-between px-3"
                    onClick={() => openProject(server.current!, project.worktree)}
                  >
                    {project.worktree.replace(homedir(), "~")}
                    <div class="text-14-regular text-text-weak">
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </div>
                  </Button>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={!sync().ready}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>
            <Button class="px-3" disabled={serverUnreachable()} onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
              <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
            </div>
            <Button class="px-3 mt-1" disabled={serverUnreachable()} onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
