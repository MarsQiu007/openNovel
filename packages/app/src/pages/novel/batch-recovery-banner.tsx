/**
 * 批量写作中断横幅（agent-background-job-recovery D6）。
 *
 * 工作台顶部横幅（UpgradeBanner 同款位置与纯函数状态机模式）：批量任务
 * running 且发起会话不活跃（崩溃/重启后）时展示进度与「续跑 / 放弃」入口。
 * 续跑 = 向批量记录绑定的会话发送「继续批量写作」prompt 并跳转该会话；
 * 放弃 = cancel 写面置 cancelled。interrupted 由服务端查询期派生，横幅轮询
 * 与会话活性对账，续跑后轮询到活跃即自动消失。
 */
import { Show, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { novelKeys, useCancelWritingBatch, useWritingBatch } from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

/** 横幅状态机（纯函数，便于测试）：仅 interrupted 一种可见态。 */
export type BatchRecoveryBannerState = "hidden" | "interrupted"

export function resolveBatchBannerState(
  batch: { status: string; interrupted: boolean } | null | undefined,
): BatchRecoveryBannerState {
  if (!batch) return "hidden"
  return batch.status === "running" && batch.interrupted ? "interrupted" : "hidden"
}

/** 模型面向的续跑指令：director 按 get_writing_batch + list_chapters 定断点，此处不含进度细节。 */
const RESUME_PROMPT = "继续批量写作"

export default function BatchRecoveryBanner(props: { dir: string; novelID: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const batch = useWritingBatch(() => props.novelID)
  const cancel = useCancelWritingBatch()
  const [abandoning, setAbandoning] = createSignal(false)

  const resume = useMutation(() => ({
    mutationFn: (input: { sessionID: string }) =>
      sdk().client.v2.session.prompt({ sessionID: input.sessionID, prompt: { text: RESUME_PROMPT } }),
    onSuccess: (_result, input) => {
      navigate(`/${props.dir}/novel/${props.novelID}/session/${input.sessionID}`)
      queryClient.invalidateQueries({ queryKey: novelKeys["writing-batch"](sdk().directory, props.novelID) })
    },
    onError: () => showToast({ title: language.t("novel.batchRecovery.resumeFailed"), variant: "error" }),
  }))

  function abandon() {
    setAbandoning(true)
    cancel.mutate(
      { novelID: props.novelID },
      {
        onError: () => showToast({ title: language.t("novel.batchRecovery.abandonFailed"), variant: "error" }),
        onSettled: () => setAbandoning(false),
      },
    )
  }

  return (
    <Show when={resolveBatchBannerState(batch.data) === "interrupted" && batch.data}>
      {(data) => (
        <div class="px-5 pt-3" data-slot="batch-recovery-banner">
          <div class="flex items-center justify-between gap-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 py-3">
            <span class="text-sm text-v2-text-text-base">
              {language.t("novel.batchRecovery.title")}：
              {language.t("novel.batchRecovery.progress", {
                completed: data().completed,
                total: data().total,
                start: data().startChapter,
              })}
            </span>
            <div class="flex items-center gap-2 shrink-0">
              <ButtonV2
                variant="contrast"
                size="small"
                disabled={resume.isPending}
                onClick={() => resume.mutate({ sessionID: data().sessionId })}
              >
                {language.t("novel.batchRecovery.resume")}
              </ButtonV2>
              <ButtonV2 variant="ghost-muted" size="small" disabled={abandoning()} onClick={abandon}>
                {language.t("novel.batchRecovery.abandon")}
              </ButtonV2>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
