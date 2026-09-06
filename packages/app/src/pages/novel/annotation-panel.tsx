import { Accessor, createMemo, createSignal, For, Show } from "solid-js"
import {
  useAnnotations,
  useUpdateAnnotation,
  useDeleteAnnotation,
  useExecutionRounds,
  useCreateExecutionRound,
} from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"

type AnnotationPanelProps = {
  novelID: Accessor<string>
  chapterID: Accessor<string | null>
  onExecute?: (prompt: string) => void
}

type Translator = { t: (key: string, params?: Record<string, string | number>) => string }

// 枚举值翻译:字典缺失时回退到原始枚举值
function enumLabel(language: Translator, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = language.t(key)
  return translated === key ? value : translated
}

const statusColor: Record<string, string> = {
  open: "text-v2-state-fg-warning",
  resolved: "text-v2-state-fg-success",
  wontfix: "text-v2-text-text-faint",
  applied: "text-v2-state-fg-info",
}

type Annotation = {
  readonly id: string
  readonly status: string
  readonly source: "user" | "ai"
  readonly paragraphIndex?: number | null | undefined
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null | undefined
}

export function AnnotationPanel(props: AnnotationPanelProps) {
  const language = useLanguage()
  const annotations = useAnnotations(
    props.novelID,
    createMemo(() => props.chapterID() ?? ""),
  )
  const rounds = useExecutionRounds(
    props.novelID,
    createMemo(() => props.chapterID() ?? ""),
  )
  const updateAnnotation = useUpdateAnnotation()
  const deleteAnnotation = useDeleteAnnotation()
  const createExecutionRound = useCreateExecutionRound()
  const [filter, setFilter] = createSignal<"all" | "open" | "resolved">("all")
  const [tab, setTab] = createSignal<"current" | "history">("current")
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editComment, setEditComment] = createSignal("")
  const [editReplacement, setEditReplacement] = createSignal("")

  const filtered = createMemo(() => {
    const list = annotations.data ?? []
    if (filter() === "open") return list.filter((a) => a.status === "open")
    if (filter() === "resolved") return list.filter((a) => a.status !== "open")
    return list
  })

  const openCount = createMemo(() => (annotations.data ?? []).filter((a) => a.status === "open").length)
  const totalCount = createMemo(() => (annotations.data ?? []).length)
  const canExecute = createMemo(() => totalCount() > 0 && openCount() === 0)

  function setStatus(id: string, status: "open" | "resolved" | "wontfix" | "applied") {
    const chapterID = props.chapterID()
    if (!chapterID) return
    updateAnnotation.mutate({
      novelID: props.novelID(),
      annotationID: id,
      chapterID,
      status,
    })
  }

  function remove(id: string) {
    const chapterID = props.chapterID()
    if (!chapterID) return
    deleteAnnotation.mutate({ novelID: props.novelID(), annotationID: id, chapterID })
  }

  function execute() {
    const chapterID = props.chapterID()
    if (!chapterID || !canExecute()) return
    const list = annotations.data ?? []
    const prompt = formatPrompt(list, chapterID)
    createExecutionRound.mutate({
      novelID: props.novelID(),
      chapterID,
      promptSnapshot: prompt,
    })
    props.onExecute?.(prompt)
  }

  function startEdit(ann: Annotation) {
    setEditingId(ann.id)
    setEditComment(ann.comment)
    setEditReplacement(ann.suggestedReplacement ?? "")
  }

  function saveEdit() {
    const id = editingId()
    if (!id || !editComment().trim()) return
    updateAnnotation.mutate({
      novelID: props.novelID(),
      annotationID: id,
      chapterID: props.chapterID() ?? "",
      comment: editComment().trim(),
      suggestedReplacement: editReplacement().trim() || undefined,
    })
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  return (
    <div class="flex flex-col gap-2 p-4 overflow-y-auto h-full">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.panel.annotations")}</h3>
        <div class="flex gap-1">
          <TabButton active={tab() === "current"} onClick={() => setTab("current")}>
            {language.t("novel.annotations.tab.current")}
          </TabButton>
          <TabButton active={tab() === "history"} onClick={() => setTab("history")}>
            {language.t("novel.annotations.tab.history")}
          </TabButton>
        </div>
      </div>

      <Show when={tab() === "current"}>
        <CurrentTab
          props={props}
          annotations={annotations}
          filtered={filtered}
          filter={filter}
          setFilter={setFilter}
          setStatus={setStatus}
          remove={remove}
          canExecute={canExecute}
          execute={execute}
          editingId={editingId}
          editComment={editComment}
          editReplacement={editReplacement}
          setEditComment={setEditComment}
          setEditReplacement={setEditReplacement}
          startEdit={startEdit}
          saveEdit={saveEdit}
          cancelEdit={cancelEdit}
        />
      </Show>

      <Show when={tab() === "history"}>
        <HistoryTab rounds={rounds} annotations={annotations} setStatus={setStatus} />
      </Show>
    </div>
  )
}

