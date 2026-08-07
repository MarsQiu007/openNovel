import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useConfirmDelete } from "./confirm-dialog"
import { useCreateTensionPoint, useDeleteTensionPoint, useTension } from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"

type Props = {
  novelID: Accessor<string>
  selectedChapterId: Accessor<string | null>
  chapters: ReadonlyArray<{ id: string; order: number; title: string }>
}

const WIDTH = 320
const HEIGHT = 180
const PAD_TOP = 16
const PAD_RIGHT = 16
const PAD_BOTTOM = 24
const PAD_LEFT = 28
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM

function toX(chapter: number, min: number, max: number) {
  if (max === min) return PAD_LEFT + PLOT_W / 2
  return PAD_LEFT + ((chapter - min) / (max - min)) * PLOT_W
}

function toY(level: number) {
  return PAD_TOP + (1 - level / 10) * PLOT_H
}

export function TensionChart(props: Props) {
  const language = useLanguage()
  const tension = useTension(props.novelID)
  const createTension = useCreateTensionPoint()
  const deleteTension = useDeleteTensionPoint()
  const confirmDelete = useConfirmDelete()
  const [selectedPoint, setSelectedPoint] = createSignal<{ id: string; x: number; y: number } | null>(null)
  const [form, setForm] = createStore({ chapterNumber: "", level: "" })
  const [hovered, setHovered] = createSignal<{
    id: string
    chapter: number
    level: number
    x: number
    y: number
  } | null>(null)

  const sorted = createMemo(() => {
    const d = tension.data
    if (!d || d.length === 0) return []
    return [...d].sort((a, b) => a.chapterNumber - b.chapterNumber)
  })

  const minChapter = createMemo(() => {
    const s = sorted()
    return s.length > 0 ? s[0].chapterNumber : 0
  })

  const maxChapter = createMemo(() => {
    const s = sorted()
    return s.length > 0 ? s[s.length - 1].chapterNumber : 0
  })

  const points = createMemo(() => {
    return sorted().map((p) => ({
      id: p.id,
      chapter: p.chapterNumber,
      level: p.level,
      x: toX(p.chapterNumber, minChapter(), maxChapter()),
      y: toY(p.level),
    }))
  })

  const polylinePoints = createMemo(() => {
    return points()
      .map((p) => `${p.x},${p.y}`)
      .join(" ")
  })

  const currentChapterPoint = createMemo(() => {
    const id = props.selectedChapterId()
    if (!id) return null
    const order = props.chapters.find((c) => c.id === id)?.order
    if (order == null) return null
    return points().find((p) => p.chapter === order) ?? null
  })

  // Last 20 chapters window
  const windowBounds = createMemo(() => {
    const p = points()
    if (p.length === 0) return null
    const start = Math.max(0, p.length - 20)
    const slice = p.slice(start)
    return {
      x1: slice[0].x - 4,
      x2: slice[slice.length - 1].x + 4,
    }
  })

  // Y-axis grid lines (0, 2, 4, 6, 8, 10)
  const yGrid = [0, 2, 4, 6, 8, 10]

  const handleAdd = async (e: Event) => {
    e.preventDefault()
    const chapterNumber = Number(form.chapterNumber)
    const level = Number(form.level)
    if (form.chapterNumber === "" || form.level === "") return
    if (Number.isNaN(chapterNumber) || Number.isNaN(level)) return
    await createTension.mutateAsync({ novelID: props.novelID(), chapterNumber, level })
    setForm("chapterNumber", "")
    setForm("level", "")
  }

  const handleDelete = (pointID: string) => {
    confirmDelete({
      title: language.t("novel.panel.tension.delete"),
      message: language.t("novel.panel.tension.deleteConfirm"),
      onConfirm: async () => {
        await deleteTension.mutateAsync({ novelID: props.novelID(), pointID })
        setSelectedPoint(null)
        setHovered(null)
      },
    })
  }

  return (
    <Show
      when={!tension.isLoading}
      fallback={
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-6 h-6 text-v2-text-text-muted" />
        </div>
      }
    >
      <div class="px-4 py-4">
        <h2 class="text-base font-semibold text-v2-text-text-base mb-3">{language.t("novel.panel.tension")}</h2>

        <Show
          when={points().length > 0}
          fallback={
            <div class="py-6 text-sm text-v2-text-text-muted text-center">
              {language.t("novel.panel.tension.empty")}
            </div>
          }
        >
          <div class="relative" style={{ width: `${WIDTH}px` }}>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} class="w-full" style={{ height: `${HEIGHT}px` }}>
              {/* Y-axis grid lines */}
              <For each={yGrid}>
                {(level) => {
                  const y = toY(level)
                  return (
                    <g>
                      <line
                        x1={PAD_LEFT}
                        y1={y}
                        x2={WIDTH - PAD_RIGHT}
                        y2={y}
                        stroke="var(--v2-border-border-muted)"
                        stroke-width="0.5"
                      />
                      <text x={PAD_LEFT - 6} y={y + 3} text-anchor="end" class="fill-v2-text-text-faint" font-size="10">
                        {level}
                      </text>
                    </g>
                  )
                }}
              </For>

              {/* Last 20 chapters highlight */}
              {windowBounds() && (
                <rect
                  x={windowBounds()!.x1}
                  y={PAD_TOP}
                  width={windowBounds()!.x2 - windowBounds()!.x1}
                  height={PLOT_H}
                  fill="var(--v2-text-text-accent)"
                  fill-opacity="0.06"
                  rx="3"
                />
              )}

              {/* Line */}
              <polyline
                points={polylinePoints()}
                fill="none"
                stroke="var(--v2-text-text-accent)"
                stroke-width="1.5"
                stroke-linejoin="round"
                stroke-linecap="round"
              />

              {/* Selected chapter marker */}
              {currentChapterPoint() && (
                <>
                  <line
                    x1={currentChapterPoint()!.x}
                    y1={PAD_TOP}
                    x2={currentChapterPoint()!.x}
                    y2={PAD_TOP + PLOT_H}
                    stroke="var(--v2-state-fg-warning)"
                    stroke-width="1"
                    stroke-dasharray="3,3"
                  />
                  <circle
                    cx={currentChapterPoint()!.x}
                    cy={currentChapterPoint()!.y}
                    r="5"
                    fill="none"
                    stroke="var(--v2-state-fg-warning)"
                    stroke-width="2"
                  />
                </>
              )}

              {/* Data points */}
              <For each={points()}>
                {(p) => (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="3"
                    fill="var(--v2-text-text-accent)"
                    stroke="var(--v2-background-bg-layer-01)"
                    stroke-width="1"
                    class="cursor-pointer"
                    onMouseEnter={() => setHovered(p)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelectedPoint({ id: p.id, x: p.x, y: p.y })}
                  >
                    <title>{`#${p.chapter} — ${p.level}/10`}</title>
                  </circle>
                )}
              </For>
            </svg>

            {/* Tooltip */}
            {hovered() && (
              <div
                class="absolute pointer-events-none px-2 py-1 rounded bg-v2-background-bg-layer-03 border border-v2-border-border-base text-xs text-v2-text-text-base whitespace-nowrap"
                style={{
                  left: `${hovered()!.x}px`,
                  top: `${hovered()!.y - 10}px`,
                  transform: "translate(-50%, -100%)",
                }}
              >
                {`#${hovered()!.chapter} — ${hovered()!.level}/10`}
              </div>
            )}
            {selectedPoint() && (
              <div
                class="absolute px-2 py-1 rounded bg-v2-background-bg-layer-03 border border-v2-border-border-base text-xs whitespace-nowrap"
                style={{
                  left: `${selectedPoint()!.x}px`,
                  top: `${selectedPoint()!.y + 8}px`,
                  transform: "translate(-50%, 0)",
                }}
              >
                <ButtonV2 variant="danger" size="small" onClick={() => handleDelete(selectedPoint()!.id)}>
                  {language.t("novel.panel.tension.delete")}
                </ButtonV2>
              </div>
            )}
          </div>
        </Show>
        <form class="mt-3 flex items-center gap-2" onSubmit={handleAdd}>
          <div class="w-20">
            <TextInputV2
              fluid
              type="number"
              placeholder={language.t("novel.panel.tension.chapterNumber")}
              value={form.chapterNumber}
              onInput={(e) => setForm("chapterNumber", e.currentTarget.value)}
            />
          </div>
          <div class="w-16">
            <TextInputV2
              fluid
              type="number"
              min="0"
              max="10"
              placeholder={language.t("novel.panel.tension.level")}
              value={form.level}
              onInput={(e) => setForm("level", e.currentTarget.value)}
            />
          </div>
          <ButtonV2 type="submit" variant="contrast" size="small">
            {language.t("novel.panel.tension.add")}
          </ButtonV2>
        </form>
      </div>
    </Show>
  )
}
