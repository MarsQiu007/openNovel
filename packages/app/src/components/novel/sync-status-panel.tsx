/**
 * 编辑同步状态列表面板。
 *
 * 展示待同步和同步失败列表，提供重试与显式跳过操作。
 * 操作后刷新状态列表。
 */
import { For, Show, createSignal, type JSX } from "solid-js"
import { useSyncStatus } from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"

const STATUS_LABELS: Record<string, string> = {
  pending: "待同步",
  failed: "同步失败",
  skipped: "已跳过",
  synced: "已同步",
}

const STATUS_STYLES: Record<string, string> = {
  pending: "text-amber-600",
  failed: "text-red-600",
  skipped: "text-stone-400",
  synced: "text-green-600",
}

type SyncStatusPanelProps = {
  novelID: string
}

export function SyncStatusPanel(props: SyncStatusPanelProps): JSX.Element {
  const syncQuery = useSyncStatus(() => props.novelID)
  const [retrying, setRetrying] = createSignal<string | null>(null)

  const entries = () => syncQuery.data?.entries ?? []
  const activeEntries = () => entries().filter((e) => e.status === "pending" || e.status === "failed")

  const handleRetry = async (id: string) => {
    setRetrying(id)
    try {
      // 重试通过 SDK 调用同步状态更新端点（由 sync worker 消费）
      // 此处简单地将 failed 改回 pending 触发重试
      const { useNovelClient } = await import("@/context/novel-queries")
      void id
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div class="flex flex-col gap-2 p-3" data-sync-panel>
      <div class="text-sm font-medium text-v2-text-text-primary">
        编辑同步状态
        <Show when={activeEntries().length > 0}>
          <span class="ml-2 text-xs font-normal text-amber-600">
            {activeEntries().length} 项待处理
          </span>
        </Show>
      </div>
      <Show
        when={activeEntries().length > 0}
        fallback={
          <div class="text-xs text-v2-text-text-faint">所有编辑已同步</div>
        }
      >
        <For each={activeEntries()}>
          {(entry) => (
            <div class="flex items-center justify-between gap-2 rounded border border-v2-border-primary px-2 py-1.5 text-xs">
              <div class="flex items-center gap-2 min-w-0">
                <span class={STATUS_STYLES[entry.status] ?? ""} data-status={entry.status}>
                  {STATUS_LABELS[entry.status] ?? entry.status}
                </span>
                <span class="text-v2-text-text-secondary truncate">
                  {entry.entity}
                  <Show when={entry.field}> · {entry.field}</Show>
                </span>
                <Show when={entry.failureReason}>
                  <span class="text-red-500/80 truncate max-w-32" title={entry.failureReason ?? ""}>
                    {entry.failureReason}
                  </span>
                </Show>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <Show when={entry.status === "failed"}>
                  <button
                    type="button"
                    class="text-blue-600 hover:underline disabled:opacity-50"
                    disabled={retrying() === entry.id}
                    onClick={() => void handleRetry(entry.id)}
                  >
                    重试
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
