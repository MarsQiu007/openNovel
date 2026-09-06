import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useChapterDetail, useAnnotations, useCreateAnnotation } from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Tag, type TagProps } from "@opennovel-ai/ui/v2/badge-v2"
import type { ServerNovelChaptersOutput } from "@opennovel-ai/client"
import { segmentParagraph, getSelectionAnchor, hasOverlap, type AnnotationLike } from "./annotation-utils"

// ─── Status badge helpers ───

const STATUS_BADGE: Record<string, NonNullable<TagProps["variant"]>> = {
  planned: "info",
  drafting: "info",
  audited: "warning",
  revised: "info",
  final: "success",
  rejected: "danger",
  pending_review: "info",
  draft: "info",
  outline: "info",
  failed: "danger",
  published: "success",
}

const STATUS_LABEL_KEY: Record<string, string> = {
  planned: "novel.chapter.status.planned",
  drafting: "novel.chapter.status.drafting",
  audited: "novel.chapter.status.audited",
  revised: "novel.chapter.status.revised",
  final: "novel.chapter.status.final",
  rejected: "novel.chapter.status.rejected",
  pending_review: "novel.chapter.status.pending_review",
  draft: "novel.chapter.status.draft",
  outline: "novel.chapter.status.outline",
  failed: "novel.chapter.status.failed",
  published: "novel.chapter.status.published",
}

// ─── Props ───

type ChapterReaderProps = {
  novelID: string
  chapters: ServerNovelChaptersOutput
  selectedChapterId: string | null
  onSelectChapter: (id: string) => void
}

// ─── Constants ───

const SEGMENT_SIZE = 50
const LONG_CONTENT_THRESHOLD = 20000

// ─── Component ───

