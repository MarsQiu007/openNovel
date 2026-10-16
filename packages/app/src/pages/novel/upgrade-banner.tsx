/**
 * 派生数据升级横幅（derived-data-upgrade）。
 *
 * 工作台顶部横幅：检测到未执行升级任务时展示提示与成本预估，
 * 用户显式确认后触发两阶段升级；执行中展示聚合进度（当前章节、ETA、
 * worker 活性）并支持暂停 / 续跑；瞬时失败进入等待恢复态并显示恢复时间；
 * 终态失败展示人话分类说明与行动建议。完成后横幅消失。
 */
import { For, Show, createEffect, createSignal } from "solid-js"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import {
  useSyncRetry,
  useUpgradeStatus,
  useUpgradeProgress,
  useUpgradeStart,
  useUpgradePause,
  useUpgradeResume,
} from "@/context/novel-queries"

/** 横幅状态机（纯函数，便于测试）：run 驱动五态。 */
export type UpgradeBannerState = "hidden" | "prompt" | "running" | "waiting" | "done-with-failures"

export function resolveBannerState(input: {
  taskCount: number
  total: number
  synced: number
  failed: number
  running: number
  waitingRetry: number
}): UpgradeBannerState {
  const { taskCount, total, synced, failed, running, waitingRetry } = input
  if (total === 0) return taskCount > 0 ? "prompt" : "hidden"
  if (running > 0) return "running"
  if (waitingRetry > 0 && synced + failed + waitingRetry < total + waitingRetry) return "waiting"
  if (synced + failed < total) return "running"
  return failed > 0 ? "done-with-failures" : "hidden"
}

/** 从升级状态负载派生待执行任务数；负载缺 tasks 字段（旧服务端/异常响应）时按 0 处理，避免工作台崩溃。 */
export function resolveTaskCount(status: { tasks?: ReadonlyArray<unknown> } | undefined): number {
  return status?.tasks?.length ?? 0
}

/** 从失败项提取章节 ID 列表（章节级重试）。 */
export function resolveRetryChapterIds(
  failures: ReadonlyArray<{ chapterId?: string }>,
): string[] {
  return failures.map((f) => f.chapterId ?? "").filter((id) => id.length > 0)
}

