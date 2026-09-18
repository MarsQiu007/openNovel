import { For, Show, type Accessor } from "solid-js"

export type MapAiEntry = {
  id: string
  title: string
  category: string
  content: string
}

export function MapAiGeneratePanel(props: {
  entries: readonly MapAiEntry[]
  selectedEntryIds: Accessor<Set<string>>
  instruction: Accessor<string>
  generating: Accessor<boolean>
  error: Accessor<string | undefined>
  onClose: () => void
  onToggleEntry: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
  onInstructionChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div class="absolute right-3 top-3 z-[1000] flex max-h-full w-80 flex-col overflow-hidden rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 shadow-lg">
      <div class="flex items-center justify-between border-b border-v2-border-border-base px-4 py-3">
        <div>
          <h3 class="text-sm font-medium text-v2-text-text-base">AI 生成地图</h3>
          <p class="text-xs text-v2-text-text-muted">基于世界观条目生成可编辑草稿</p>
        </div>
        <button
          type="button"
          disabled={props.generating()}
          class="rounded p-1 text-v2-text-text-muted hover:text-v2-text-text-base disabled:opacity-40"
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-v2-text-text-muted">世界观条目</span>
          <Show when={!props.generating()}>
            <div class="flex gap-2 text-xs">
              <button type="button" class="text-v2-text-text-muted hover:text-v2-text-text-base" onClick={props.onSelectAll}>
                全选
              </button>
              <button type="button" class="text-v2-text-text-muted hover:text-v2-text-text-base" onClick={props.onClear}>
                清空
              </button>
            </div>
          </Show>
        </div>
        <Show when={props.entries.length > 0} fallback={<p class="text-xs text-v2-text-text-muted">暂无世界观条目，可基于小说类型生成基础地理。</p>}>
          <div class="flex flex-col gap-1.5">
            <For each={props.entries}>
              {(entry) => (
                <label class="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-xs hover:bg-v2-background-bg-layer-02">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={props.selectedEntryIds().has(entry.id)}
                    disabled={props.generating()}
                    onChange={() => props.onToggleEntry(entry.id)}
                  />
                  <span class="min-w-0">
                    <span class="block truncate text-v2-text-text-base">{entry.title}</span>
                    <span class="block truncate text-v2-text-text-muted">{entry.category || "未分类"}</span>
                  </span>
                </label>
              )}
            </For>
          </div>
        </Show>

        <label class="mt-4 block text-xs font-medium text-v2-text-text-muted">布局指令（可选）</label>
        <textarea
          class="mt-1.5 min-h-20 w-full resize-none rounded-md border border-v2-border-border-base bg-transparent p-2 text-xs text-v2-text-text-base outline-none focus:border-v2-border-border-active"
          placeholder="例：西部是沙漠，东部是群岛"
          value={props.instruction()}
          disabled={props.generating()}
          onInput={(event) => props.onInstructionChange(event.currentTarget.value)}
        />
      </div>

      <div class="border-t border-v2-border-border-base px-4 py-3">
        <Show when={props.error()}>
          {(message) => <p class="mb-2 text-xs text-red-500">{message()}</p>}
        </Show>
        <button
          type="button"
          class="w-full rounded-md bg-v2-background-bg-invert px-3 py-2 text-sm text-v2-text-text-invert hover:opacity-90 disabled:opacity-50"
          disabled={props.generating()}
          onClick={props.onSubmit}
        >
          {props.generating() ? "生成中…不可取消" : "开始生成"}
        </button>
        <Show when={props.generating()}>
          <p class="mt-2 text-center text-xs text-v2-text-text-muted">正在生成结构化地图草稿，完成后自动打开。</p>
        </Show>
      </div>
    </div>
  )
}
