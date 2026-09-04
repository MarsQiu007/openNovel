import { createEffect, createMemo, For, onCleanup, onMount } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createQuery } from "@tanstack/solid-query"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@dnd-kit/helpers"
import { tabHref, tabKey, type NovelTab, type Tab } from "@/context/tabs"
import { ServerConnection } from "@/context/server"
import { Icon as IconV2 } from "@opennovel-ai/ui/v2/icon"
import { TabNavItem } from "@/components/titlebar-tab-nav"
import { useGlobal, type ServerCtx } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { useTabs } from "@/context/tabs"
import { novelClientFor, novelKeys } from "@/context/novel-queries"
import { novelTabTitle } from "@/context/tab-route"
import { decode64 } from "@/utils/base64"
import { canStartTabDrag, isTabCloseTarget } from "./titlebar-tab-gesture"

function NovelTabSlot(props: {
  tab: NovelTab
  id: string
  index: () => number
  active: () => boolean
  forceTruncate: boolean
  serverCtx: () => ServerCtx | undefined
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
}) {
  const tabs = useTabs()
  const language = useLanguage()
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index()
    },
  })
  let ref!: HTMLDivElement
  const serverCtx = createMemo(() => props.serverCtx())
  const directory = createMemo(() => decode64(props.tab.dir))

  // Same query key as the workspace detail query, so a rename from inside the
  // workspace (which invalidates that key) refetches here and the tab title
  // follows. Runs through the server ctx — the strip renders outside the
  // workspace scope, so useSDK()/useNovelClient() are not available.
  const novel = createQuery(() => ({
    queryKey: novelKeys.detail(directory() ?? "", props.tab.novelID),
    queryFn: async () => {
      const ctx = serverCtx()
      const dir = directory()
      if (!ctx || !dir) throw new Error("Missing novel context")
      return novelClientFor(ctx.sdk)["server.novel"].detail({
        novelID: props.tab.novelID,
        location: { directory: dir },
      })
    },
    enabled: !!serverCtx() && !!directory(),
    staleTime: 30_000,
  }))

  createEffect(() => {
    const title = novel.data?.title
    if (!title) return
    tabs.rememberNovelInfo(props.tab, { title })
  })

  // Persisted cache wins so a restart shows the title immediately, before the
  // query resolves; the effect above syncs the cache once fresh data lands.
  const title = createMemo(() => novelTabTitle(tabs.info[props.id], novel.data, language.t("novel.tab.loading")))

  return (
    <div
      ref={sortable.ref}
      data-titlebar-tab-slot
      data-tab-key={props.id}
      data-active={props.active()}
      class="relative flex w-56 min-w-7 max-w-56 flex-shrink"
    >
      <TabNavItem
        ref={(el) => {
          ref = el
        }}
        href={tabHref(props.tab)}
        server={props.tab.server}
        session={() => undefined}
        icon={<IconV2 name="book" />}
        fallbackTitle={title()}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        active={props.active()}
        forceTruncate={props.forceTruncate}
        dragging={sortable.isDragSource()}
      />
    </div>
  )
}

export function TitlebarTabStrip(props: {
  tabs: Tab[]
  currentTab: () => Tab | undefined
  forceTruncate: boolean
  onNavigate: (tab: Tab, el?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onReorder: (keys: string[]) => void
  onOverflowChange: (overflowing: boolean) => void
}) {
  const global = useGlobal()
  let scrollRef!: HTMLDivElement
  let listRef!: HTMLDivElement
  let resizeFrame: number | undefined

  const tabIds = () => props.tabs.map(tabKey)

  function refreshOverflow() {
    if (!scrollRef) return
    props.onOverflowChange(scrollRef.scrollWidth > scrollRef.clientWidth)
  }

  createResizeObserver(
    () => [scrollRef, listRef],
    () => {
      if (resizeFrame !== undefined) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined
        refreshOverflow()
      })
    },
  )

  onMount(() => {
    refreshOverflow()
  })

  onCleanup(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  })

  createEffect(() => {
    props.tabs.length
    tabIds()
    refreshOverflow()
  })

  return (
    <div data-slot="titlebar-tabs" class="relative min-w-0">
      <div
        data-slot="titlebar-tabs-scroll"
        class="flex min-w-0 flex-row items-center gap-1.5 overflow-x-auto no-scrollbar [app-region:no-drag]"
        ref={scrollRef}
      >
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
              preventActivation: (event) =>
                !canStartTabDrag(event.pointerType) ||
                isTabCloseTarget(event.target) ||
                (event.target instanceof Element && !!event.target.closest('[contenteditable="true"]')),
            }),
          ]}
          modifiers={[RestrictToHorizontalAxis, RestrictToElement.configure({ element: () => listRef })]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragStart={(event) => {
            const source = event.operation.source
            if (!source) return
            const tab = props.tabs.find((item) => tabKey(item) === source.id.toString())
            if (!tab) return
            const tabEl = source.element?.querySelector<HTMLDivElement>("[data-titlebar-tab]")
            props.onNavigate(tab, tabEl ?? undefined)
          }}
          onDragEnd={(event) => {
            const current = tabIds()
            const source = event.operation.source
            if (event.canceled || !isSortable(source)) return

            const { initialIndex, index } = source
            if (initialIndex !== index) {
              props.onReorder(arrayMove(current, source.initialIndex, source.index))
            }
          }}
        >
          <div data-titlebar-tab-list class="flex w-full min-w-0 flex-row items-center" ref={listRef}>
            <For each={props.tabs}>
              {(tab, index) => {
                const id = tabKey(tab)
                let ref!: HTMLDivElement
                useTabShortcut(index, () => props.onNavigate(tab, ref))
                const serverCtx = createMemo(() => {
                  const conn = global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
                  if (conn) return global.ensureServerCtx(conn)
                })

                return (
                  <NovelTabSlot
                    tab={tab}
                    id={id}
                    index={index}
                    active={() => props.currentTab() === tab}
                    forceTruncate={props.forceTruncate}
                    serverCtx={serverCtx}
                    onNavigate={(element) => {
                      ref = element
                      props.onNavigate(tab, element)
                    }}
                    onClose={() => props.onClose(tab)}
                  />
                )
              }}
            </For>
          </div>
        </DragDropProvider>
      </div>
      <div
        data-slot="titlebar-tabs-fade-left"
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-[linear-gradient(to_right,var(--v2-background-bg-deep),transparent)]"
      />
      <div
        data-slot="titlebar-tabs-fade-right"
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-[linear-gradient(to_left,var(--v2-background-bg-deep),transparent)]"
      />
    </div>
  )
}

function useTabShortcut(index: () => number, onSelect: () => void) {
  const command = useCommand()

  command.register(() => {
    const number = index() + 1
    if (number > 9) return []
    return [
      {
        id: `tab.${number}`,
        category: "tab",
        title: "",
        keybind: `mod+${number}`,
        hidden: true,
        onSelect,
      },
    ]
  })
}
