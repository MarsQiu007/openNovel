/**
 * 派生数据升级横幅（derived-data-upgrade）。
 *
 * 工作台顶部横幅：检测到未执行升级任务时展示提示与成本预估，
 * 用户显式确认后触发两阶段升级；执行中展示聚合进度并支持
 * 暂停 / 续跑；失败章节保留原因可查。完成后横幅消失。
 */
import { Show, createSignal } from "solid-js"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { useUpgradeStatus, useUpgradeProgress, useUpgradeStart, useUpgradePause, useUpgradeResume } from "@/context/novel-queries"

/** 横幅状态机（纯函数，便于测试）。 */
export type UpgradeBannerState = "hidden" | "prompt" | "running" | "done-with-failures"

export function resolveBannerState(input: {
  taskCount: number
  total: number
  synced: number
  failed: number
}): UpgradeBannerState {
  const { taskCount, total, synced, failed } = input
  if (total === 0) return taskCount > 0 ? "prompt" : "hidden"
  if (synced + failed < total) return "running"
  return failed > 0 ? "done-with-failures" : "hidden"
}

export default function UpgradeBanner(props: { novelID: string }) {
  const status = useUpgradeStatus(() => props.novelID)
  const progress = useUpgradeProgress(() => props.novelID)
  const start = useUpgradeStart()
  const pause = useUpgradePause()
  const resume = useUpgradeResume()
  const [confirming, setConfirming] = createSignal(false)

  const taskCount = () => status.data?.tasks.length ?? 0
  const estimate = () => status.data?.estimate
  const gate = () => status.data?.gate ?? "open"
  const total = () => progress.data?.total ?? 0
  const synced = () => progress.data?.synced ?? 0
  const failedCount = () => progress.data?.failed ?? 0
  const failures = () => progress.data?.failures ?? []
  const bannerState = () =>
    resolveBannerState({ taskCount: taskCount(), total: total(), synced: synced(), failed: failedCount() })

  return (
    <Show when={bannerState() !== "hidden"}>
      <div class="px-5 pt-3">
        <div class="flex items-center justify-between gap-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-secondary px-4 py-3">
          <Show
            when={bannerState() !== "prompt"}
            fallback={
              <div class="flex items-center gap-3">
                <span class="text-sm text-v2-text-text-base">
                  检测到可升级到当前版本：{taskCount()} 项待升级（含确定性回填与 AI 重建）
                </span>
                <ButtonV2 variant="contrast" size="small" onClick={() => setConfirming(true)}>
                  查看并升级
                </ButtonV2>
              </div>
            }
          >
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-sm text-v2-text-text-base">
                升级中：已同步 {synced()} / {total()} 章
                <Show when={failedCount() > 0}>
                  <span class="text-v2-text-text-error">（失败 {failedCount()} 章）</span>
                </Show>
              </span>
              <Show when={failures().length > 0}>
                <div class="flex flex-col gap-0.5">
                  {failures().map((f) => (
                    <span class="text-xs text-v2-text-text-muted truncate">
                      章节 {f.chapterId.slice(0, 8)}：{f.reason}
                    </span>
                  ))}
                </div>
              </Show>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Show
                when={gate() === "open"}
                fallback={
                  <ButtonV2
                    variant="ghost-muted"
                    size="small"
                    onClick={() => resume.mutate({ novelID: props.novelID })}
                  >
                    续跑
                  </ButtonV2>
                }
              >
                <ButtonV2
                  variant="ghost-muted"
                  size="small"
                  disabled={(progress.data?.pending ?? 0) === 0}
                  onClick={() => pause.mutate({ novelID: props.novelID })}
                >
                  暂停
                </ButtonV2>
              </Show>
            </div>
          </Show>
        </div>

        <Show when={confirming()}>
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div class="w-[420px] rounded-xl border border-v2-border-border-base bg-v2-background-bg-primary p-5 flex flex-col gap-4">
              <h3 class="text-base font-medium text-v2-text-text-base">升级到当前版本</h3>
              <div class="flex flex-col gap-2 text-sm text-v2-text-text-muted">
                <p>
                  确定性回填：{estimate()?.deterministicTasks ?? 0} 项（免费，秒级完成）
                </p>
                <p>
                  AI 重建：约 {estimate()?.aiChapters ?? 0} 章 × 1 次 observer 调用（重建章节摘要、引用、段摘要与主轴条目）
                </p>
                <p>确认后开始执行；升级过程可暂停，失败章节可续跑。</p>
              </div>
              <div class="flex justify-end gap-2">
                <ButtonV2 variant="ghost-muted" size="normal" onClick={() => setConfirming(false)}>
                  取消
                </ButtonV2>
                <ButtonV2
                  variant="contrast"
                  size="normal"
                  onClick={() => {
                    start.mutate({ novelID: props.novelID })
                    setConfirming(false)
                  }}
                >
                  确认升级
                </ButtonV2>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