/** 格式化恢复时间为本地 HH:mm。 */
export function formatResumeTime(resumeAt: number): string {
  const d = new Date(resumeAt)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

/** 格式化 ETA 为「约 N 分钟」。 */
export function formatEta(etaMs: number): string {
  const minutes = Math.max(1, Math.round(etaMs / 60_000))
  return `约 ${minutes} 分钟`
}

/** worker 活性判定：超过 10s 未轮询视为无活性。 */
export function isWorkerStale(lastPollAt: number | undefined, now: number): boolean {
  if (lastPollAt === undefined) return false
  return now - lastPollAt > 10_000
}

export default function UpgradeBanner(props: { novelID: string }) {
  const status = useUpgradeStatus(() => props.novelID)
  const progress = useUpgradeProgress(() => props.novelID)
  const start = useUpgradeStart()
  const pause = useUpgradePause()
  const resume = useUpgradeResume()
  const retry = useSyncRetry()
  const [confirming, setConfirming] = createSignal(false)
  // Phase 1 反馈：点击确认后、start 请求返回前显示「确定性回填执行中」
  const [phase1Running, setPhase1Running] = createSignal(false)
  // start 请求 settled 后清除 Phase 1 反馈
  createEffect(() => {
    if (!start.isPending && phase1Running()) setPhase1Running(false)
  })
  // 失败项的原始错误文本展开状态
  const [expandedFailures, setExpandedFailures] = createSignal<Set<string>>(new Set())

  const taskCount = () => resolveTaskCount(status.data)
  const estimate = () => status.data?.estimate
  const gate = () => status.data?.gate ?? "open"
  const total = () => progress.data?.total ?? 0
  const synced = () => progress.data?.synced ?? 0
  const failedCount = () => progress.data?.failed ?? 0
  const running = () => progress.data?.running ?? 0
  const waitingRetry = () => progress.data?.waitingRetry ?? 0
  const failures = () => progress.data?.failures ?? []
  const waitingRetryList = () => progress.data?.waitingRetryList ?? []
  const currentChapterId = () => progress.data?.currentChapterId
  const etaMs = () => progress.data?.etaMs
  const workerStale = () => isWorkerStale(progress.data?.workerLastPollAt, Date.now())

  const bannerState = () =>
    resolveBannerState({
      taskCount: taskCount(),
      total: total(),
      synced: synced(),
      failed: failedCount(),
      running: running(),
      waitingRetry: waitingRetry(),
    })

  const toggleFailureDetail = (chapterId: string) => {
    const next = new Set(expandedFailures())
    if (next.has(chapterId)) next.delete(chapterId)
    else next.add(chapterId)
    setExpandedFailures(next)
  }

  return (
    <Show when={bannerState() !== "hidden" || phase1Running()}>
      <div class="px-5 pt-3">
        <div class="flex items-center justify-between gap-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 py-3">
          <Show
            when={!phase1Running() && bannerState() !== "prompt"}
            fallback={
              <Show
                when={!phase1Running()}
                fallback={
                  <span class="text-sm text-v2-text-text-base">确定性回填执行中…</span>
                }
              >
                <div class="flex items-center gap-3">
                  <span class="text-sm text-v2-text-text-base">
                    检测到可升级到当前版本：{taskCount()} 项待升级（含确定性回填与 AI 重建）
                  </span>
                  <ButtonV2 variant="contrast" size="small" onClick={() => setConfirming(true)}>
                    查看并升级
                  </ButtonV2>
                </div>
              </Show>
            }
          >
            <div class="flex flex-col gap-1 min-w-0">
              <Show
                when={bannerState() !== "waiting"}
                fallback={
                  <span class="text-sm text-v2-text-text-base">
                    模型额度已用尽
                    <For each={waitingRetryList()}>
                      {(w) => <span class="ml-1">，预计 {formatResumeTime(w.resumeAt)} 自动恢复</span>}
                    </For>
                  </span>
                }
              >
                <span class="text-sm text-v2-text-text-base">
                  升级中：已同步 {synced()} / {total()} 章
                  <Show when={running() > 0 && currentChapterId()}>
                    <span class="text-v2-text-text-muted ml-1">
                      （正在重建章节 {currentChapterId()!.slice(0, 8)}）
                    </span>
                  </Show>
                  <Show when={etaMs() !== undefined && etaMs()! > 0}>
                    <span class="text-v2-text-text-muted ml-1">预计 {formatEta(etaMs()!)}</span>
                  </Show>
                  <Show when={failedCount() > 0}>
                    <span class="text-v2-state-fg-danger">（失败 {failedCount()} 章）</span>
                  </Show>
                </span>
              </Show>
              <Show when={workerStale()}>
                <span class="text-xs text-amber-600">同步未在运行（worker 无响应）</span>
              </Show>
              <Show when={failures().length > 0}>
                <div class="flex flex-col gap-0.5">
                  <For each={failures()}>
                    {(f) => (
                      <div class="flex flex-col gap-0.5">
                        <div class="flex items-center gap-2">
                          <span class="text-xs text-v2-text-text-muted truncate">
                            章节 {(f.chapterId ?? "").slice(0, 8)}：
                            {f.failureMessage ?? f.reason}
                          </span>
                          <Show when={f.failureAction}>
                            <span class="text-xs text-v2-text-text-muted">→ {f.failureAction}</span>
                          </Show>
                          <Show when={f.failureDetail}>
                            <button
                              type="button"
                              class="text-xs text-blue-600 hover:underline shrink-0"
                              onClick={() => toggleFailureDetail(f.chapterId ?? "")}
                            >
                              {expandedFailures().has(f.chapterId ?? "") ? "收起" : "详情"}
                            </button>
                          </Show>
                        </div>
                        <Show when={expandedFailures().has(f.chapterId ?? "") && f.failureDetail}>
                          <span class="text-xs text-v2-text-text-faint break-all pl-4">
                            {f.failureDetail}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Show when={bannerState() === "done-with-failures"}>
                <ButtonV2
                  variant="ghost-muted"
                  size="small"
                  disabled={retry.isPending || failures().length === 0}
                  onClick={() =>
                    retry.mutate({ novelID: props.novelID, chapterIds: resolveRetryChapterIds(failures()) })
                  }
                >
                  重试失败章节
                </ButtonV2>
              </Show>
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
                  disabled={(progress.data?.pending ?? 0) === 0 && running() === 0 && waitingRetry() === 0}
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
            <div class="w-[420px] rounded-xl border border-v2-border-border-base bg-v2-background-bg-base p-5 flex flex-col gap-4">
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
                    setConfirming(false)
                    setPhase1Running(true)
                    start.mutate({ novelID: props.novelID })
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
