import { Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useCanvasLayout, useStructure, useUpsertCanvasLayout } from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"

type CanvasPanelProps = {
  novelID: Accessor<string>
}

type LocalColumn = { id: string; x: number; width: number }
type LocalCard = { id: string; x: number; y: number; columnId: string | null }
type LocalLayout = { columns: LocalColumn[]; cards: LocalCard[] }

const COLUMN_WIDTH = 240
const COLUMN_GAP = 16
const CARD_HEIGHT = 72
const CARD_GAP = 8
const CARD_WIDTH = COLUMN_WIDTH

type VolumeLike = { id: string; order: number; title: string }
type ChapterLike = { id: string; order: number; title: string; volumeId?: string | null; status?: string }

function buildDefaultLayout(volumes: readonly VolumeLike[], chapters: readonly ChapterLike[]): LocalLayout {
  const sortedVolumes = [...volumes].sort((a, b) => a.order - b.order)
  const columns: LocalColumn[] = sortedVolumes.map((v, i) => ({
    id: v.id,
    x: i * (COLUMN_WIDTH + COLUMN_GAP),
    width: COLUMN_WIDTH,
  }))
  const cards: LocalCard[] = []
  for (const col of columns) {
    const colChapters = chapters.filter((c) => c.volumeId === col.id).sort((a, b) => a.order - b.order)
    colChapters.forEach((ch, i) => {
      cards.push({ id: ch.id, x: col.x, y: i * (CARD_HEIGHT + CARD_GAP), columnId: col.id })
    })
  }
  const unassigned = chapters.filter((c) => c.volumeId == null).sort((a, b) => a.order - b.order)
  const freeX = columns.length * (COLUMN_WIDTH + COLUMN_GAP)
  unassigned.forEach((ch, i) => {
    cards.push({ id: ch.id, x: freeX, y: i * (CARD_HEIGHT + CARD_GAP), columnId: null })
  })
  return { columns, cards }
}

// 把已保存布局与当前卷/章合并，补齐新增卷和章节，不丢弃用户已调整的坐标。
function mergeLayout(saved: LocalLayout | null | undefined, volumes: readonly VolumeLike[], chapters: readonly ChapterLike[]): LocalLayout {
  if (!saved || saved.columns.length === 0) return buildDefaultLayout(volumes, chapters)
  const columns = [...saved.columns]
  const knownColumnIds = new Set(columns.map((c) => c.id))
  let nextX = columns.reduce((m, c) => Math.max(m, c.x + c.width + COLUMN_GAP), 0)
  for (const v of [...volumes].sort((a, b) => a.order - b.order)) {
    if (knownColumnIds.has(v.id)) continue
    columns.push({ id: v.id, x: nextX, width: COLUMN_WIDTH })
    nextX += COLUMN_WIDTH + COLUMN_GAP
    knownColumnIds.add(v.id)
  }
  const cards = [...saved.cards]
  const knownCardIds = new Set(cards.map((c) => c.id))
  const bottomY = new Map<string, number>()
  for (const c of cards) {
    if (c.columnId) bottomY.set(c.columnId, Math.max(bottomY.get(c.columnId) ?? 0, c.y + CARD_HEIGHT + CARD_GAP))
  }
  let freeY = 0
  for (const ch of [...chapters].sort((a, b) => a.order - b.order)) {
    if (knownCardIds.has(ch.id)) continue
    const colId = ch.volumeId && knownColumnIds.has(ch.volumeId) ? ch.volumeId : null
    const column = colId ? columns.find((c) => c.id === colId) : null
    const x = column ? column.x : columns.length * (COLUMN_WIDTH + COLUMN_GAP)
    const y = colId ? (bottomY.get(colId) ?? 0) : freeY
    cards.push({ id: ch.id, x, y, columnId: colId })
    if (colId) bottomY.set(colId, y + CARD_HEIGHT + CARD_GAP)
    else freeY += CARD_HEIGHT + CARD_GAP
  }
  return { columns, cards }
}

