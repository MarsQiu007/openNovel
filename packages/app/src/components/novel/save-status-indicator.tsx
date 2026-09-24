/**
 * 编辑保存状态指示器。
 *
 * 展示保存中、已保存、保存失败、待同步、同步失败和已跳过状态。
 * 保存失败时提供重试按钮；同步失败时保留失败原因。
 */
import { Show, type JSX } from "solid-js"
import { EDIT_SAVE_STATUS_LABELS, EDIT_SAVE_STATUS_STYLES, type EditSaveStatus } from "@/utils/save-status"

type SaveStatusIndicatorProps = {
  status: EditSaveStatus
  failureMessage?: string | null
  lastAutoSaveTime?: number | null
  onRetry?: () => void
}

export function SaveStatusIndicator(props: SaveStatusIndicatorProps): JSX.Element {
  const label = () => EDIT_SAVE_STATUS_LABELS[props.status]
  const style = () => EDIT_SAVE_STATUS_STYLES[props.status]

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }

  return (
    <div class="flex items-center gap-2 text-xs" role="status" aria-live="polite">
      <Show when={label()}>
        <span class={style()} data-status={props.status}>
          {label()}
          <Show when={props.status === "saved" && props.lastAutoSaveTime}>
            {" "}{formatTime(props.lastAutoSaveTime!)}
          </Show>
        </span>
      </Show>
      <Show when={(props.status === "save_failed" || props.status === "sync_failed") && props.failureMessage}>
        <span class="text-red-500/80 max-w-48 truncate" title={props.failureMessage ?? ""}>
          {props.failureMessage}
        </span>
      </Show>
      <Show when={(props.status === "save_failed" || props.status === "sync_failed") && props.onRetry}>
        <button type="button" class="text-blue-600 hover:underline" onClick={() => props.onRetry?.()}>
          重试
        </button>
      </Show>
    </div>
  )
}