function formatPrompt(list: readonly Annotation[], chapterTitle: string): string {
  const applied: string[] = []
  const resolved: string[] = []
  const wontfix: string[] = []

  for (const ann of list) {
    const p = ann.paragraphIndex != null ? `段落 ${ann.paragraphIndex + 1}` : "全章"
    if (ann.status === "applied" && ann.suggestedReplacement) {
      const quote = ann.quote ? `「${ann.quote}」` : ""
      applied.push(`- ${p}：将${quote}替换为「${ann.suggestedReplacement}」`)
    } else if (ann.status === "resolved") {
      resolved.push(`- ${p}：「${ann.comment}」`)
    } else if (ann.status === "wontfix") {
      wontfix.push(`- ${p}`)
    }
  }

  const sections: string[] = [`请按以下批注修改${chapterTitle}正文：`]
  if (applied.length > 0) {
    sections.push("\n## 需要应用替换的段落（采纳）\n" + applied.join("\n"))
  }
  if (resolved.length > 0) {
    sections.push("\n## 需要根据意见改写的段落（解决）\n" + resolved.join("\n"))
  }
  if (wontfix.length > 0) {
    sections.push("\n## 需要跳过的段落（不修）\n" + wontfix.join("\n"))
  }
  sections.push("\n修改完成后请检查替换段落与前后文的衔接是否连贯。")
  return sections.join("\n")
}

function CurrentTab(props: {
  props: AnnotationPanelProps
  annotations: { data: readonly Annotation[] | undefined; isLoading: boolean }
  filtered: Accessor<readonly Annotation[]>
  filter: Accessor<"all" | "open" | "resolved">
  setFilter: (f: "all" | "open" | "resolved") => void
  setStatus: (id: string, status: "open" | "resolved" | "wontfix" | "applied") => void
  remove: (id: string) => void
  canExecute: Accessor<boolean>
  execute: () => void
  editingId: Accessor<string | null>
  editComment: Accessor<string>
  editReplacement: Accessor<string>
  setEditComment: (v: string) => void
  setEditReplacement: (v: string) => void
  startEdit: (ann: Annotation) => void
  saveEdit: () => void
  cancelEdit: () => void
}) {
  const language = useLanguage()

  return (
    <>
      <div class="flex gap-1">
        <FilterButton active={props.filter() === "all"} onClick={() => props.setFilter("all")}>
          {language.t("novel.annotations.filter.all")}
        </FilterButton>
        <FilterButton active={props.filter() === "open"} onClick={() => props.setFilter("open")}>
          {language.t("novel.annotations.status.open")}
        </FilterButton>
        <FilterButton active={props.filter() === "resolved"} onClick={() => props.setFilter("resolved")}>
          {language.t("novel.annotations.status.resolved")}
        </FilterButton>
      </div>

      <Show when={props.annotations.isLoading}>
        <Spinner />
      </Show>

      <Show when={!props.annotations.isLoading && props.filtered().length === 0}>
        <p class="text-xs text-v2-text-text-faint py-4 text-center">{language.t("novel.annotations.empty")}</p>
      </Show>

      <For each={props.filtered()}>
        {(ann) => (
          <AnnotationCard
            ann={ann}
            setStatus={props.setStatus}
            remove={props.remove}
            editingId={props.editingId}
            editComment={props.editComment}
            editReplacement={props.editReplacement}
            setEditComment={props.setEditComment}
            setEditReplacement={props.setEditReplacement}
            startEdit={props.startEdit}
            saveEdit={props.saveEdit}
            cancelEdit={props.cancelEdit}
          />
        )}
      </For>

      <div class="mt-auto pt-4 flex flex-col gap-1.5">
        <p class="text-xs text-v2-text-text-faint">
          {props.canExecute()
            ? language.t("novel.annotations.execute.hint")
            : language.t("novel.annotations.execute.pending")}
        </p>
        <button
          type="button"
          disabled={!props.canExecute()}
          onClick={props.execute}
          class="w-full rounded-md px-4 py-2 text-sm font-medium transition-colors"
          classList={{
            "bg-blue-600 text-white hover:bg-blue-700 cursor-pointer": props.canExecute(),
            "bg-neutral-700 text-neutral-500 cursor-not-allowed": !props.canExecute(),
          }}
        >
          {language.t("novel.annotations.execute")}
        </button>
      </div>
    </>
  )
}

