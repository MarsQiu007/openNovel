/**
 * 设定批注面板：当前批注管理、历史轮次和受会话状态控制的 AI 执行入口。
 */
import { Accessor, createMemo, createSignal, For, Show } from "solid-js"
import {
  useBoundNovelSessions,
  useCreateSettingAnnotationRound,
  useDeleteSettingAnnotation,
  useSettingAnnotationRounds,
  useSettingAnnotations,
  useUpdateSettingAnnotation,
  useUpdateSettingAnnotationRound,
} from "@/context/novel-queries"
import { useSync } from "@/context/sync"
import { isAnySessionWorking } from "@/context/novel-approval"
import { executeSettingAnnotationExecution } from "./setting-annotation-execution"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"

type SettingAnnotation = {
  readonly id: string
  readonly status: "open" | "resolved" | "wontfix" | "applied"
  readonly paragraphIndex?: number | null
  readonly startOffset?: number | null
  readonly endOffset?: number | null
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null
  readonly executionRoundId?: string | null
}

type SettingAnnotationPanelProps = {
  readonly novelID: Accessor<string>
  readonly entryID: Accessor<string>
  readonly entryTitle: Accessor<string>
  readonly content: Accessor<string>
  readonly onExecute?: (args: { prompt: string; roundID: string }) => Promise<string | null | undefined> | string | null | undefined
  readonly onSessionFocused?: (sessionID: string | null | undefined) => void
}

const statusColor: Record<string, string> = {
  open: "text-v2-state-fg-warning",
  resolved: "text-v2-state-fg-success",
  wontfix: "text-v2-text-text-faint",
  applied: "text-v2-state-fg-info",
}

const statusLabel: Record<string, string> = {
  open: "待处理",
  resolved: "已解决",
  wontfix: "不处理",
  applied: "已采纳",
}

