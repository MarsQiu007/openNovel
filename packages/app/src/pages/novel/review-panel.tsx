import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useChapterDetail, useChapterReviews } from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { Tag, type TagProps } from "@opennovel-ai/ui/v2/badge-v2"

// ─── Badge variants ───

const OVERALL_BADGE: Record<string, NonNullable<TagProps["variant"]>> = {
  PASS: "success",
  WARN: "warning",
  FAIL: "danger",
}

// 37 维的 9 大类分组，维度名与 plugin CONTINUITY_DIMENSIONS 常量逐字对应
const REVIEW_CATEGORIES: { key: string; dims: string[] }[] = [
  { key: "character", dims: ["姓名一致性", "外貌描述", "性格一致", "能力等级", "位置连续"] },
  { key: "relationship", dims: ["关系类型一致", "敌友转变有因", "亲密度变化", "信任度变化"] },
  { key: "timeline", dims: ["事件顺序", "时间流逝合理", "季节一致", "年龄变化"] },
  { key: "location", dims: ["地点描述一致", "距离合理", "环境细节", "地图一致"] },
  { key: "plot", dims: ["主线推进", "伏笔回收", "冲突升级", "转折合理", "结局呼应"] },
  { key: "worldview", dims: ["力量体系", "规则一致", "社会结构", "文化细节", "经济系统"] },
  { key: "style", dims: ["叙事视角", "语言风格", "节奏一致", "描写密度"] },
  { key: "logic", dims: ["因果链", "动机合理", "信息对称"] },
  { key: "detail", dims: ["物品追踪", "数字一致", "称呼一致"] },
]

// ─── Component ───