export default function CanvasPanel(props: CanvasPanelProps) {
  const language = useLanguage()
  const structure = useStructure(props.novelID)
  const canvas = useCanvasLayout(props.novelID)
  const upsert = useUpsertCanvasLayout()

  const [layout, setLayout] = createStore<LocalLayout>({ columns: [], cards: [] })
  const [dragging, setDragging] = createSignal<string | null>(null)

  const volumes = createMemo<readonly VolumeLike[]>(() => structure.data?.volumes ?? [])
  const chapters = createMemo<readonly ChapterLike[]>(() => structure.data?.chapters ?? [])

  const volumeTitle = createMemo(() => {
    const map = new Map<string, string>()
    for (const v of volumes()) map.set(v.id, v.title)
    return map
  })

  const chapterMap = createMemo(() => {
    const map = new Map<string, ChapterLike>()
    for (const c of chapters()) map.set(c.id, c)
    return map
  })

  // 数据到达或外部刷新时合并；拖拽中不覆盖本地坐标。
  createEffect(() => {
    if (dragging()) return
    if (!structure.data) return
    setLayout(mergeLayout(canvas.data as LocalLayout | null, volumes(), chapters()))
  })

  const surfaceWidth = createMemo(() => {
    const maxX = Math.max(
      0,
      ...layout.columns.map((c) => c.x + c.width),
      ...layout.cards.map((c) => c.x + CARD_WIDTH),
    )
    return maxX + 24
  })

  const surfaceHeight = createMemo(() => {
    const maxY = Math.max(0, ...layout.cards.map((c) => c.y + CARD_HEIGHT))
    return Math.max(maxY + 24, 320)
  })

  function persist() {
    upsert.mutate({
      novelID: props.novelID(),
      layout: { columns: layout.columns.map((c) => ({ ...c })), cards: layout.cards.map((c) => ({ ...c })) },
    })
  }

  function resetLayout() {
    const fresh = buildDefaultLayout(volumes(), chapters())
    setLayout(fresh)
    upsert.mutate({ novelID: props.novelID(), layout: fresh })
  }

  function onCardPointerDown(event: PointerEvent, card: LocalCard) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const origX = card.x
    const origY = card.y
    setDragging(card.id)
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture?.(event.pointerId)

    const onMove = (ev: PointerEvent) => {
      setLayout(
        "cards",
        produce((cards: LocalCard[]) => {
          const target = cards.find((c) => c.id === card.id)
          if (!target) return
          target.x = origX + (ev.clientX - startX)
          target.y = Math.max(0, origY + (ev.clientY - startY))
        }),
      )
    }
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture?.(ev.pointerId)
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onUp)
      setDragging(null)
      persist()
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", onUp)
  }

  return (
    <div class="flex flex-col gap-2 p-3 h-full min-h-0">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.canvas.title")}</h3>
        <ButtonV2 size="small" variant="outline" onClick={resetLayout} loading={upsert.isPending}>
          {language.t("novel.canvas.reset")}
        </ButtonV2>
      </div>
      <Show when={!structure.isLoading} fallback={<Spinner />}>
        <div class="relative flex-1 min-h-0 overflow-auto rounded border border-v2-border-border-base bg-v2-background-bg-layer-01/40">
          <div class="relative" style={{ width: `${surfaceWidth()}px`, height: `${surfaceHeight()}px` }}>
            <For each={layout.columns}>
              {(col) => (
                <div
                  class="absolute top-0 bottom-0 rounded border border-v2-border-border-base bg-v2-background-bg-base/40"
                  style={{ left: `${col.x}px`, width: `${col.width}px` }}
                >
                  <div class="px-2 py-1 text-xs font-medium text-v2-text-text-faint border-b border-v2-border-border-base truncate">
                    {volumeTitle().get(col.id) ?? col.id}
                  </div>
                </div>
              )}
            </For>
            <For each={layout.cards}>
              {(card) => {
                const chapter = createMemo(() => chapterMap().get(card.id))
                return (
                  <div
                    class="absolute rounded border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1.5 shadow-sm select-none"
                    style={{
                      left: `${card.x}px`,
                      top: `${card.y}px`,
                      width: `${CARD_WIDTH}px`,
                      height: `${CARD_HEIGHT}px`,
                      cursor: dragging() === card.id ? "grabbing" : "grab",
                      "touch-action": "none",
                    }}
                    onPointerDown={(e) => onCardPointerDown(e, card)}
                  >
                    <Show when={chapter()} fallback={<span class="text-xs text-v2-text-text-faint">{card.id}</span>}>
                      {(ch) => (
                        <>
                          <div class="flex items-center gap-1 text-[10px] text-v2-text-text-faint">
                            <span>{language.t("novel.chapter.label", { order: ch().order + 1 })}</span>
                            <Show when={ch().status === "published"}>
                              <span class="text-v2-state-fg-success">{language.t("novel.common.completed")}</span>
                            </Show>
                          </div>
                          <div class="text-xs text-v2-text-text-base line-clamp-2 leading-tight mt-0.5">{ch().title}</div>
                        </>
                      )}
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
