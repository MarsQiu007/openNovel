/**
 * 设定中心 — 左栏设定树（setting-center-tree）。
 *
 * 三节可收纳树：书籍内容（书籍信息 / 世界观条目分类子树 / 伏笔）、
 * AI 设定（写作风格 / 灵魂 / 技法库 / 整理）、角色（角色平铺列表）。
 * 树顶统一搜索跨条目标题与角色名过滤，命中分组自动展开；
 * 板块收纳状态由父级按书持久化（collapsedSections），分类子组收纳为内存态。
 * 新建世界观条目入口承接原 world-sidebar 表单，提交成功选中新条目。
 */
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useCreateWorldEntry, useCharacters, useReviewInboxCounts, useWorldEntries } from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Icon } from "@opennovel-ai/ui/icon"
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
            active={isSelected({ kind: "book-info" })}
            onClick={() => props.onSelect({ kind: "book-info" })}
          />
          {/* 世界观条目 root 节点：选中 → 中央区「列表 / 地图」；chevron 单独收纳分类子树 */}
          <Show when={hasEntryHits() || !searching()}>
            <div
              class="flex items-center gap-1.5 rounded py-1.5 pr-2"
              classList={{
                "bg-v2-background-bg-layer-02": isSelected({ kind: "world" }),
              }}
              style={{ "margin-left": "24px", "margin-right": "12px", "padding-left": "8px" }}
            >
              <button
                type="button"
                class="min-w-0 flex-1 truncate text-left text-sm transition-colors"
                classList={{
                  "text-v2-text-text-base font-medium": isSelected({ kind: "world" }),
                  "text-v2-text-text-muted hover:text-v2-text-text-base": !isSelected({ kind: "world" }),
                }}
                onClick={() => props.onSelect({ kind: "world" })}
              >
                {language.t("novel.settings.tree.worldEntries")}
              </button>
              <button
                type="button"
                class="shrink-0 text-v2-text-text-muted hover:text-v2-text-text-base transition-colors"
                onClick={() => toggleGroup("world-entries")}
                aria-expanded={!groupCollapsed("world-entries")}
                aria-label={language.t("novel.settings.tree.toggleWorldEntries")}
              >
                <Icon name={groupCollapsed("world-entries") && !searching() ? "chevron-right" : "chevron-down"} size="small" />
              </button>
              <ButtonV2
                variant="ghost"
                size="small"
                class="shrink-0"
                onClick={() => {
                  // 分组收纳时先展开，保证内联表单可见
                  if (!searching() && groupCollapsed("world-entries")) toggleGroup("world-entries")
                  setIsAddingEntry(!isAddingEntry())
                }}
              >
                +
              </ButtonV2>
            </div>
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
            active={isSelected({ kind: "foreshadow" })}
            onClick={() => props.onSelect({ kind: "foreshadow" })}
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
            active={isSelected({ kind: "style" })}
            onClick={() => props.onSelect({ kind: "style" })}
          />
          <NodeRow
            label={language.t("novel.settings.tree.soul")}
            active={isSelected({ kind: "soul" })}
            onClick={() => props.onSelect({ kind: "soul" })}
          />
          <NodeRow
            label={language.t("novel.settings.tree.techniques")}
            active={isSelected({ kind: "techniques" })}
            onClick={() => props.onSelect({ kind: "techniques" })}
          />
          <NodeRow
            label={language.t("novel.settings.tree.organization")}
            active={isSelected({ kind: "organization" })}
            onClick={() => props.onSelect({ kind: "organization" })}
            badge={inboxCounts.data?.total}
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

/** 一级板块头：收纳控件 + 标题，点击整行切换收纳。 */
function SectionHeader(props: { title: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-v2-text-text-muted uppercase tracking-wider hover:text-v2-text-text-base transition-colors"
      onClick={props.onToggle}
      aria-expanded={!props.collapsed}
    >
      <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size="small" />
      <span class="truncate">{props.title}</span>
    </button>
  )
}

/** 可收纳分组行（分类子组）：depth 控制缩进。 */
function GroupRow(props: {
  label: string
  collapsed: boolean
  onToggle: () => void
  depth: number
}) {
  return (
    <div
      class="flex items-center gap-1.5 rounded py-1.5 pr-2 text-sm text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 transition-colors"
      style={{ "margin-left": `${12 + props.depth * 12}px`, "margin-right": "12px", "padding-left": "8px" }}
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={props.onToggle}
        aria-expanded={!props.collapsed}
      >
        <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size="small" />
        <span class="truncate text-xs font-medium uppercase tracking-wider">{props.label}</span>
      </button>
    </div>
  )
}

/** 树节点行：depth 控制缩进；active 常驻高亮，faded 用于已退场角色。 */
function NodeRow(props: {
  label: string
  active: boolean
  onClick: () => void
  depth?: number
  faded?: boolean
  badge?: number
}) {
  return (
    <button
      type="button"
      class="block w-full rounded py-1.5 pr-3 text-sm transition-colors"
      classList={{
        "bg-v2-background-bg-layer-02 text-v2-text-text-base font-medium": props.active,
        "text-v2-text-text-base hover:bg-v2-background-bg-layer-02": !props.active,
        "opacity-50": !!props.faded,
      }}
      style={{
        "margin-left": `${12 + (props.depth ?? 0) * 12}px`,
        "margin-right": "12px",
        "padding-left": "8px",
      }}
      onClick={props.onClick}
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate">{props.label}</span>
        <Show when={(props.badge ?? 0) > 0}>
          <span class="ml-auto shrink-0 rounded-full bg-v2-background-bg-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-v2-text-text-contrast">
            {props.badge}
          </span>
        </Show>
      </span>
    </button>
  )
}
