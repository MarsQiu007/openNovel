/**
 * 设定中心 — 左栏世界条目列表
 *
 * 复用 panel-world 的搜索 / 添加 / 分组 / 删除逻辑，
 * 新增 selectedEntryId 高亮 + 点击列表项通过 onSelect 通知父组件。
 * 编辑/详情移到中央的 WorldReader。
 */
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useConfirmDelete } from "./confirm-dialog"
import { useCreateWorldEntry, useDeleteWorldEntry, useWorldEntries } from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import fuzzysort from "fuzzysort"

type WorldSidebarProps = {
  novelID: Accessor<string>
  selectedEntryId: Accessor<string | null>
  onSelect: (entryID: string) => void
}

export function WorldSidebar(props: WorldSidebarProps) {
  const language = useLanguage()
  const query = useWorldEntries(props.novelID)
  const createWorld = useCreateWorldEntry()
  const deleteWorld = useDeleteWorldEntry()
  const confirmDelete = useConfirmDelete()
  const [search, setSearch] = createSignal("")
  const [isAdding, setIsAdding] = createSignal(false)
  const [newCategory, setNewCategory] = createSignal("")
  const [newTitle, setNewTitle] = createSignal("")
  const [newContent, setNewContent] = createSignal("")

  const grouped = createMemo(() => {
    const data = query.data
    if (!data) return new Map<string, NonNullable<typeof data>>()

    const filtered = search()
      ? fuzzysort.go(search(), data, { key: "title", threshold: -1000 }).map((r) => r.obj)
      : data

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

  return (
    <div class="flex flex-col gap-3">
      <Show when={query.isLoading}>
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-5 h-5 text-v2-text-text-muted" />
        </div>
      </Show>

      <Show when={query.error}>
        <p class="text-sm text-v2-state-fg-danger px-3 py-2">{String(query.error)}</p>
      </Show>

      {/* Search box */}
      <div class="px-3">
        <TextInputV2
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          placeholder={language.t("novel.panel.world.search")}
          fluid
        />
      </div>

      {/* Add form */}
      <div class="px-3">
        <Show
          when={isAdding()}
          fallback={
            <ButtonV2 variant="ghost" size="small" onClick={() => setIsAdding(true)}>
              + {language.t("novel.panel.world.add")}
            </ButtonV2>
          }
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!newTitle().trim()) return
              await createWorld.mutateAsync({
                novelID: props.novelID(),
                category: newCategory() || language.t("novel.panel.world.uncategorized"),
                title: newTitle(),
                content: newContent() || undefined,
              })
              setNewCategory("")
              setNewTitle("")
              setNewContent("")
              setIsAdding(false)
            }}
            class="flex flex-col gap-2"
          >
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
              <ButtonV2 type="submit" variant="contrast" size="small">
                {language.t("novel.panel.world.add")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                onClick={() => {
                  setNewCategory("")
                  setNewTitle("")
                  setNewContent("")
                  setIsAdding(false)
                }}
              >
                ✕
              </ButtonV2>
            </div>
          </form>
        </Show>
      </div>

      <Show when={query.data && query.data.length === 0 && !search() && !isAdding()}>
        <p class="text-sm text-v2-text-text-muted px-3 py-8 text-center">{language.t("novel.panel.world.empty")}</p>
      </Show>

      <Show when={grouped().size > 0}>
        <For each={Array.from(grouped().entries())}>
          {([category, entries]) => (
            <div class="flex flex-col gap-1">
              <h4 class="text-xs font-medium text-v2-text-text-muted px-3 uppercase tracking-wider">
                {category} ({entries.length})
              </h4>
              <For each={entries}>
                {(entry) => (
                  <div class="flex flex-col gap-1 mx-2 px-2 py-2 rounded hover:bg-v2-background-bg-layer-02 transition-colors">
                    <div class="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        class="flex-1 min-w-0 text-left text-sm font-medium text-v2-text-text-base truncate"
                        classList={{
                          "text-v2-text-text-base": props.selectedEntryId() !== entry.id,
                        }}
                        onClick={() => props.onSelect(entry.id)}
                      >
                        {entry.title}
                      </button>
                      <ButtonV2
                        variant="danger"
                        size="small"
                        class="shrink-0"
                        onClick={() =>
                          confirmDelete({
                            title: language.t("novel.panel.world.delete"),
                            message: language.t("novel.panel.world.deleteConfirm"),
                            onConfirm: () =>
                              deleteWorld.mutate({
                                novelID: props.novelID(),
                                entryID: entry.id,
                              }),
                          })
                        }
                      >
                        {language.t("novel.panel.world.delete")}
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>

      <Show when={search() && query.data && query.data.length > 0 && grouped().size === 0}>
        <p class="text-sm text-v2-text-text-muted px-3 py-4 text-center">{language.t("palette.empty")}</p>
      </Show>
    </div>
  )
}
