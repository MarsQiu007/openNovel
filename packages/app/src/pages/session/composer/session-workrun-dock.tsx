import type { SessionWorkRunRun } from "@opennovel-ai/sdk/v2/client"
import { IconButton } from "@opennovel-ai/ui/icon-button"
import { For, Show, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"

const itemDotClass: Record<SessionWorkRunRun["items"][number]["status"], string> = {
  pending: "bg-border-strong-base",
  in_progress: "bg-text-info-base animate-pulse",
  done: "bg-text-success-base",
  skipped: "bg-text-weak",
  blocked: "bg-text-warning-base",
}

export function SessionWorkRunDock(props: {
  run: SessionWorkRunRun
  busy: "pause" | "resume" | undefined
  onPause: () => void
  onResume: () => void
}) {
  const language = useLanguage()
  const [collapsed, setCollapsed] = createSignal(false)
  const toggle = () => setCollapsed((value) => !value)
  const paused = createMemo(() => props.run.status === "paused")
  const complete = createMemo(() => props.run.status === "complete")
  const done = createMemo(() => props.run.items.filter((item) => item.status === "done").length)

  return (
    <div
      data-component="session-workrun-dock"
      data-status={props.run.status}
      class="mb-2 w-full overflow-hidden rounded-xl border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 py-3"
    >
      <div class="flex items-center gap-2">
        <span
          data-slot="session-workrun-goal"
          class="min-w-0 flex-1 truncate text-14-medium text-text-strong"
          title={props.run.goal}
        >
          {props.run.goal}
        </span>
        <span
          data-slot="session-workrun-status"
          class="shrink-0 rounded-full px-2 py-0.5 text-12-regular text-text-weak bg-background-base"
        >
          {language.t(`session.workrun.status.${props.run.status}`, {
            done: done(),
            total: props.run.items.length,
          })}
        </span>
        <Show
          when={!complete()}
          fallback={null}
        >
          <button
            type="button"
            data-action={paused() ? "session-workrun-resume" : "session-workrun-pause"}
            disabled={props.busy !== undefined}
            class="shrink-0 rounded-md border border-border-weak-base px-2.5 py-1 text-12-regular text-text-base transition-colors hover:bg-background-base disabled:opacity-50"
            onClick={() => (paused() ? props.onResume() : props.onPause())}
          >
            {language.t(paused() ? "session.workrun.resume" : "session.workrun.pause")}
          </button>
        </Show>
        <div class="shrink-0">
          <IconButton
            data-action="session-workrun-collapse"
            data-collapsed={collapsed() ? "true" : "false"}
            icon="chevron-down"
            size="normal"
            variant="ghost"
            style={{ transform: `rotate(${collapsed() ? 180 : 0}deg)` }}
            onClick={toggle}
            aria-label={collapsed() ? language.t("session.workrun.expand") : language.t("session.workrun.collapse")}
          />
        </div>
      </div>
      <Show when={!collapsed()}>
        <Show when={props.run.progressNote.length > 0}>
          <p
            data-slot="session-workrun-progress"
            class="mt-2 line-clamp-2 text-13-regular text-text-weak"
            title={props.run.progressNote}
          >
            {props.run.progressNote}
          </p>
        </Show>
        <ul
          data-slot="session-workrun-items"
          class="mt-2 flex max-h-42 flex-col gap-1.5 overflow-y-auto no-scrollbar"
        >
          <For each={props.run.items}>
            {(item) => (
              <li data-state={item.status} class="flex items-center gap-2 text-13-regular">
                <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${itemDotClass[item.status]}`} />
                <span
                  classList={{
                    "min-w-0 break-words text-text-base": true,
                    "text-text-weak line-through": item.status === "done" || item.status === "skipped",
                  }}
                >
                  {item.title}
                </span>
                <Show when={item.note !== undefined && item.status === "blocked"}>
                  <span class="min-w-0 truncate text-12-regular text-text-faint" title={item.note}>
                    {item.note}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
