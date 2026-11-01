/**
 * 设定中心 — 左栏设定树（setting-center-tree）。
 *
 * 三节可收纳树：书籍内容（书籍信息 / 世界观条目分类子树 / 伏笔）、
 * AI 设定（写作风格 / 灵魂 / 技法库 / 整理）、角色（角色平铺列表）。
 * 树顶统一搜索跨条目标题与角色名过滤，命中分组自动展开；
 * 板块收纳状态由父级按书持久化（collapsedSections），分类子组收纳为内存态。
 * 新建世界观条目入口承接原 world-sidebar 表单，提交成功选中新条目。
 *
 * 行结构为 VS Code 式三段：行首 depth 个 16px 引导线槽（槽内 1px 竖线贯穿行高）
 * + 控件槽（可收纳节点为 chevron + 语义图标，叶子节点以语义图标占据父级图标同列）
 * + 文本；同层级行控件列起点一致，缩进阶梯完全由槽撑出。
 */
import { type Accessor, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useCreateWorldEntry, useCharacters, useMemoryFactCounts, useReviewInboxCounts, useWorldEntries } from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Icon, type IconProps } from "@opennovel-ai/ui/icon"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import type { SettingsNode } from "./settings-node"

export type SettingsTreeProps = {
  novelID: Accessor<string>
  selectedNode: Accessor<SettingsNode | null>
  onSelect: (node: SettingsNode) => void
  collapsedSections: Accessor<readonly string[]>
  onToggleSection: (key: string) => void
}