export default function ReviewPanel(props: { novelID: string; chapterID: string }) {
  const language = useLanguage()
  const chapterQuery = useChapterDetail(
    () => props.novelID,
    () => props.chapterID,
  )
  const reviewsQuery = useChapterReviews(
    () => props.novelID,
    () => props.chapterID,
  )
  const [selectedRound, setSelectedRound] = createSignal<number | null>(null)
  const [showPass, setShowPass] = createSignal(false)

  const reviews = createMemo(() => reviewsQuery.data ?? [])
  const rounds = createMemo(() => [...new Set(reviews().map((r) => r.round))].sort((a, b) => b - a))
  const activeRound = createMemo(() => selectedRound() ?? rounds()[0] ?? 1)
  const roundReviews = createMemo(() => reviews().filter((r) => r.round === activeRound()))
  // 同轮可能同时有 deterministic 与 auditor 两行，auditor 的 37 维深审含证据，优先展示
  const mainReview = createMemo(
    () =>
      roundReviews().find((r) => r.source === "auditor") ?? roundReviews().find((r) => r.source === "deterministic"),
  )
  const humanNotes = createMemo(() => reviews().filter((r) => r.source === "human"))
  const stale = createMemo(() => {
    const latest = reviews()[0]
    const updatedAt = chapterQuery.data?.updatedAt
    return !!latest && !!updatedAt && updatedAt > latest.createdAt
  })

  return (
    <div class="px-4 py-3 space-y-3">
      <Show when={reviewsQuery.isLoading}>
        <span class="text-xs text-v2-text-text-faint">{language.t("novel.review.loading")}</span>
      </Show>

      <Show when={!reviewsQuery.isLoading && reviews().length === 0}>
        <span class="text-xs text-v2-text-text-faint">{language.t("novel.review.empty")}</span>
      </Show>

      <Show when={reviews().length > 0}>
        <div class="flex items-center gap-2 flex-wrap">
          <SegmentedControlV2
            value={String(activeRound())}
            onChange={(value) => setSelectedRound(value === null ? null : Number(value))}
          >
            <For each={rounds()}>
              {(round) => (
                <SegmentedControlItemV2 value={String(round)}>
                  {language.t("novel.review.round", { round })}
                </SegmentedControlItemV2>
              )}
            </For>
          </SegmentedControlV2>
          <Show when={mainReview()}>
            {(review) => (
              <Tag variant={OVERALL_BADGE[review().overall] ?? "neutral"}>
                {language.t(`novel.review.overall.${review().overall}`)}
              </Tag>
            )}
          </Show>
          <Show when={mainReview()}>
            {(review) => (
              <span class="text-[11px] text-v2-text-text-faint">
                {language.t("novel.review.counts", {
                  pass: review().passCount,
                  warn: review().warnCount,
                  fail: review().failCount,
                })}
                {" · "}
                {language.t(`novel.review.source.${review().source}`)}
              </span>
            )}
          </Show>
        </div>

        <Show when={stale()}>
          <div class="text-[11px] text-v2-state-fg-warning">{language.t("novel.review.stale")}</div>
        </Show>

        <Show when={mainReview()?.summary}>
          <div class="text-xs text-v2-text-text-base">{mainReview()!.summary}</div>
        </Show>

        <Show when={mainReview()}>
          {(review) => (
            <div class="space-y-2">
              <For each={REVIEW_CATEGORIES}>
                {(category) => {
                  const items = () =>
                    review().dimensions.filter(
                      (d) => category.dims.includes(d.dimension) && (showPass() || d.status !== "PASS"),
                    )
                  const passCount = () =>
                    review().dimensions.filter((d) => category.dims.includes(d.dimension) && d.status === "PASS").length
                  return (
                    <Show when={items().length > 0 || passCount() > 0}>
                      <div>
                        <div class="text-[11px] font-medium text-v2-text-text-faint">
                          {language.t(`novel.review.category.${category.key}`)}
                          <Show when={passCount() > 0}>
                            <span class="ml-1 text-v2-state-fg-success">
                              {language.t("novel.review.passCount", { count: passCount() })}
                            </span>
                          </Show>
                        </div>
                        <For each={items()}>
                          {(dim) => (
                            <div class="mt-1 pl-3 border-l-2 border-v2-border-border-base">
                              <div class="flex items-center gap-1.5">
                                <span
                                  class={`inline-block w-1.5 h-1.5 rounded-full ${
                                    dim.status === "FAIL"
                                      ? "bg-v2-state-fg-danger"
                                      : dim.status === "WARN"
                                        ? "bg-v2-state-fg-warning"
                                        : "bg-v2-state-fg-success"
                                  }`}
                                />
                                <span class="text-xs font-medium text-v2-text-text-base">{dim.dimension}</span>
                              </div>
                              <Show when={dim.status !== "PASS"}>
                                <div class="text-xs text-v2-text-text-faint mt-0.5">{dim.detail}</div>
                                <Show when={dim.evidence}>
                                  <div class="text-[11px] text-v2-text-text-faint italic mt-0.5">
                                    {language.t("novel.review.evidence")}: {dim.evidence}
                                  </div>
                                </Show>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  )
                }}
              </For>
            </div>
          )}
        </Show>

        <Show when={mainReview() && mainReview()!.passCount > 0}>
          <button
            type="button"
            class="text-[11px] text-v2-text-text-accent hover:underline"
            onClick={() => setShowPass(!showPass())}
          >
            {showPass()
              ? language.t("novel.review.hidePass")
              : language.t("novel.review.showPass", { count: mainReview()!.passCount })}
          </button>
        </Show>

        <Show when={humanNotes().length > 0}>
          <div class="space-y-1">
            <div class="text-[11px] font-medium text-v2-text-text-faint">{language.t("novel.review.humanNotes")}</div>
            <For each={humanNotes()}>
              {(note) => (
                <div class="text-xs text-v2-text-text-base pl-3 border-l-2 border-v2-border-border-base">
                  <Tag variant={OVERALL_BADGE[note.overall] ?? "neutral"} class="mr-1">
                    {language.t(`novel.review.overall.${note.overall}`)}
                  </Tag>
                  {note.summary || language.t("novel.review.noComment")}
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
