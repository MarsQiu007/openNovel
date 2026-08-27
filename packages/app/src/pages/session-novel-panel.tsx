/**
 * 聊天页左侧「书籍对话」可折叠侧边栏。
 *
 * 与会话页共用 NovelSessionGroupList，额外提供：
 * - 当前会话高亮（activeSessionID）
 * - 折叠/展开，折叠状态持久化（收起后显示一条窄栏，点击书本图标展开）
 */
import { type Accessor, createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ScrollView } from "@opennovel-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opennovel-ai/ui/v2/icon"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opennovel-ai/ui/v2/tooltip-v2"
import { useNavigate } from "@solidjs/router"
import { ServerConnection, useServer } from "@/context/server"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"
import { useNovelSessions } from "./novel-sessions"
import { NovelSessionGroupList } from "./sessions-novel-sidebar"

export function SessionNovelPanel(props: {
  serverKey: Accessor<ServerConnection.Key>
  directory: Accessor<string | undefined>
  activeSessionID: Accessor<string>
}) {
  const language = useLanguage()
  const global = useGlobal()
  const server = useServer()
  const navigate = useNavigate()

  const conn = createMemo(
    () => global.servers.list().find((c) => ServerConnection.key(c) === props.serverKey()) ?? server.current,
  )
  const novelSessions = useNovelSessions({
    conn,
    directory: props.directory,
    server: () => props.serverKey(),
  })

  const [panelState, setPanelState, _persist, ready] = persisted(
    Persist.global("novel.chat-session-panel"),
    createStore({ collapsed: false }),
  )
  const collapsed = () => panelState.collapsed
  const setCollapsed = (value: boolean) => setPanelState("collapsed", value)

  return (
    <Show when={ready()}>
      <Show
        when={!collapsed()}
        fallback={
          // 折叠态：窄栏保留返回书架与展开按钮
          <div class="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-v2-border-border-base bg-v2-background-bg-base pt-2">
            <TooltipV2 placement="right" value={language.t("novel.bookshelf.open")}>
              <IconButtonV2
                type="button"
                data-action="novel-panel-back-home"
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="chevron-down" class="-rotate-90" />}
                aria-label={language.t("novel.bookshelf.open")}
                onClick={() => navigate("/")}
              />
            </TooltipV2>
            <TooltipV2 placement="right" value={language.t("home.sessions.sidebar.books")}>
              <IconButtonV2
                type="button"
                data-action="novel-panel-expand"
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="book" />}
                aria-label={language.t("home.sessions.sidebar.books")}
                onClick={() => setCollapsed(false)}
              />
            </TooltipV2>
          </div>
        }
      >
        <aside
          data-component="session-novel-panel"
          class="flex w-60 shrink-0 flex-col min-h-0 border-r border-v2-border-border-base bg-v2-background-bg-base"
          aria-label={language.t("home.sessions.sidebar.books")}
        >
          <div class="flex h-9 shrink-0 items-center justify-between pl-3 pr-1.5 border-b border-v2-border-border-base">
            <button
              type="button"
              data-action="novel-panel-back-home"
              class="flex items-center gap-1 text-[12px] text-v2-text-text-muted transition-colors hover:text-v2-text-text-base [font-weight:440]"
              onClick={() => navigate("/")}
            >
              <IconV2 name="chevron-down" size="small" class="-rotate-90" />
              {language.t("novel.bookshelf.open")}
            </button>
            <TooltipV2 placement="right" value={language.t("home.sessions.sidebar.collapse")}>
              <IconButtonV2
                type="button"
                data-action="novel-panel-collapse"
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="collapse" />}
                aria-label={language.t("home.sessions.sidebar.collapse")}
                onClick={() => setCollapsed(true)}
              />
            </TooltipV2>
          </div>
          <ScrollView class="min-h-0 flex-1">
            <div class="flex min-w-0 flex-col gap-px p-1.5 pb-8">
              <NovelSessionGroupList
                directory={props.directory()}
                novels={novelSessions.novels()}
                bindings={novelSessions.bindings()}
                sessions={novelSessions.sessions()}
                loading={novelSessions.loading()}
                activeSessionID={props.activeSessionID()}
                showUnbound
                openSessionById={novelSessions.openSessionById}
                createNovelSession={novelSessions.createNovelSession}
                archiveSession={novelSessions.archiveSession}
                exportSession={novelSessions.exportSession}
              />
            </div>
          </ScrollView>
        </aside>
      </Show>
    </Show>
  )
}
