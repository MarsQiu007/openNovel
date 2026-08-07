import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useConfirmDelete } from "./confirm-dialog"
import { useCreatePlotThread, useDeletePlotThread, usePlotThreads, useUpdatePlotThread } from "@/context/novel-queries"
import type { ServerNovelPlotThreadsOutput } from "@opennovel-ai/client"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { Tag, type TagProps } from "@opennovel-ai/ui/v2/badge-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"

type PanelThreadsProps = {
  novelID: Accessor<string>
}

export function PanelThreads(props: PanelThreadsProps) {
  const language = useLanguage()
  const query = usePlotThreads(props.novelID)
  const createThread = useCreatePlotThread()
  const updateThread = useUpdatePlotThread()
  const deleteThread = useDeletePlotThread()
  const confirmDelete = useConfirmDelete()
  const [isAdding, setIsAdding] = createSignal(false)
  const [title, setTitle] = createSignal("")
  const [priority, setPriority] = createSignal("medium")
  const [description, setDescription] = createSignal("")

  const openThreads = createMemo(() => {
    const data = query.data
    if (!data) return [] as ServerNovelPlotThreadsOutput
    return data.filter((t) => t.status !== "closed")
  })

  const closedThreads = createMemo(() => {
    const data = query.data
    if (!data) return [] as ServerNovelPlotThreadsOutput
    return data.filter((t) => t.status === "closed")
  })

  const priorityLabel = (p: string) => {
    switch (p) {
      case "high":
        return language.t("novel.panel.threads.high")
      case "medium":
        return language.t("novel.panel.threads.medium")
      case "low":
        return language.t("novel.panel.threads.low")
      default:
        return p
    }
  }

  const priorityVariant = (p: string): NonNullable<TagProps["variant"]> => {
    switch (p) {
      case "high":
        return "danger"
      case "medium":
        return "warning"
      case "low":
        return "success"
      default:
        return "neutral"
    }
  }

  return (
    <div class="flex flex-col gap-3">
      <Show when={query.isLoading}>
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-5 h-5 text-v2-text-text-muted" />
        </div>
      </Show>

      <Show when={query.error}>
        <p class="text-sm text-v2-state-fg-danger px-3 py-2">{String(query.error)}</p>
      </Show>

      <div class="px-3">
        <Show
          when={isAdding()}
          fallback={
            <ButtonV2 variant="ghost" size="small" onClick={() => setIsAdding(true)}>
              + {language.t("novel.panel.threads.add")}
            </ButtonV2>
          }
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!title().trim()) return
              await createThread.mutateAsync({
                novelID: props.novelID(),
                title: title(),
                priority: priority(),
                description: description() || undefined,
              })
              setTitle("")
              setPriority("medium")
              setDescription("")
              setIsAdding(false)
            }}
            class="flex flex-col gap-2"
          >
            <TextInputV2
              fluid
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder={language.t("novel.panel.threads.title")}
            />
            <SelectV2
              options={["high", "medium", "low"]}
              current={priority()}
              label={priorityLabel}
              onSelect={(option) => option && setPriority(option)}
            />
            <TextInputV2
              fluid
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              placeholder={language.t("novel.panel.threads.description")}
            />
            <div class="flex gap-2">
              <ButtonV2 type="submit" variant="contrast" size="small">
                {language.t("novel.panel.threads.add")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                onClick={() => {
                  setTitle("")
                  setPriority("medium")
                  setDescription("")
                  setIsAdding(false)
                }}
              >
                ✕
              </ButtonV2>
            </div>
          </form>
        </Show>
      </div>

      <Show when={query.data && query.data.length === 0 && !isAdding()}>
        <p class="text-sm text-v2-text-text-muted px-3 py-8 text-center">{language.t("novel.panel.threads.empty")}</p>
      </Show>

      <Show when={openThreads().length > 0}>
        <div class="flex flex-col gap-1">
          <h4 class="text-xs font-medium text-v2-text-text-muted px-3 uppercase tracking-wider">
            {language.t("novel.panel.threads.open")} ({openThreads().length})
          </h4>
          <For each={openThreads()}>
            {(thread) => (
              <div class="flex flex-col gap-1 px-3 py-2 rounded hover:bg-v2-background-bg-layer-02 transition-colors">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-sm font-medium text-v2-text-text-base truncate">{thread.title}</span>
                    <Tag variant={priorityVariant(thread.priority)} class="shrink-0">
                      {priorityLabel(thread.priority)}
                    </Tag>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <ButtonV2
                      variant="ghost-muted"
                      size="small"
                      onClick={() =>
                        updateThread.mutate({
                          novelID: props.novelID(),
                          threadID: thread.id,
                          status: "closed",
                        })
                      }
                    >
                      {language.t("novel.panel.threads.close")}
                    </ButtonV2>
                    <ButtonV2
                      variant="danger"
                      size="small"
                      onClick={() =>
                        confirmDelete({
                          title: language.t("novel.panel.threads.delete"),
                          message: language.t("novel.panel.threads.deleteConfirm"),
                          onConfirm: () =>
                            deleteThread.mutate({
                              novelID: props.novelID(),
                              threadID: thread.id,
                            }),
                        })
                      }
                    >
                      {language.t("novel.panel.threads.delete")}
                    </ButtonV2>
                  </div>
                </div>
                <Show when={thread.description}>
                  <p class="text-xs text-v2-text-text-muted line-clamp-2">{thread.description}</p>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={closedThreads().length > 0}>
        <div class="flex flex-col gap-1">
          <h4 class="text-xs font-medium text-v2-text-text-muted px-3 uppercase tracking-wider">
            {language.t("novel.panel.threads.closed")} ({closedThreads().length})
          </h4>
          <For each={closedThreads()}>
            {(thread) => (
              <div class="flex flex-col gap-1 px-3 py-2 rounded hover:bg-v2-background-bg-layer-02 transition-colors">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-sm font-medium text-v2-text-text-base truncate">{thread.title}</span>
                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0 bg-v2-background-bg-layer-02 text-v2-text-text-muted">
                      {priorityLabel(thread.priority)}
                    </span>
                  </div>
                  <ButtonV2
                    variant="danger"
                    size="small"
                    class="shrink-0"
                    onClick={() =>
                      confirmDelete({
                        title: language.t("novel.panel.threads.delete"),
                        message: language.t("novel.panel.threads.deleteConfirm"),
                        onConfirm: () =>
                          deleteThread.mutate({
                            novelID: props.novelID(),
                            threadID: thread.id,
                          }),
                      })
                    }
                  >
                    {language.t("novel.panel.threads.delete")}
                  </ButtonV2>
                </div>
                <Show when={thread.description}>
                  <p class="text-xs text-v2-text-text-muted line-clamp-2">{thread.description}</p>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