function AnnotationCard(props: {
  ann: Annotation
  setStatus: (id: string, status: "open" | "resolved" | "wontfix" | "applied") => void
  remove: (id: string) => void
  editingId: Accessor<string | null>
  editComment: Accessor<string>
  editReplacement: Accessor<string>
  setEditComment: (v: string) => void
  setEditReplacement: (v: string) => void
  startEdit: (ann: Annotation) => void
  saveEdit: () => void
  cancelEdit: () => void
}) {
  const language = useLanguage()
  const ann = props.ann
  const isEditing = createMemo(() => props.editingId() === ann.id)

  return (
    <div class="rounded border border-v2-border-border-base p-2 flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class={`text-xs font-medium ${statusColor[ann.status] ?? ""}`}>
            {enumLabel(language, "novel.annotations.status", ann.status)}
          </span>
          <Show when={ann.source === "ai"}>
            <span class="text-xs px-1 py-0.5 rounded bg-v2-background-bg-layer-01 text-v2-text-text-faint">AI</span>
          </Show>
          <Show when={ann.suggestedReplacement}>
            <span class="text-xs px-1 py-0.5 rounded bg-v2-state-bg-info text-v2-state-fg-info">{language.t("novel.annotations.polish")}</span>
          </Show>
        </div>
        <Show when={ann.paragraphIndex != null}>
          <span class="text-xs text-v2-text-text-faint">P{ann.paragraphIndex! + 1}</span>
        </Show>
      </div>

      <Show when={ann.quote}>
        <blockquote class="text-xs text-v2-text-text-faint border-l-2 border-v2-border-border-base pl-2 italic truncate">
          {ann.quote}
        </blockquote>
      </Show>

<Show when={!isEditing()} fallback={
        <div class="flex flex-col gap-1.5">
          <textarea
            class="w-full rounded border border-v2-border-border-base bg-v2-background-bg-base p-2 text-xs text-v2-text-text-base resize-none"
            rows={3}
            value={props.editComment()}
            onInput={(e) => props.setEditComment(e.currentTarget.value)}
          />
          <input
            class="w-full rounded border border-v2-border-border-base bg-v2-background-bg-base p-2 text-xs text-v2-text-text-base"
            placeholder={language.t("novel.annotations.editSuggestion")}
            value={props.editReplacement()}
            onInput={(e) => props.setEditReplacement(e.currentTarget.value)}
          />
          <div class="flex gap-1 justify-end">
            <ButtonV2 size="small" variant="ghost" onClick={props.cancelEdit}>
              {language.t("common.cancel")}
            </ButtonV2>
            <ButtonV2 size="small" variant="contrast" disabled={!props.editComment().trim()} onClick={props.saveEdit}>
              {language.t("novel.annotations.save")}
            </ButtonV2>
          </div>
        </div>
      }>
        <p class="text-xs text-v2-text-text-base">{ann.comment}</p>
        <Show when={ann.suggestedReplacement}>
          <div class="rounded bg-v2-background-bg-layer-01 p-1.5 text-xs text-v2-text-text-muted">
            <span class="text-v2-text-text-faint">{language.t("novel.annotations.suggestion")} </span>
            {ann.suggestedReplacement}
          </div>
        </Show>
      </Show>

      <Show when={ann.status === "open" && !isEditing()}>
        <div class="flex gap-1 mt-1">
          <Show when={ann.suggestedReplacement}>
            <ButtonV2 size="small" variant="contrast" title={language.t("novel.annotations.adopt.hint")} onClick={() => props.setStatus(ann.id, "applied")}>
              {language.t("novel.annotations.apply")}
            </ButtonV2>
          </Show>
          <ButtonV2 size="small" variant="outline" onClick={() => props.setStatus(ann.id, "resolved")}>
            {language.t("novel.annotations.resolve")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.startEdit(ann)}>
            {language.t("novel.annotations.edit")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(ann.id, "wontfix")}>
            {language.t("novel.annotations.dismiss")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.remove(ann.id)}>
            {language.t("common.delete")}
          </ButtonV2>
        </div>
      </Show>

      <Show when={ann.status !== "open" && !isEditing()}>
        <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(ann.id, "open")}>
          {language.t("novel.annotations.reopen")}
        </ButtonV2>
      </Show>
    </div>
  )
}

