import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useChapterDetail } from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Tag, type TagProps } from "@opennovel-ai/ui/v2/badge-v2"
import type { ServerNovelChaptersOutput } from "@opennovel-ai/client"

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
              <div class="novel-reading px-6 py-8">
                <For each={visibleParagraphs()}>{(paragraph) => <p>{paragraph}</p>}</For>

                {/* Sentinel for lazy loading */}
                <Show when={hasMoreParagraphs()}>
                  <div ref={sentinelEl} class="flex justify-center py-4">
                    <Spinner />
                  </div>
                </Show>
              </div>
            </div>

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