export function SettingsTree(props: SettingsTreeProps) {
  const language = useLanguage()
  const worldQuery = useWorldEntries(props.novelID)
  const charactersQuery = useCharacters(props.novelID)
  const createWorld = useCreateWorldEntry()
  // 「整理」节点待审徽标：计数 query 随收件箱操作失效联动，清零后不显示
  const inboxCounts = useReviewInboxCounts(props.novelID)
  // 「记忆」节点待办徽标（pending+reviewed+stale），同收件箱失效联动
  const memoryCounts = useMemoryFactCounts(props.novelID)

  const [search, setSearch] = createSignal("")
  // 分类子组收纳为内存态（不持久化；一级板块收纳由父级按书记忆）
  const [collapsedGroups, setCollapsedGroups] = createSignal<readonly string[]>([])
  const [isAddingEntry, setIsAddingEntry] = createSignal(false)
  const [newCategory, setNewCategory] = createSignal("")
  const [newTitle, setNewTitle] = createSignal("")
  const [newContent, setNewContent] = createSignal("")

  const searching = () => search().trim().length > 0

  const groupedEntries = createMemo(() => {
    const data = worldQuery.data
    if (!data) return new Map<string, NonNullable<typeof data>>()
    const q = search().trim().toLowerCase()
    const filtered = q ? data.filter((entry) => entry.title.toLowerCase().includes(q)) : data
    const groups = new Map<string, NonNullable<typeof data>>()
    for (const entry of filtered) {
      const cat = entry.category || language.t("novel.panel.world.uncategorized")
      const existing = groups.get(cat)
      if (existing) {
        groups.set(cat, [...existing, entry])
      } else {
        groups.set(cat, [entry])
      }
    }
    return groups
  })

  const filteredCharacters = createMemo(() => {
    const data = charactersQuery.data ?? []
    const q = search().trim().toLowerCase()
    if (!q) return data
    return data.filter(
      (c) => c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q),
    )
  })

  const sectionCollapsed = (key: string) =>
    searching() ? false : props.collapsedSections().includes(key)
  const groupCollapsed = (key: string) => collapsedGroups().includes(key)

  const toggleGroup = (key: string) => {
    setCollapsedGroups((list) =>
      list.includes(key) ? list.filter((k) => k !== key) : [...list, key],
    )
  }

  const isSelected = (node: SettingsNode) => {
    const current = props.selectedNode()
    if (!current) return false
    if (current.kind !== node.kind) return false
    if (node.kind === "world-entry" && current.kind === "world-entry")
      return current.entryId === node.entryId
    if (node.kind === "character" && current.kind === "character")
      return current.characterId === node.characterId
    return true
  }

  const hasEntryHits = () => groupedEntries().size > 0
  const hasCharacterHits = () => filteredCharacters().length > 0
  const searchEmpty = () => searching() && !hasEntryHits() && !hasCharacterHits()

  async function submitNewEntry() {
    if (!newTitle().trim()) return
    const created = await createWorld.mutateAsync({
      novelID: props.novelID(),
      category: newCategory() || language.t("novel.panel.world.uncategorized"),
      title: newTitle(),
      content: newContent() || undefined,
    })
    setNewCategory("")
    setNewTitle("")
    setNewContent("")
    setIsAddingEntry(false)
    props.onSelect({ kind: "world-entry", entryId: created.id })
  }

  const resetNewEntry = () => {
    setNewCategory("")
    setNewTitle("")
    setNewContent("")
    setIsAddingEntry(false)
  }

  return (
    <div class="flex flex-col gap-1 py-2" data-slot="settings-tree">
      <Show when={worldQuery.isLoading || charactersQuery.isLoading}>
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-5 h-5 text-v2-text-text-muted" />
        </div>
      </Show>

      <Show when={worldQuery.error}>
        <p class="text-sm text-v2-state-fg-danger px-4 py-3">{String(worldQuery.error)}</p>
      </Show>

      {/* 树顶统一搜索：跨世界观条目标题与角色名过滤 */}
      <div class="px-4 py-2">
        <TextInputV2
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          placeholder={language.t("novel.settings.tree.search")}
          fluid
        />
      </div>

      <Show when={searchEmpty()}>
        <p class="text-sm text-v2-text-text-muted px-4 py-8 text-center">
          {language.t("novel.settings.tree.searchEmpty")}
        </p>
      </Show>

      {/* —— 书籍内容 —— */}
      <Show when={!searchEmpty()}>
        <SectionHeader
          title={language.t("novel.settings.tree.sectionBookContent")}
          collapsed={sectionCollapsed("book-content")}
          onToggle={() => props.onToggleSection("book-content")}
        />
        <Show when={!sectionCollapsed("book-content")}>
          <NodeRow
            label={language.t("novel.settings.tree.bookInfo")}
            icon="book"
            active={isSelected({ kind: "book-info" })}
            onClick={() => props.onSelect({ kind: "book-info" })}
            depth={1}
          />
          {/* 世界观条目 root 节点：选中 → 中央区「列表 / 地图」；chevron 单独收纳分类子树 */}
          <Show when={hasEntryHits() || !searching()}>
            <WorldRootRow
              selected={isSelected({ kind: "world" })}
              onSelect={() => props.onSelect({ kind: "world" })}
              collapsed={groupCollapsed("world-entries")}
              searching={searching()}
              onToggle={() => toggleGroup("world-entries")}
              toggleLabel={language.t("novel.settings.tree.toggleWorldEntries")}
              label={language.t("novel.settings.tree.worldEntries")}
              addAction={() => {
                // 分组收纳时先展开，保证内联表单可见
                if (!searching() && groupCollapsed("world-entries")) toggleGroup("world-entries")
                setIsAddingEntry(!isAddingEntry())
              }}
            />
            <Show when={!groupCollapsed("world-entries")}>
              <Show when={isAddingEntry()}>
                <div class="mx-4 my-1 flex flex-col gap-2 rounded border border-v2-border-border-base bg-v2-background-bg-layer-01 p-2">
                  <TextInputV2
                    value={newCategory()}
                    onInput={(e) => setNewCategory(e.currentTarget.value)}
                    placeholder={language.t("novel.panel.world.category")}
                    fluid
                  />
                  <TextInputV2
                    value={newTitle()}
                    onInput={(e) => setNewTitle(e.currentTarget.value)}
                    placeholder={language.t("novel.panel.world.title")}
                    fluid
                  />
                  <TextareaV2
                    fluid
                    value={newContent()}
                    onInput={(e) => setNewContent(e.currentTarget.value)}
                    placeholder={language.t("novel.panel.world.content")}
                    rows={3}
                  />
                  <div class="flex gap-2">
                    <ButtonV2
                      type="button"
                      variant="contrast"
                      size="small"
                      disabled={createWorld.isPending || !newTitle().trim()}
                      onClick={() => void submitNewEntry()}
                    >
                      {language.t("novel.panel.world.add")}
                    </ButtonV2>
                    <ButtonV2 type="button" variant="ghost-muted" size="small" onClick={resetNewEntry}>
                      ✕
                    </ButtonV2>
                  </div>
                </div>
              </Show>
              <Show
                when={groupedEntries().size > 0}
                fallback={
                  <Show when={!worldQuery.isLoading}>
                    <p class="text-xs text-v2-text-text-muted px-6 py-2">
                      {language.t("novel.panel.world.empty")}
                    </p>
                  </Show>
                }
              >
                <For each={Array.from(groupedEntries().entries())}>
                  {([category, entries]) => {
                    const groupKey = `cat:${category}`
                    return (
                      <>
                        <GroupRow
                          label={`${category} (${entries.length})`}
                          collapsed={!searching() && groupCollapsed(groupKey)}
                          onToggle={() => toggleGroup(groupKey)}
                          depth={2}
                        />
                        <Show when={!groupCollapsed(groupKey)}>
                          <For each={entries}>
                            {(entry) => (
                              <NodeRow
                                label={entry.title}
                                icon="map"
                                active={isSelected({ kind: "world-entry", entryId: entry.id })}
                                onClick={() => props.onSelect({ kind: "world-entry", entryId: entry.id })}
                                depth={3}
                              />
                            )}
                          </For>
                        </Show>
                      </>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </Show>
          <NodeRow
            label={language.t("novel.settings.tree.foreshadow")}
            icon="zap"
            active={isSelected({ kind: "foreshadow" })}
            onClick={() => props.onSelect({ kind: "foreshadow" })}
            depth={1}
          />
        </Show>

        {/* —— AI 设定 —— */}
        <SectionHeader
          title={language.t("novel.settings.tree.sectionAiSettings")}
          collapsed={sectionCollapsed("ai-settings")}
          onToggle={() => props.onToggleSection("ai-settings")}
        />
        <Show when={!sectionCollapsed("ai-settings")}>
          <NodeRow
            label={language.t("novel.settings.tree.style")}
            icon="pencil-line"
            active={isSelected({ kind: "style" })}
            onClick={() => props.onSelect({ kind: "style" })}
            depth={1}
          />
          <NodeRow
            label={language.t("novel.settings.tree.soul")}
            icon="fire"
            active={isSelected({ kind: "soul" })}
            onClick={() => props.onSelect({ kind: "soul" })}
            depth={1}
          />
          <NodeRow
            label={language.t("novel.settings.tree.techniques")}
            icon="library"
            active={isSelected({ kind: "techniques" })}
            onClick={() => props.onSelect({ kind: "techniques" })}
            depth={1}
          />
          <NodeRow
            label={language.t("novel.settings.tree.organization")}
            icon="checklist"
            active={isSelected({ kind: "organization" })}
            onClick={() => props.onSelect({ kind: "organization" })}
            depth={1}
            badge={inboxCounts.data?.total}
          />
          <NodeRow
            label={language.t("novel.settings.tree.memory")}
            icon="brain"
            active={isSelected({ kind: "memory" })}
            onClick={() => props.onSelect({ kind: "memory" })}
            depth={1}
            badge={memoryCounts.data?.total}
          />
        </Show>

        {/* —— 角色 —— */}
        <SectionHeader
          title={language.t("novel.settings.tree.sectionCharacters")}
          collapsed={sectionCollapsed("characters")}
          onToggle={() => props.onToggleSection("characters")}
        />
        <Show when={!sectionCollapsed("characters")}>
          {/* 角色板块 root 节点：选中 → 中央区「列表 / 关系图」 */}
          <Show when={hasCharacterHits() || !searching()}>
            <NodeRow
              label={language.t("novel.settings.tree.characterList")}
              icon="user"
              active={isSelected({ kind: "characters" })}
              onClick={() => props.onSelect({ kind: "characters" })}
              depth={1}
            />
          </Show>
          <Show
            when={filteredCharacters().length > 0}
            fallback={
              <Show when={!charactersQuery.isLoading}>
                <p class="text-xs text-v2-text-text-muted px-6 py-2">
                  {language.t("novel.panel.characters.empty")}
                </p>
              </Show>
            }
          >
            <For each={filteredCharacters()}>
              {(character) => (
                <NodeRow
                  label={character.name}
                  icon="user"
                  active={isSelected({ kind: "character", characterId: character.id })}
                  onClick={() => props.onSelect({ kind: "character", characterId: character.id })}
                  depth={2}
                  faded={character.status === "departed"}
                />
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

/** 树行槽：16px 见方，所有槽构成缩进阶梯；guide 槽带 1px 竖线贯穿行高（VS Code indent guide）。 */
function TreeSlot(props: { guide?: boolean; children?: JSX.Element }) {
  return (
    <span class="relative flex w-4 shrink-0 items-center justify-center self-stretch">
      <Show when={props.guide}>
        <span class="absolute inset-y-0 left-1/2 w-px bg-v2-border-border-muted" />
      </Show>
      {props.children}
    </span>
  )
}

/** 行首引导线槽：depth 个，竖线连接父级收纳控件与本行，滚动后归属仍可辨。 */
function GuideSlots(props: { depth: number }) {
  return (
    <For each={Array.from({ length: props.depth })}>
      {() => <TreeSlot guide />}
    </For>
  )
}

/** 一级板块头：chevron 居首槽（与子级引导线同列）+ 空图标槽 + 标题，点击整行切换收纳。 */
function SectionHeader(props: { title: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="flex w-full items-center rounded py-2 text-xs font-semibold text-v2-text-text-muted hover:text-v2-text-text-base transition-colors"
      onClick={props.onToggle}
      aria-expanded={!props.collapsed}
    >
      <TreeSlot>
        <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size="small" />
      </TreeSlot>
      <TreeSlot />
      <span class="ml-1.5 truncate">{props.title}</span>
    </button>
  )
}

/** 可收纳分组行（分类子组）：chevron + folder 图标 + 标题。 */
function GroupRow(props: {
  label: string
  collapsed: boolean
  onToggle: () => void
  depth: number
}) {
  return (
    <div class="flex w-full items-center rounded py-1.5 pr-2 text-sm text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 transition-colors">
      <GuideSlots depth={props.depth} />
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center text-left"
        onClick={props.onToggle}
        aria-expanded={!props.collapsed}
      >
        <TreeSlot>
          <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size="small" />
        </TreeSlot>
        <TreeSlot>
          <Icon name="folder" size="small" />
        </TreeSlot>
        <span class="ml-1.5 truncate">{props.label}</span>
      </button>
    </div>
  )
}

/** 世界观 root 行：可收纳（chevron + map 图标），标题选中进中央区，行尾保留新建入口。 */
function WorldRootRow(props: {
  label: string
  selected: boolean
  onSelect: () => void
  collapsed: boolean
  searching: boolean
  onToggle: () => void
  toggleLabel: string
  addAction: () => void
}) {
  return (
    <div
      class="relative flex w-full items-center rounded py-1.5 pr-2 transition-colors"
      classList={{
        "bg-v2-background-bg-layer-03": props.selected,
        "hover:bg-v2-background-bg-layer-02": !props.selected,
      }}
    >
      <GuideSlots depth={1} />
      <TreeSlot>
        <button
          type="button"
          class="text-v2-text-text-muted hover:text-v2-text-text-base transition-colors"
          onClick={props.onToggle}
          aria-expanded={!props.collapsed}
          aria-label={props.toggleLabel}
        >
          <Icon name={props.collapsed && !props.searching ? "chevron-right" : "chevron-down"} size="small" />
        </button>
      </TreeSlot>
      <TreeSlot>
        <Icon name="map" size="small" class="text-v2-text-text-muted" />
      </TreeSlot>
      <button
        type="button"
        class="ml-1.5 min-w-0 flex-1 truncate text-left text-sm transition-colors"
        classList={{
          "text-v2-text-text-base font-medium": props.selected,
          "text-v2-text-text-muted hover:text-v2-text-text-base": !props.selected,
        }}
        onClick={props.onSelect}
      >
        {props.label}
      </button>
      <ButtonV2 variant="ghost" size="small" class="shrink-0" onClick={props.addAction}>
        +
      </ButtonV2>
      <Show when={props.selected}>
        <span class="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-v2-background-bg-accent" />
      </Show>
    </div>
  )
}

/** 树节点行（叶子）：depth 撑出引导线槽，语义图标占父级图标同列；active 用 accent 左条与悬停分离，faded 用于已退场角色。 */
function NodeRow(props: {
  label: string
  icon: IconProps["name"]
  active: boolean
  onClick: () => void
  depth: number
  faded?: boolean
  badge?: number
}) {
  return (
    <button
      type="button"
      class="relative flex w-full items-center rounded py-1.5 pr-3 text-sm transition-colors"
      classList={{
        "bg-v2-background-bg-layer-03 text-v2-text-text-base font-medium": props.active,
        "text-v2-text-text-base hover:bg-v2-background-bg-layer-02": !props.active,
        "opacity-50": !!props.faded,
      }}
      onClick={props.onClick}
    >
      <GuideSlots depth={props.depth} />
      <TreeSlot>
        <Icon name={props.icon} size="small" class="text-v2-text-text-muted" />
      </TreeSlot>
      <span class="ml-1.5 min-w-0 flex-1 truncate text-left">{props.label}</span>
      <Show when={(props.badge ?? 0) > 0}>
        <span class="ml-1 shrink-0 rounded-full bg-v2-background-bg-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-v2-text-text-contrast">
          {props.badge}
        </span>
      </Show>
      <Show when={props.active}>
        <span class="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-v2-background-bg-accent" />
      </Show>
    </button>
  )
}
