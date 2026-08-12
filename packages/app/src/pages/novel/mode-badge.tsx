/**
 * ModeBadge — 项目级写作模式徽标
 *
 * 顶部工具栏右侧的 Tag，点击切换。
 * - 写作模式（writing_mode）：auto（自动）/ review（审核）
 *
 * 设计说明：setup_mode 是初始化期的一次性对话门禁，由 director 在用户开新书时
 * 主动询问确认，不需要在工作台顶部常驻一个徽标（用户已开过书后 setup_mode 无操作价值）。
 * 因此本组件只展示 writing_mode。
 */
import { Show, Suspense } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useMode, useSetMode, novelKeys } from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { Tag, type TagProps } from "@opennovel-ai/ui/v2/badge-v2"
import { showToast } from "@/utils/toast"

type TagVariant = NonNullable<TagProps["variant"]>

const WRITING_VARIANT: Record<"auto" | "review", TagVariant> = {
  auto: "success",
  review: "warning",
}

function ModeBadgeSkeleton() {
  return (
    <div class="flex items-center gap-2" data-component="mode-badge-skeleton">
      <span class="inline-block w-16 h-5 bg-v2-bg-bg-elevated rounded animate-pulse" />
    </div>
  )
}

export default function ModeBadge() {
  const language = useLanguage()
  const modeQuery = useMode()
  const setMode = useSetMode()
  const queryClient = useQueryClient()
  const sdk = useSDK()

  const currentMode = (): "auto" | "review" => modeQuery.data?.writing_mode ?? "auto"

  const toggle = () => {
    const next = currentMode() === "auto" ? "review" : "auto"
    // 真·乐观更新：mutate 前先把缓存改成目标值，UI 立即反馈；失败时回滚
    const queryKey = novelKeys.mode(sdk().directory)
    const previousData = queryClient.getQueryData<{ writing_mode: "auto" | "review"; setup_mode: "interactive" | "auto" }>(queryKey)
    if (previousData) {
      queryClient.setQueryData(queryKey, { ...previousData, writing_mode: next })
    }

    setMode.mutate(
      { writing_mode: next },
      {
        onSuccess: () => {
          showToast({
            variant: "success",
            title:
              next === "auto"
                ? language.t("novel.mode.switchToAuto")
                : language.t("novel.mode.switchToReview"),
          })
        },
        onError: (error) => {
          // 回滚到 mutate 前的值
          if (previousData) {
            queryClient.setQueryData(queryKey, previousData)
          }
          showToast({
            variant: "error",
            title:
              error instanceof Error
                ? error.message
                : language.t("novel.mode.error.updateFailed"),
          })
        },
      },
    )
  }

  return (
    <Suspense fallback={<ModeBadgeSkeleton />}>
      <Show when={modeQuery.data !== undefined}>
        <button
          type="button"
          class="inline-flex items-center gap-1 cursor-pointer rounded focus:outline-none focus:ring-1 focus:ring-v2-border-border-accent disabled:opacity-60 disabled:cursor-not-allowed"
          title={language.t(currentMode() === "auto" ? "novel.mode.autoDesc" : "novel.mode.reviewDesc")}
          aria-label={language.t("novel.mode.label")}
          aria-pressed={currentMode() === "review"}
          onClick={() => toggle()}
          disabled={setMode.isPending}
          data-component="mode-badge"
        >
          <span class="text-[11px] text-v2-text-text-faint">{language.t("novel.mode.label")}:</span>
          <Tag variant={WRITING_VARIANT[currentMode()]}>
            {language.t(currentMode() === "auto" ? "novel.mode.auto" : "novel.mode.review")}
          </Tag>
        </button>
      </Show>
    </Suspense>
  )
}