export default function ChapterReader(props: ChapterReaderProps) {
  const language = useLanguage()

  // Current chapter index for navigation
  const currentIndex = createMemo(() => {
    if (!props.selectedChapterId) return -1
    return props.chapters.findIndex((ch) => ch.id === props.selectedChapterId)
  })

  const hasPrev = () => currentIndex() > 0
  const hasNext = () => currentIndex() < props.chapters.length - 1

  // Fetch chapter detail
  const chapterID = () => props.selectedChapterId ?? ""
  const chapterQuery = useChapterDetail(() => props.novelID, chapterID)

  // Annotation state
  const annotationsQuery = useAnnotations(() => props.novelID, chapterID)
  const createAnnotation = useCreateAnnotation()
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number } | null>(null)
  const [showForm, setShowForm] = createSignal(false)
  const [pendingAnchor, setPendingAnchor] = createSignal<ReturnType<typeof getSelectionAnchor> | null>(null)
  const [comment, setComment] = createSignal("")
  const [replacement, setReplacement] = createSignal("")
  const [overlapMsg, setOverlapMsg] = createSignal("")

  const paragraphAnnotations = createMemo(() => {
    const all = annotationsQuery.data ?? []
    const byIndex = new Map<number, AnnotationLike[]>()
    for (const a of all) {
      if (a.paragraphIndex == null) continue
      const list = byIndex.get(a.paragraphIndex) ?? []
      list.push(a)
      byIndex.set(a.paragraphIndex, list)
    }
    return byIndex
  })

  function handleContextMenu(e: MouseEvent) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
    const target = (e.target as HTMLElement).closest("p[data-paragraph-index]")
    if (!target) return
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  function startAddAnnotation() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    let pNode: HTMLElement | null = range.startContainer as HTMLElement
    if (pNode?.nodeType === Node.TEXT_NODE) pNode = pNode.parentElement
    while (pNode && !pNode.hasAttribute("data-paragraph-index")) pNode = pNode.parentElement
    if (!pNode) return
    const idx = parseInt(pNode.getAttribute("data-paragraph-index") ?? "-1", 10)
    if (idx < 0) return

    const anchor = getSelectionAnchor(pNode, idx, sel)
    const existing = (paragraphAnnotations().get(idx) ?? []).filter(
      (a) => a.status === "open" && a.startOffset != null && a.endOffset != null,
    )
    const isOverlap = existing.some((a) => hasOverlap({ start: anchor.startOffset, end: anchor.endOffset }, { start: a.startOffset ?? 0, end: a.endOffset ?? 0 }))
    if (isOverlap) {
      setOverlapMsg(language.t("novel.reader.annotationOverlap"))
      setMenuPos(null)
      setTimeout(() => setOverlapMsg(""), 3000)
      return
    }
    setPendingAnchor(anchor)
    setComment("")
    setReplacement("")
    setShowForm(true)
    setMenuPos(null)
  }

  function confirmAddAnnotation() {
    const anchor = pendingAnchor()
    if (!anchor || !comment().trim()) return
    createAnnotation.mutate({
      novelID: props.novelID,
      chapterID: props.selectedChapterId ?? "",
      source: "user",
      anchorType: "range",
      paragraphIndex: anchor.paragraphIndex,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quote: anchor.quote,
      comment: comment().trim(),
      suggestedReplacement: replacement().trim() || undefined,
    })
    setShowForm(false)
    setPendingAnchor(null)
  }

  function cancelAddAnnotation() {
    setShowForm(false)
    setPendingAnchor(null)
  }

  // Paragraphs from content
  const paragraphs = createMemo(() => {
    const content = chapterQuery.data?.content ?? ""
    return content.split(/\n\n+/).filter(Boolean)
  })

  // Lazy loading state for long content
  const [shownParagraphs, setShownParagraphs] = createSignal(SEGMENT_SIZE)

  // Reset lazy loading when chapter changes
  createEffect(() => {
    props.selectedChapterId
    setShownParagraphs(SEGMENT_SIZE)
  })

  const isLongContent = () => {
    const content = chapterQuery.data?.content
    return !!content && content.length > LONG_CONTENT_THRESHOLD
  }

  const visibleParagraphs = createMemo(() => {
    const all = paragraphs()
    if (!isLongContent()) return all
    return all.slice(0, shownParagraphs())
  })

  const hasMoreParagraphs = () => {
    return isLongContent() && shownParagraphs() < paragraphs().length
  }

  // IntersectionObserver sentinel for loading more paragraphs
  let sentinelEl: HTMLDivElement | undefined

  createEffect(() => {
    const el = sentinelEl
    if (!el || !hasMoreParagraphs()) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShownParagraphs((prev) => prev + SEGMENT_SIZE)
        }
      },
      { rootMargin: "200px" },
    )

    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  return (
    <Show
      when={!!props.selectedChapterId}
      fallback={
        <div class="flex flex-col items-center justify-center flex-1 min-h-0 px-6 text-center">
          <p class="text-sm text-v2-text-text-faint">{language.t("novel.reader.empty")}</p>
        </div>
      }
    >
      <Show
        when={!chapterQuery.isLoading}
        fallback={
          <div class="flex flex-col items-center justify-center flex-1 min-h-0">
            <Spinner />
          </div>
        }
      >
        <Show
          when={!chapterQuery.isError}
          fallback={
            <div class="flex flex-col items-center justify-center flex-1 min-h-0 px-6 text-center">
              <p class="text-sm text-v2-state-fg-danger">
                {chapterQuery.error instanceof Error ? chapterQuery.error.message : String(chapterQuery.error)}
              </p>
            </div>
          }
        >
          <div class="flex flex-col h-full">
            {/* Header bar */}
            <div class="flex items-center justify-between px-6 py-3 border-b border-v2-border-border-base shrink-0">
              <div class="flex items-center gap-3 min-w-0">
                <h2 class="text-lg font-semibold text-v2-text-text-base truncate">{chapterQuery.data?.title}</h2>
                <Show when={chapterQuery.data?.status}>
                  <Tag variant={STATUS_BADGE[chapterQuery.data?.status ?? ""] ?? "info"}>
                    {language.t(STATUS_LABEL_KEY[chapterQuery.data?.status ?? ""] ?? "novel.chapter.status.none")}
                  </Tag>
                </Show>
              </div>
              <span class="shrink-0 text-xs tabular-nums text-v2-text-text-faint">
                {language.t("novel.reader.wordCount", { count: chapterQuery.data?.wordCount ?? 0 })}
              </span>
            </div>

            {/* Reading content */}
            <div class="flex-1 min-h-0 overflow-y-auto">
              <div class="novel-reading px-6 py-8" onContextMenu={handleContextMenu}>
                <For each={visibleParagraphs()}>
                  {(paragraph, idx) => (
                    <p data-paragraph-index={idx()}>
                      <For each={segmentParagraph(paragraph, paragraphAnnotations().get(idx()) ?? [])}>
                        {(seg) => (
                          <Show when={seg.annotation} fallback={seg.text}>
                            <span
                              class={seg.annotation!.status === "open" ? "annotation-open" : "annotation-done"}
                              title={seg.annotation!.comment}
                            >
                              {seg.text}
                            </span>
                          </Show>
                        )}
                      </For>
                    </p>
                  )}
                </For>

                {/* Sentinel for lazy loading */}
                <Show when={hasMoreParagraphs()}>
                  <div ref={sentinelEl} class="flex justify-center py-4">
                    <Spinner />
                  </div>
                </Show>
              </div>
            </div>

            {/* Right-click context menu */}
            <Show when={menuPos()}>
              <div
                class="fixed z-50 bg-v2-background-bg-layer-01 border border-v2-border-border-base rounded shadow-lg py-1 min-w-[120px]"
                style={{ left: `${menuPos()!.x}px`, top: `${menuPos()!.y}px` }}
              >
                <button
                  class="block w-full text-left px-3 py-1.5 text-sm text-v2-text-text-base hover:bg-v2-background-bg-layer-02"
                  onClick={startAddAnnotation}
                >
                  {language.t("novel.reader.addAnnotation")}
                </button>
              </div>
            </Show>
            <Show when={overlapMsg()}>
              <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-v2-state-bg-warning text-v2-state-fg-warning px-4 py-2 rounded text-sm shadow-lg">
                {overlapMsg()}
              </div>
            </Show>
            <Show when={showForm() && pendingAnchor()}>
              <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={cancelAddAnnotation}>
                <div class="bg-v2-background-bg-layer-01 border border-v2-border-border-base rounded-lg p-4 w-80 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                  <h4 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.reader.addAnnotation")}</h4>
                  <p class="text-xs text-v2-text-text-faint truncate">{pendingAnchor()!.quote}</p>
                  <textarea
                    class="w-full rounded border border-v2-border-border-base bg-v2-background-bg-base p-2 text-sm text-v2-text-text-base resize-none"
                    rows={3}
                    placeholder={language.t("novel.reader.annotationComment")}
                    value={comment()}
                    onInput={(e) => setComment(e.currentTarget.value)}
                  />
                  <input
                    class="w-full rounded border border-v2-border-border-base bg-v2-background-bg-base p-2 text-sm text-v2-text-text-base"
                    placeholder={language.t("novel.reader.annotationSuggestion")}
                    value={replacement()}
                    onInput={(e) => setReplacement(e.currentTarget.value)}
                  />
                  <div class="flex gap-2 justify-end">
                    <ButtonV2 size="small" variant="ghost" onClick={cancelAddAnnotation}>
                      {language.t("common.cancel")}
                    </ButtonV2>
                    <ButtonV2 size="small" variant="contrast" disabled={!comment().trim()} onClick={confirmAddAnnotation}>
                      {language.t("common.confirm")}
                    </ButtonV2>
                  </div>
                </div>
              </div>
            </Show>

            {/* Navigation footer */}
            <div class="flex items-center justify-between px-6 py-3 border-t border-v2-border-border-base shrink-0">
              <ButtonV2
                type="button"
                variant="neutral"
                size="normal"
                disabled={!hasPrev()}
                onClick={() => {
                  const idx = currentIndex()
                  if (idx > 0) props.onSelectChapter(props.chapters[idx - 1].id)
                }}
              >
                {language.t("novel.reader.prev")}
              </ButtonV2>

              <span class="text-xs text-v2-text-text-faint">
                {currentIndex() >= 0 ? `${currentIndex() + 1} / ${props.chapters.length}` : ""}
              </span>

              <ButtonV2
                type="button"
                variant="neutral"
                size="normal"
                disabled={!hasNext()}
                onClick={() => {
                  const idx = currentIndex()
                  if (idx < props.chapters.length - 1) props.onSelectChapter(props.chapters[idx + 1].id)
                }}
              >
                {language.t("novel.reader.next")}
              </ButtonV2>
            </div>
          </div>
        </Show>
      </Show>
    </Show>
  )
}