export function SettingAnnotationPanel(props: SettingAnnotationPanelProps) {
  const annotations = useSettingAnnotations(props.novelID, props.entryID)
  const rounds = useSettingAnnotationRounds(props.novelID, props.entryID)
  const boundSessions = useBoundNovelSessions(props.novelID)
  const sync = useSync()
  const updateAnnotation = useUpdateSettingAnnotation()
  const deleteAnnotation = useDeleteSettingAnnotation()
  const createRound = useCreateSettingAnnotationRound()
  const updateRound = useUpdateSettingAnnotationRound()
  const [tab, setTab] = createSignal<"current" | "history">("current")
  const [isExecuting, setIsExecuting] = createSignal(false)

  const activeAnnotations = createMemo(() => (annotations.data ?? []).filter((ann) => !ann.executionRoundId))
  const sessionBusy = createMemo(() =>
    isAnySessionWorking(
      (boundSessions.data ?? []).map((session) => session.sessionID),
      (sessionID) => sync().data.session_working(sessionID),
    ),
  )
  const openCount = createMemo(() => activeAnnotations().filter((ann) => ann.status === "open").length)
  const canExecute = createMemo(
    () => !isExecuting() && !sessionBusy() && activeAnnotations().length > 0 && openCount() === 0,
  )

  function setStatus(id: string, status: SettingAnnotation["status"]) {
    updateAnnotation.mutate({ novelID: props.novelID(), entryID: props.entryID(), annotationID: id, status })
  }

  function remove(id: string) {
    deleteAnnotation.mutate({ novelID: props.novelID(), entryID: props.entryID(), annotationID: id })
  }

  function reactivate(ids: readonly string[]) {
    for (const id of ids) {
      updateAnnotation.mutate({
        novelID: props.novelID(),
        entryID: props.entryID(),
        annotationID: id,
        status: "open",
        executionRoundId: null,
      })
    }
  }

  async function execute() {
    if (!canExecute()) return
    setIsExecuting(true)
    try {
      const paragraphs = props.content().split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
      const sessionID = await executeSettingAnnotationExecution(
        {
          entryID: props.entryID(),
          entryTitle: props.entryTitle(),
          paragraphs,
          annotations: activeAnnotations(),
        },
        {
          createRound: ({ promptSnapshot, annotationsSnapshot }) =>
            createRound.mutateAsync({
              novelID: props.novelID(),
              entryID: props.entryID(),
              promptSnapshot,
              annotationsSnapshot,
            }),
          updateRoundPrompt: ({ roundID, promptSnapshot }) =>
            updateRound.mutateAsync({
              novelID: props.novelID(),
              entryID: props.entryID(),
              roundID,
              promptSnapshot,
            }).then(() => undefined),
          sendPrompt: async ({ prompt, roundID }) => await props.onExecute?.({ prompt, roundID }),
          associateAnnotations: ({ roundID, annotations: linked }) =>
            Promise.all(
              linked.map((ann) =>
                updateAnnotation.mutateAsync({
                  novelID: props.novelID(),
                  entryID: props.entryID(),
                  annotationID: ann.id,
                  executionRoundId: roundID,
                }),
              ),
            ).then(() => undefined),
          failRound: ({ roundID, resultSummary }) =>
            updateRound.mutateAsync({
              novelID: props.novelID(),
              entryID: props.entryID(),
              roundID,
              status: "failed",
              resultSummary,
            }).then(() => undefined),
        },
      )
      props.onSessionFocused?.(sessionID)
    } catch (error) {
      console.error("setting annotation execution failed", error)
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div class="flex h-full min-h-0 flex-col border-t border-v2-border-border-base">
      <div class="flex items-center justify-between px-4 py-2">
        <h3 class="text-sm font-semibold text-v2-text-text-base">设定批注</h3>
        <div class="flex gap-1">
          <button
            class={`rounded px-2 py-0.5 text-xs ${tab() === "current" ? "bg-v2-background-bg-layer-01 font-semibold" : "text-v2-text-text-muted"}`}
            onClick={() => setTab("current")}
          >
            当前
          </button>
          <button
            class={`rounded px-2 py-0.5 text-xs ${tab() === "history" ? "bg-v2-background-bg-layer-01 font-semibold" : "text-v2-text-text-muted"}`}
            onClick={() => setTab("history")}
          >
            历史
          </button>
        </div>
      </div>

      <Show when={tab() === "current"}>
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
          <Show when={annotations.isLoading}>
            <Spinner />
          </Show>
          <Show when={!annotations.isLoading && activeAnnotations().length === 0}>
            <p class="py-3 text-center text-xs text-v2-text-text-faint">选中设定文字可创建批注。</p>
          </Show>
          <For each={activeAnnotations()}>
            {(ann) => (
              <div class="rounded border border-v2-border-border-base p-2">
                <div class="flex items-center justify-between">
                  <span class={`text-xs font-medium ${statusColor[ann.status] ?? ""}`}>{statusLabel[ann.status] ?? ann.status}</span>
                  <Show when={ann.paragraphIndex != null}>
                    <span class="text-xs text-v2-text-text-faint">第 {ann.paragraphIndex! + 1} 段</span>
                  </Show>
                </div>
                <p class="mt-1 text-xs text-v2-text-text-base">{ann.comment}</p>
                <Show when={ann.quote}>
                  <p class="mt-1 line-clamp-2 text-xs text-v2-text-text-faint">{ann.quote}</p>
                </Show>
                <Show when={ann.suggestedReplacement}>
                  <p class="mt-1 line-clamp-2 text-xs text-v2-text-text-muted">建议：{ann.suggestedReplacement}</p>
                </Show>
                <div class="mt-2 flex flex-wrap justify-end gap-1">
                  <Show when={ann.status === "open"}>
                    <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "resolved")}>已解决</ButtonV2>
                    <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "applied")}>采纳</ButtonV2>
                    <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "wontfix")}>不处理</ButtonV2>
                  </Show>
                  <Show when={ann.status !== "open"}>
                    <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "open")}>重新打开</ButtonV2>
                  </Show>
                  <ButtonV2 size="small" variant="ghost" onClick={() => remove(ann.id)}>删除</ButtonV2>
                </div>
              </div>
            )}
          </For>
          <ButtonV2 class="mt-2" size="small" variant="contrast" onClick={() => void execute()} disabled={!canExecute()}>
            {isExecuting() || sessionBusy() ? "执行中..." : "执行批注"}
          </ButtonV2>
        </div>
      </Show>

      <Show when={tab() === "history"}>
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
          <Show when={rounds.isLoading}>
            <Spinner />
          </Show>
          <Show when={!rounds.isLoading && (rounds.data ?? []).length === 0}>
            <p class="py-3 text-center text-xs text-v2-text-text-faint">还没有执行历史。</p>
          </Show>
          <For each={rounds.data ?? []}>
            {(round) => (
              <div class="rounded border border-v2-border-border-base p-2">
                <div class="flex items-center justify-between">
                  <span class={`text-xs font-medium ${
                    round.status === "completed"
                      ? "text-v2-state-fg-success"
                      : round.status === "failed" || round.status === "interrupted"
                        ? "text-v2-state-fg-warning"
                        : "text-v2-state-fg-info"
                  }`}>
                    {round.status === "completed" ? "已完成" : round.status === "failed" ? "执行失败" : round.status === "interrupted" ? "已中断" : "执行中"}
                  </span>
                  <span class="text-xs text-v2-text-text-faint">{new Date(round.createdAt).toLocaleString()}</span>
                </div>
                <p class="mt-1 text-xs text-v2-text-text-base">{round.resultSummary || "等待 AI 回填结果。"}</p>
                <p class="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-v2-text-text-faint">{round.promptSnapshot}</p>
                <div class="mt-2 flex justify-end">
                  <ButtonV2 size="small" variant="ghost" onClick={() => reactivate(round.annotationsSnapshot.map((ann) => ann.id))}>
                    重新激活
                  </ButtonV2>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export type { SettingAnnotation }
export function SettingAnnotationCreateForm(props: {
  quote: Accessor<string>
  comment: Accessor<string>
  replacement: Accessor<string>
  pending: boolean
  onComment: (value: string) => void
  onReplacement: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div class="rounded border border-v2-border-border-base p-3">
      <p class="line-clamp-2 text-xs text-v2-text-text-faint">{props.quote()}</p>
      <TextareaV2
        class="mt-2"
        rows={3}
        fluid
        value={props.comment()}
        onInput={(event) => props.onComment(event.currentTarget.value)}
        placeholder="批注意见"
      />
      <TextInputV2
        class="mt-2"
        fluid
        value={props.replacement()}
        onInput={(event) => props.onReplacement(event.currentTarget.value)}
        placeholder="可选替换建议（纯文本）"
      />
      <div class="mt-2 flex justify-end gap-2">
        <ButtonV2 size="small" variant="ghost-muted" onClick={props.onCancel}>取消</ButtonV2>
        <ButtonV2 size="small" variant="contrast" onClick={props.onSubmit} disabled={props.pending || !props.comment().trim()}>
          保存批注
        </ButtonV2>
      </div>
    </div>
  )
}