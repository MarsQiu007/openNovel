import { createMemo, For, Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePendingApprovalCount } from "@/context/novel-approval"
import {
  useCreateChapter,
  useDeleteChapter,
  useCreateVolume,
  useUpdateVolume,
  useDeleteVolume,
  useMoveChapter,
  useUpdateChapter,
  useNovelSearch,
} from "@/context/novel-queries"
import type { ServerNovelVolumesOutput, ServerNovelChaptersOutput } from "@opennovel-ai/client"

// ─── Status color mapping ───

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-v2-icon-icon-muted",
  draft: "bg-v2-icon-icon-muted",
  outline: "bg-v2-icon-icon-muted",
  failed: "bg-v2-state-fg-danger",
  drafting: "bg-v2-state-fg-info",
  audited: "bg-v2-state-fg-warning",
  revised: "bg-v2-state-fg-warning",
  pending_review: "bg-v2-state-fg-warning",
  final: "bg-v2-state-fg-success",
  rejected: "bg-v2-state-fg-danger",
  published: "bg-v2-state-fg-success",
}

function statusDotColor(status: string): string {
  return STATUS_COLORS[status] ?? "bg-v2-icon-icon-muted"
}

// ─── Props ───

type ChapterSidebarProps = {
  novelID: string
  volumes: ServerNovelVolumesOutput
  chapters: ServerNovelChaptersOutput
  selectedChapterId: string | null
  onSelectChapter: (id: string) => void
}

// ─── Component ───

