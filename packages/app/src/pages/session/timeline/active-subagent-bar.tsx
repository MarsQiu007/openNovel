/**
 * 活跃子代理横条（subagent-session-visibility）：时间线视图上方列出当前会话运行中的
 * 直接子代理（标题 + 运行指示），点击导航进入对应子会话；无运行条目时不渲染、零占位。
 * 数据由调用方注入（直接子代理集合 × 运行判定），组件不绑死具体查询来源，
 * 书内会话与首页会话视图可分别取数复用；深层后代不进横条（进入子会话后继续下钻）。
 */
import { For, Show } from "solid-js"

export type ActiveSubagentEntry = { id: string; title: string }

/** 运行条目筛选：直接子代理集合与运行判定（busy/retry）的交集，保持传入顺序。 */
export function activeSubagentEntries(input: {
  children: readonly { id: string; title: string }[]
  working: (sessionID: string) => boolean
}): ActiveSubagentEntry[] {
  return input.children.filter((child) => input.working(child.id)).map((child) => ({ id: child.id, title: child.title }))
}

export function ActiveSubagentBar(props: { entries: ActiveSubagentEntry[]; onSelect: (sessionID: string) => void }) {
  return (
    <Show when={props.entries.length > 0}>
      <div
        data-action="active-subagent-bar"
        class="flex shrink-0 items-center gap-1.5 border-b border-v2-border-border-base px-4 py-1.5 text-xs text-v2-text-text-secondary"
        aria-label="活跃子代理"
      >
        <span class="shrink-0 text-v2-text-text-faint">子代理</span>
        <For each={props.entries}>
          {(entry) => (
            <button
              type="button"
              data-action="active-subagent-entry"
              class="flex min-w-0 max-w-64 shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-v2-background-bg-layer-02"
              aria-label={`进入子代理：${entry.title}`}
              onClick={() => props.onSelect(entry.id)}
            >
              <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-v2-state-fg-success" aria-hidden="true" />
              <span class="truncate">{entry.title}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