function HistoryTab(props: {
  rounds: { data: ReadonlyArray<{ readonly id: string; readonly promptSnapshot: string; readonly createdAt: number }> | undefined; isLoading: boolean }
  annotations: { data: readonly Annotation[] | undefined }
  setStatus: (id: string, status: "open" | "resolved" | "wontfix" | "applied") => void
}) {
  const language = useLanguage()
  const roundList = createMemo(() => props.rounds.data ?? [])
  const processedAnnotations = createMemo(() => (props.annotations.data ?? []).filter((a) => a.status !== "open"))

  return (
    <>
      <Show when={props.rounds.isLoading}>
        <Spinner />
      </Show>
      <Show when={!props.rounds.isLoading && roundList().length === 0 && processedAnnotations().length === 0}>
        <p class="text-xs text-v2-text-text-faint py-4 text-center">{language.t("novel.annotations.history.empty")}</p>
      </Show>
      <For each={roundList()}>
        {(round) => (
          <div class="rounded border border-v2-border-border-base p-2 flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-v2-text-text-base">{language.t("novel.annotations.history.round")}</span>
              <span class="text-xs text-v2-text-text-faint">{new Date(round.createdAt).toLocaleString()}</span>
            </div>
            <p class="text-xs text-v2-text-text-faint line-clamp-2 whitespace-pre-wrap">{round.promptSnapshot}</p>
          </div>
        )}
      </For>
      <For each={processedAnnotations()}>
        {(ann) => (
          <div class="rounded border border-v2-border-border-base p-2 flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class={`text-xs font-medium ${statusColor[ann.status] ?? ""}`}>
                {enumLabel(language, "novel.annotations.status", ann.status)}
              </span>
              <Show when={ann.paragraphIndex != null}>
                <span class="text-xs text-v2-text-text-faint">P{ann.paragraphIndex! + 1}</span>
              </Show>
            </div>
            <p class="text-xs text-v2-text-text-base">{ann.comment}</p>
            <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(ann.id, "open")}>
              {language.t("novel.annotations.reactivate")}
            </ButtonV2>
          </div>
        )}
      </For>
    </>
  )
}

function FilterButton(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      class={`text-xs px-2 py-0.5 rounded transition-colors ${
        props.active
          ? "bg-v2-background-bg-layer-01 text-v2-text-text-base"
          : "text-v2-text-text-faint hover:text-v2-text-text-base"
      }`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      class={`text-xs px-2 py-0.5 rounded transition-colors ${
        props.active
          ? "bg-v2-background-bg-layer-01 text-v2-text-text-base font-semibold"
          : "text-v2-text-text-faint hover:text-v2-text-text-base"
      }`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