export default function ChapterSidebar(props: ChapterSidebarProps) {
  const language = useLanguage()
  const createChapter = useCreateChapter()
  const deleteChapter = useDeleteChapter()
  const createVolume = useCreateVolume()
  const updateVolume = useUpdateVolume()
  const deleteVolume = useDeleteVolume()
  const [isAdding, setIsAdding] = createSignal(false)
  const [newTitle, setNewTitle] = createSignal("")
  const [searchQuery, setSearchQuery] = createSignal("")
  const search = useNovelSearch(() => props.novelID, searchQuery)
  const searching = createMemo(() => searchQuery().trim().length > 0)
  const [ui, setUi] = createStore({
    addingVolume: false,
    volumeTitle: "",
    renamingId: null as string | null,
    renameDraft: "",
    deletingVolumeId: null as string | null,
    deletingChapterId: null as string | null,
    editingChapterId: null as string | null,
  })

  const pendingCount = createMemo(() => usePendingApprovalCount(props.chapters))

  const volumesSorted = createMemo(() => [...props.volumes].sort((a, b) => a.order - b.order))

  const chaptersByVolume = createMemo(() => {
    const map = new Map<string, ServerNovelChaptersOutput>()

    for (const ch of props.chapters) {
      if (ch.volumeId) {
        const existing = map.get(ch.volumeId) ?? []
        map.set(ch.volumeId, [...existing, ch])
      }
    }

    // Sort chapters within each volume by order
    for (const [id, list] of map) {
      map.set(
        id,
        [...list].sort((a, b) => a.order - b.order),
      )
    }

    const ungrouped = [...props.chapters].filter((ch) => !ch.volumeId).sort((a, b) => a.order - b.order)

    return { grouped: map, ungrouped }
  })

  const empty = () => props.chapters.length === 0

  async function submitNewChapter() {
    const title = newTitle().trim()
    if (!title) {
      setIsAdding(false)
      setNewTitle("")
      return
    }
    await createChapter.mutateAsync({ novelID: props.novelID, title })
    setNewTitle("")
    setIsAdding(false)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      void submitNewChapter()
    }
    if (e.key === "Escape") {
      setIsAdding(false)
      setNewTitle("")
    }
  }

  async function submitNewVolume() {
    const title = ui.volumeTitle.trim()
    if (!title) {
      setUi({ addingVolume: false, volumeTitle: "" })
      return
    }
    await createVolume.mutateAsync({ novelID: props.novelID, title })
    setUi({ addingVolume: false, volumeTitle: "" })
  }

  function handleVolumeKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      void submitNewVolume()
    }
    if (e.key === "Escape") setUi({ addingVolume: false, volumeTitle: "" })
  }

  async function submitRename(volumeID: string) {
    const title = ui.renameDraft.trim()
    if (title) await updateVolume.mutateAsync({ novelID: props.novelID, volumeID, title })
    setUi({ renamingId: null, renameDraft: "" })
  }

  function handleRenameKeyDown(e: KeyboardEvent, volumeID: string) {
    if (e.key === "Enter") {
      e.preventDefault()
      void submitRename(volumeID)
    }
    if (e.key === "Escape") setUi({ renamingId: null, renameDraft: "" })
  }

  return (
    <div class="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-v2-border-border-base">
        <h2 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.chapter.title")}</h2>
        <div class="flex items-center gap-2">
          <Show when={pendingCount() > 0}>
            <span class="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-v2-background-bg-accent text-v2-text-text-contrast leading-none">
              {pendingCount()}
            </span>
          </Show>
          {/* New chapter */}
          <Show
            when={isAdding()}
            fallback={
              <IconButtonV2
                onClick={() => setIsAdding(true)}
                variant="ghost-muted"
                size="small"
                type="button"
                title={language.t("novel.chapter.new")}
                icon={<span class="text-sm leading-none">+</span>}
              />
            }
          >
            <div class="w-32">
              <TextInputV2
                fluid
                type="text"
                value={newTitle()}
                onInput={(e) => setNewTitle(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => void submitNewChapter()}
                placeholder={language.t("novel.chapter.newPlaceholder")}
                autofocus
              />
            </div>
          </Show>
          {/* New volume */}
          <Show
            when={ui.addingVolume}
            fallback={
              <IconButtonV2
                onClick={() => setUi("addingVolume", true)}
                variant="ghost-muted"
                size="small"
                type="button"
                title={language.t("novel.volume.new")}
                icon={<span class="text-xs leading-none">⊞</span>}
              />
            }
          >
            <div class="w-28">
              <TextInputV2
                fluid
                type="text"
                value={ui.volumeTitle}
                onInput={(e) => setUi("volumeTitle", e.currentTarget.value)}
                onKeyDown={handleVolumeKeyDown}
                onBlur={() => void submitNewVolume()}
                placeholder={language.t("novel.volume.newPlaceholder")}
                autofocus
              />
            </div>
          </Show>
        </div>
      </div>

      {/* Search */}
      <div class="px-3 py-2 border-b border-v2-border-border-base">
        <TextInputV2
          fluid
          type="text"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder={language.t("novel.search.placeholder")}
        />
      </div>

      {/* List */}
      <div class="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Show
          when={!searching()}
          fallback={
            <Show
              when={(search.data ?? []).length > 0}
              fallback={
                <p class="px-4 py-3 text-xs text-v2-text-text-faint">
                  {search.isLoading ? language.t("novel.workspace.loading") : language.t("novel.search.noResults")}
                </p>
              }
            >
              <div class="py-1">
                <For each={search.data ?? []}>
                  {(hit) => (
                    <button
                      onClick={() => {
                        props.onSelectChapter(hit.chapterId)
                        setSearchQuery("")
                      }}
                      class="w-full text-left px-4 py-2 hover:bg-v2-overlay-simple-overlay-hover transition-colors"
                      type="button"
                    >
                      <p class="text-sm text-v2-text-text-base truncate">{hit.title}</p>
                      <p class="mt-0.5 text-xs text-v2-text-text-muted line-clamp-2">{hit.snippet}</p>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          }
        >
          <Show when={!empty()} fallback={<EmptyState />}>
            <div class="py-1">
              <For each={volumesSorted()}>
                {(volume) => {
                  const chapters = chaptersByVolume().grouped.get(volume.id) ?? []
                  return (
                    <div>
                      {/* Volume header */}
                      <div class="group relative flex items-center gap-1 px-4 py-2 text-xs font-medium text-v2-text-text-muted">
                        <Show
                          when={ui.renamingId === volume.id}
                          fallback={
                            <>
                              <span class="flex-1 truncate min-w-0">
                                {language.t("novel.chapter.volume", { number: volume.order })} · {volume.title}
                              </span>
                              <Show
                                when={ui.deletingVolumeId === volume.id}
                                fallback={
                                  <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <IconButtonV2
                                      onClick={() => setUi({ renamingId: volume.id, renameDraft: volume.title })}
                                      variant="ghost-muted"
                                      size="small"
                                      type="button"
                                      title={language.t("novel.volume.rename")}
                                      icon={<span class="text-[10px] leading-none">✎</span>}
                                    />
                                    <IconButtonV2
                                      onClick={() => setUi("deletingVolumeId", volume.id)}
                                      variant="ghost-muted"
                                      size="small"
                                      class="[&:hover>*]:text-v2-state-fg-danger"
                                      type="button"
                                      title={language.t("common.action.delete")}
                                      icon={<span class="text-[10px] leading-none">×</span>}
                                    />
                                  </div>
                                }
                              >
                                <ButtonV2
                                  onClick={() => {
                                    void deleteVolume.mutateAsync({ novelID: props.novelID, volumeID: volume.id })
                                    setUi("deletingVolumeId", null)
                                  }}
                                  variant="danger"
                                  size="small"
                                  class="shrink-0"
                                  type="button"
                                  title={language.t("novel.volume.confirmDelete")}
                                >
                                  {language.t("common.action.confirm")}
                                </ButtonV2>
                                <ButtonV2
                                  onClick={() => setUi("deletingVolumeId", null)}
                                  variant="outline"
                                  size="small"
                                  class="shrink-0"
                                  type="button"
                                >
                                  {language.t("common.action.cancel")}
                                </ButtonV2>
                              </Show>
                            </>
                          }
                        >
                          <TextInputV2
                            fluid
                            type="text"
                            value={ui.renameDraft}
                            onInput={(e) => setUi("renameDraft", e.currentTarget.value)}
                            onKeyDown={(e) => handleRenameKeyDown(e, volume.id)}
                            onBlur={() => void submitRename(volume.id)}
                            autofocus
                          />
                        </Show>
                      </div>
                      <For each={chapters}>
                        {(chapter) => (
                          <ChapterRow
                            novelID={props.novelID}
                            chapter={chapter}
                            volumes={props.volumes}
                            isSelected={props.selectedChapterId === chapter.id}
                            isDeleting={ui.deletingChapterId === chapter.id}
                            isEditing={ui.editingChapterId === chapter.id}
                            onSelect={() => props.onSelectChapter(chapter.id)}
                            onRequestDelete={() => setUi("deletingChapterId", chapter.id)}
                            onCancelDelete={() => setUi("deletingChapterId", null)}
                            onConfirmDelete={() => {
                              void deleteChapter.mutateAsync({ novelID: props.novelID, chapterID: chapter.id })
                              setUi("deletingChapterId", null)
                            }}
                            onRequestEdit={() => setUi("editingChapterId", chapter.id)}
                            onCancelEdit={() => setUi("editingChapterId", null)}
                          />
                        )}
                      </For>
                    </div>
                  )
                }}
              </For>

              {/* Ungrouped chapters (no volumeId) */}
              <Show when={chaptersByVolume().ungrouped.length > 0}>
                <div class="px-4 py-2 text-xs font-medium text-v2-text-text-muted">
                  {language.t("novel.chapter.title")}
                </div>
                <For each={chaptersByVolume().ungrouped}>
                  {(chapter) => (
                    <ChapterRow
                      novelID={props.novelID}
                      chapter={chapter}
                      volumes={props.volumes}
                      isSelected={props.selectedChapterId === chapter.id}
                      isDeleting={ui.deletingChapterId === chapter.id}
                      isEditing={ui.editingChapterId === chapter.id}
                      onSelect={() => props.onSelectChapter(chapter.id)}
                      onRequestDelete={() => setUi("deletingChapterId", chapter.id)}
                      onCancelDelete={() => setUi("deletingChapterId", null)}
                      onConfirmDelete={() => {
                        void deleteChapter.mutateAsync({ novelID: props.novelID, chapterID: chapter.id })
                        setUi("deletingChapterId", null)
                      }}
                      onRequestEdit={() => setUi("editingChapterId", chapter.id)}
                      onCancelEdit={() => setUi("editingChapterId", null)}
                    />
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </Show>
      </div>

      <Show when={pendingCount() > 0}>
        <div class="px-4 py-2 text-xs text-v2-text-text-muted border-t border-v2-border-border-base">
          {language.t("novel.approval.pending")}: {pendingCount()}
        </div>
      </Show>
    </div>
  )
}

// ─── Chapter row ───

function ChapterRow(props: {
  novelID: string
  chapter: ServerNovelChaptersOutput[number]
  volumes: ServerNovelVolumesOutput
  isSelected: boolean
  isDeleting: boolean
  isEditing: boolean
  onSelect: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onRequestEdit: () => void
  onCancelEdit: () => void
}) {
  const language = useLanguage()
  const moveChapter = useMoveChapter()
  const updateChapter = useUpdateChapter()
  const [editTitle, setEditTitle] = createSignal(props.chapter.title)
  const [editStatus, setEditStatus] = createSignal(props.chapter.status)
  const [editVolumeId, setEditVolumeId] = createSignal(props.chapter.volumeId ?? "")

  const STATUSES = [
    "planned",
    "draft",
    "outline",
    "drafting",
    "audited",
    "revised",
    "pending_review",
    "final",
    "rejected",
    "published",
    "failed",
  ]

  const volumeOptions = createMemo(() => [{ id: "", title: language.t("novel.chapter.ungrouped") }, ...props.volumes])

  function move(action: "up" | "down") {
    void moveChapter.mutateAsync({ novelID: props.novelID, chapterID: props.chapter.id, action })
  }

  async function saveEdit() {
    const title = editTitle().trim()
    if (title && (title !== props.chapter.title || editStatus() !== props.chapter.status)) {
      await updateChapter.mutateAsync({
        novelID: props.novelID,
        chapterID: props.chapter.id,
        title,
        status: editStatus(),
      })
    }
    const targetVolume = editVolumeId()
    if (targetVolume !== (props.chapter.volumeId ?? "")) {
      await moveChapter.mutateAsync({
        novelID: props.novelID,
        chapterID: props.chapter.id,
        action: "to-volume",
        volumeId: targetVolume || undefined,
      })
    }
    props.onCancelEdit()
  }

  return (
    <div
      class={`group relative w-full text-left text-sm transition-colors hover:bg-v2-overlay-simple-overlay-hover ${
        props.isSelected ? "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base" : "text-v2-text-text-muted"
      }`}
    >
      <div
        class="flex items-center gap-2 px-4 py-2 cursor-pointer"
        onClick={props.onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") props.onSelect()
        }}
      >
        {/* Status dot */}
        <span
          class={`shrink-0 w-2 h-2 rounded-full ${statusDotColor(props.chapter.status)}`}
          title={language.t(`novel.chapter.status.${props.chapter.status}`)}
        />

        {/* Order number */}
        <span class="shrink-0 w-5 text-right text-xs tabular-nums text-v2-text-text-faint">{props.chapter.order}</span>

        {/* Title */}
        <span class="flex-1 truncate min-w-0">{props.chapter.title}</span>

        <Show
          when={props.isDeleting}
          fallback={
            <>
              {/* Word count */}
              <span class="shrink-0 text-xs tabular-nums text-v2-text-text-faint group-hover:opacity-0">
                {language.t("novel.chapter.wordCount", { count: props.chapter.wordCount })}
              </span>
              {/* Hover actions: absolutely positioned so they don't squeeze the title */}
              <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Reorder */}
                <IconButtonV2
                  onClick={(e) => {
                    e.stopPropagation()
                    move("up")
                  }}
                  variant="ghost-muted"
                  size="small"
                  type="button"
                  title={language.t("novel.chapter.moveUp")}
                  icon={<span class="text-[10px] leading-none">↑</span>}
                />
                <IconButtonV2
                  onClick={(e) => {
                    e.stopPropagation()
                    move("down")
                  }}
                  variant="ghost-muted"
                  size="small"
                  type="button"
                  title={language.t("novel.chapter.moveDown")}
                  icon={<span class="text-[10px] leading-none">↓</span>}
                />
                {/* Edit */}
                <IconButtonV2
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditTitle(props.chapter.title)
                    setEditStatus(props.chapter.status)
                    setEditVolumeId(props.chapter.volumeId ?? "")
                    props.onRequestEdit()
                  }}
                  variant="ghost-muted"
                  size="small"
                  type="button"
                  title={language.t("novel.chapter.edit")}
                  icon={<span class="text-[10px] leading-none">✎</span>}
                />
                {/* Delete */}
                <IconButtonV2
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onRequestDelete()
                  }}
                  variant="ghost-muted"
                  size="small"
                  class="[&:hover>*]:text-v2-state-fg-danger"
                  type="button"
                  title={language.t("novel.chapter.confirmDelete")}
                  icon={<span class="text-[10px] leading-none">×</span>}
                />
              </div>
            </>
          }
        >
          <ButtonV2
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              props.onConfirmDelete()
            }}
            variant="danger"
            size="small"
            class="shrink-0"
            type="button"
          >
            {language.t("common.action.confirm")}
          </ButtonV2>
          <ButtonV2
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              props.onCancelDelete()
            }}
            variant="outline"
            size="small"
            class="shrink-0"
            type="button"
          >
            {language.t("common.action.cancel")}
          </ButtonV2>
        </Show>
      </div>

      {/* Edit row */}
      <Show when={props.isEditing}>
        <div class="px-4 pb-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <TextInputV2
            fluid
            type="text"
            value={editTitle()}
            onInput={(e) => setEditTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveEdit()
              if (e.key === "Escape") props.onCancelEdit()
            }}
          />
          <div class="flex items-center gap-1.5">
            <SelectV2
              options={STATUSES}
              current={editStatus()}
              label={(s) => language.t(`novel.chapter.status.${s}`)}
              onSelect={(s) => {
                if (s) setEditStatus(s)
              }}
              class="flex-1 min-w-0"
            />
            <SelectV2
              options={volumeOptions()}
              current={volumeOptions().find((v) => v.id === editVolumeId())}
              value={(v) => v.id}
              label={(v) => v.title}
              onSelect={(v) => setEditVolumeId(v?.id ?? "")}
              class="flex-1 min-w-0"
            />
          </div>
          <div class="flex items-center gap-1.5">
            <ButtonV2
              onClick={() => void saveEdit()}
              disabled={updateChapter.isPending || moveChapter.isPending}
              variant="contrast"
              size="small"
              type="button"
            >
              {language.t("common.action.save")}
            </ButtonV2>
            <ButtonV2 onClick={props.onCancelEdit} variant="outline" size="small" type="button">
              {language.t("common.action.cancel")}
            </ButtonV2>
          </div>
        </div>
      </Show>
    </div>
  )
}

// ─── Empty state ───

function EmptyState() {
  const language = useLanguage()
  return (
    <div class="flex flex-col items-center justify-center h-full px-6 text-center">
      <p class="text-sm text-v2-text-text-faint">{language.t("novel.chapter.empty")}</p>
    </div>
  )
}
