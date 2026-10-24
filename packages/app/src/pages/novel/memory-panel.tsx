/**
 * 记忆面板 — 设定树「AI 设定 > 记忆」节点视图（agent-memory-ui）。
 *
 * 作者侧人工闸门：查看/过滤 AI 沉淀的记忆卡（memory_fact），行内修正陈述与
 * 关联实体、批准（直达 approved）、作废（留痕）、撤销整理合并、登记作者手记、
 * 只读维护报告、「交给 AI 处理」指令移交（同设定收件箱通道）。
 * 形态复用收件箱惯例：SegmentedControl 过滤、平铺卡片、行内展开、「加载更多」分页。
 */
import { type Accessor, For, Show, createMemo, createSignal } from "solid-js"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import type { MemoryFactItem, MemoryFactStatus } from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import {
  useChapters,
  useMemoryFactCounts,
  useMemoryFactItems,
  useMemoryMaintenance,
  useNovelClient,
  useBindSession,
  type MemoryFactListFilter,
} from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { useNovel } from "@/context/novel"
import { useLanguage } from "@/context/language"
import { sendNovelSessionInstruction } from "./workspace-data"
import {
  MEMORY_PAGE_SIZE,
  MEMORY_STATUS_FILTERS,
  buildHandoffPrompt,
  canApprove,
  canEdit,
  canRetire,
  canUnmerge,
  chapterRefLabel,
  statusLabel,
  statusTagVariant,
} from "./memory-panel-data"

type MemoryPanelProps = {
  novelID: Accessor<string>
}

type PanelKind = "edit" | "note" | "retire-confirm"

export function MemoryPanel(props: MemoryPanelProps) {
  const client = useNovelClient()
  const sdk = useSDK()
  const novel = useNovel()
  const bindSession = useBindSession()
  const queryClient = useQueryClient()
  const language = useLanguage()
  const t = language.t

  const [statusFilter, setStatusFilter] = createSignal<MemoryFactStatus | null>(null)
  const [factTypeFilter, setFactTypeFilter] = createSignal("")
  const [chapterFilter, setChapterFilter] = createSignal<string | null>(null)
  const [keyword, setKeyword] = createSignal("")
  const [limit, setLimit] = createSignal(MEMORY_PAGE_SIZE)
  const [panel, setPanel] = createSignal<{ id: string; kind: PanelKind } | null>(null)
  const [editText, setEditText] = createSignal("")
  const [editEntityHint, setEditEntityHint] = createSignal("")
  const [noteText, setNoteText] = createSignal("")
  const [noteFormOpen, setNoteFormOpen] = createSignal(false)
  const [noteFactText, setNoteFactText] = createSignal("")
  const [noteQuote, setNoteQuote] = createSignal("")
  const [noteChapterId, setNoteChapterId] = createSignal<string | null>(null)
  const [reportOpen, setReportOpen] = createSignal(false)
  const [status, setStatus] = createSignal<{ kind: "ok" | "error"; lines: string[] } | null>(null)

  const filter = createMemo<MemoryFactListFilter>(() => ({
    status: statusFilter(),
    factType: factTypeFilter().trim(),
    chapterId: chapterFilter(),
    q: keyword().trim(),
  }))

  const counts = useMemoryFactCounts(props.novelID)
  const itemsQuery = useMemoryFactItems(props.novelID, filter, limit)
  const maintenance = useMemoryMaintenance(props.novelID)
  const chaptersQuery = useChapters(props.novelID)
  const chapters = createMemo(() => [...(chaptersQuery.data ?? [])].sort((a, b) => a.order - b.order))

  function refreshMemory() {
    const dir = sdk().directory
    void queryClient.invalidateQueries({ queryKey: ["novel", "memory-fact-counts", dir, props.novelID()] })
    void queryClient.invalidateQueries({ queryKey: ["novel", "memory-fact-items", dir, props.novelID()] })
    void queryClient.invalidateQueries({ queryKey: ["novel", "memory-maintenance", dir, props.novelID()] })
  }

  // 操作统一收尾：成功提示 + 收起行内面板 + 失效联动（徽标计数随处理递减）
  function handleResult(result: { ok: boolean; error?: string }, okKey: string) {
    if (result.ok) {
      setStatus({ kind: "ok", lines: [t(okKey as never)] })
      setPanel(null)
      refreshMemory()
      return
    }
    setStatus({ kind: "error", lines: [result.error ?? t("novel.settings.memory.error.unknown" as never)] })
  }

  function handleError(error: unknown) {
    setStatus({ kind: "error", lines: [String(error)] })
  }

  const approveFact = useMutation(() => ({
    mutationFn: (factID: string) =>
      client()["server.novel"]["fact-approve"]({
        novelID: props.novelID(),
        factID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.memory.ok.approved"),
    onError: handleError,
  }))

  const editFact = useMutation(() => ({
    mutationFn: (input: { factID: string; text?: string; entityHint?: string | null }) =>
      client()["server.novel"]["fact-edit"]({
        novelID: props.novelID(),
        factID: input.factID,
        location: { directory: sdk().directory },
        text: input.text,
        entityHint: input.entityHint,
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.memory.ok.edited"),
    onError: handleError,
  }))

  const retireFact = useMutation(() => ({
    mutationFn: (factID: string) =>
      client()["server.novel"]["fact-retire"]({
        novelID: props.novelID(),
        factID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.memory.ok.retired"),
    onError: handleError,
  }))

  const unmergeFact = useMutation(() => ({
    mutationFn: (factID: string) =>
      client()["server.novel"]["fact-unmerge"]({
        novelID: props.novelID(),
        factID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.memory.ok.unmerged"),
    onError: handleError,
  }))

  const createNote = useMutation(() => ({
    mutationFn: (input: { text: string; quote?: string; chapterId?: string }) =>
      client()["server.novel"]["fact-create"]({
        novelID: props.novelID(),
        location: { directory: sdk().directory },
        text: input.text,
        quote: input.quote,
        chapterId: input.chapterId,
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setStatus({ kind: "ok", lines: [t("novel.settings.memory.ok.created" as never)] })
        setNoteFormOpen(false)
        setNoteFactText("")
        setNoteQuote("")
        setNoteChapterId(null)
        refreshMemory()
        return
      }
      setStatus({ kind: "error", lines: [result.error ?? ""] })
    },
    onError: handleError,
  }))

  const sendInstruction = useMutation(() => ({
    mutationFn: (prompt: string) =>
      sendNovelSessionInstruction({ sdk, novel, bindSession, novelID: props.novelID(), prompt }),
    onSuccess: () => {
      setStatus({ kind: "ok", lines: [t("novel.settings.memory.ok.handoff" as never)] })
      setPanel(null)
    },
    onError: handleError,
  }))

  function togglePanel(item: MemoryFactItem, kind: PanelKind) {
    setPanel((prev) => (prev?.id === item.id && prev.kind === kind ? null : { id: item.id, kind }))
    setNoteText("")
    setEditText(item.text)
    setEditEntityHint(item.entityHint ?? "")
  }

  function submitEdit(item: MemoryFactItem) {
    const text = editText().trim()
    if (text === "") {
      setStatus({ kind: "error", lines: [t("novel.settings.memory.error.editEmpty" as never)] })
      return
    }
    const entityHint = editEntityHint().trim()
    void editFact.mutateAsync({
      factID: item.id,
      text: text === item.text ? undefined : text,
      entityHint: entityHint === (item.entityHint ?? "") ? undefined : entityHint === "" ? null : entityHint,
    })
  }

  function submitNote() {
    const text = noteFactText().trim()
    if (text === "") {
      setStatus({ kind: "error", lines: [t("novel.settings.memory.error.editEmpty" as never)] })
      return
    }
    const quote = noteQuote().trim()
    void createNote.mutateAsync({
      text,
      quote: quote === "" ? undefined : quote,
      chapterId: noteChapterId() ?? undefined,
    })
  }

  return (
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-lg font-bold">{t("novel.settings.memory.title" as never)}</h2>
          <Show when={counts.data}>
            {(data) => <div class="text-xs text-v2-text-text-muted">{t("novel.settings.memory.total" as never, { count: data().total })}</div>}
          </Show>
        </div>
        <ButtonV2 variant="neutral" size="small" onClick={() => setNoteFormOpen((open) => !open)}>
          {t("novel.settings.memory.note.toggle" as never)}
        </ButtonV2>
      </div>

      <Show when={status()}>
        {(data) => (
          <div
            class={`rounded-md border p-3 text-sm ${
              data().kind === "ok"
                ? "border-v2-border-border-base text-v2-state-fg-success"
                : "border-v2-state-border-danger text-v2-state-fg-danger"
            }`}
          >
            <For each={data().lines}>{(line) => <div class="break-all">{line}</div>}</For>
          </div>
        )}
      </Show>

      {/* —— 手记登记表单（D7：陈述必填，引句与章节可选锚点） —— */}
      <Show when={noteFormOpen()}>
        <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base p-3">
          <div class="text-sm font-semibold">{t("novel.settings.memory.note.title" as never)}</div>
          <TextareaV2
            value={noteFactText()}
            onInput={(event) => setNoteFactText(event.currentTarget.value)}
            placeholder={t("novel.settings.memory.note.textPlaceholder" as never)}
            rows={2}
          />
          <TextareaV2
            value={noteQuote()}
            onInput={(event) => setNoteQuote(event.currentTarget.value)}
            placeholder={t("novel.settings.memory.note.quotePlaceholder" as never)}
            rows={2}
          />
          <SelectV2
            options={[null, ...chapters().map((chapter) => chapter.id)] as (string | null)[]}
            current={noteChapterId()}
            label={(id) =>
              id === null
                ? t("novel.settings.memory.note.chapterNone" as never)
                : (chapters().find((chapter) => chapter.id === id)?.title ?? id)
            }
            onSelect={(id) => setNoteChapterId(id ?? null)}
          />
          <div class="flex justify-end">
            <ButtonV2 variant="contrast" size="small" disabled={createNote.isPending} onClick={submitNote}>
              {t("novel.settings.memory.note.submit" as never)}
            </ButtonV2>
          </div>
        </div>
      </Show>

      {/* —— 维护报告（只读，不提供任何自动动作） —— */}
      <Show when={maintenance.data}>
        {(report) => (
          <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base p-3">
            <button type="button" class="flex items-center justify-between text-left" onClick={() => setReportOpen((open) => !open)}>
              <span class="text-sm font-semibold">{t("novel.settings.memory.maintenance.title" as never)}</span>
              <span class="text-xs text-v2-text-text-muted">
                {t("novel.settings.memory.maintenance.summary" as never, {
                  zombies: report().zombieFacts.length,
                  stalled: report().planned.filter((item) => item.stalled).length,
                })}
              </span>
            </button>
            <Show when={reportOpen()}>
              <div class="flex flex-col gap-1.5 text-xs text-v2-text-text-muted">
                <Show when={report().zombieFacts.length > 0}>
                  <div>{t("novel.settings.memory.maintenance.zombies" as never, { count: report().zombieFacts.length })}</div>
                  <For each={report().zombieFacts.slice(0, 10)}>
                    {(zombie) => (
                      <div class="break-all pl-3">
                        · {zombie.text}
                        <Show when={zombie.chapterOrder !== null}>
                          {" "}
                          ({t("novel.settings.memory.chapterRef" as never, { order: zombie.chapterOrder! })})
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
                <Show when={report().planned.length > 0}>
                  <div>
                    {t("novel.settings.memory.maintenance.planned" as never, {
                      count: report().planned.filter((item) => item.stalled).length,
                      threshold: report().stalledThreshold,
                    })}
                  </div>
                  <For each={report().planned.filter((item) => item.stalled)}>
                    {(item) => (
                      <div class="break-all pl-3">
                        · {item.title}（{t("novel.settings.memory.maintenance.plannedSince" as never, { count: item.chaptersSince })}）
                      </div>
                    )}
                  </For>
                </Show>
                <div>
                  {t("novel.settings.memory.maintenance.retired" as never, {
                    facts: report().retiredStats.facts,
                    techniques: report().retiredStats.techniques,
                  })}
                </div>
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* —— 过滤行：状态 / 关键词 / 事实类型 / 所属章节 —— */}
      <div class="flex flex-wrap items-center gap-2">
        <SegmentedControlV2
          value={statusFilter() ?? "all"}
          onChange={(value) => {
            setStatusFilter(value === "all" ? null : (value as MemoryFactStatus))
            setLimit(MEMORY_PAGE_SIZE)
          }}
        >
          <For each={[...MEMORY_STATUS_FILTERS]}>
            {(value) => <SegmentedControlItemV2 value={value}>{statusLabel(value, t)}</SegmentedControlItemV2>}
          </For>
        </SegmentedControlV2>
        <TextInputV2
          value={keyword()}
          onInput={(event) => {
            setKeyword(event.currentTarget.value)
            setLimit(MEMORY_PAGE_SIZE)
          }}
          placeholder={t("novel.settings.memory.keywordPlaceholder" as never)}
          class="w-48"
        />
        <TextInputV2
          value={factTypeFilter()}
          onInput={(event) => {
            setFactTypeFilter(event.currentTarget.value)
            setLimit(MEMORY_PAGE_SIZE)
          }}
          placeholder={t("novel.settings.memory.factTypePlaceholder" as never)}
          class="w-32"
        />
        <SelectV2
          options={[null, ...chapters().map((chapter) => chapter.id)] as (string | null)[]}
          current={chapterFilter()}
          label={(id) =>
            id === null
              ? t("novel.settings.memory.chapterAll" as never)
              : (chapters().find((chapter) => chapter.id === id)?.title ?? id)
          }
          onSelect={(id) => {
            setChapterFilter(id ?? null)
            setLimit(MEMORY_PAGE_SIZE)
          }}
        />
      </div>

      <Show when={itemsQuery.isLoading}>
        <div class="flex items-center justify-center py-8">
          <Spinner class="h-5 w-5 text-v2-text-text-muted" />
        </div>
      </Show>
      <Show when={itemsQuery.error}>
        <div class="rounded-md border border-v2-state-border-danger p-3 text-sm text-v2-state-fg-danger">
          {String(itemsQuery.error)}
        </div>
      </Show>
      <Show when={itemsQuery.data}>
        {(data) => (
          <Show
            when={data().items.length > 0}
            fallback={<div class="rounded-md border border-v2-border-border-base p-4 text-sm">{t("novel.settings.memory.empty" as never)}</div>}
          >
            <div class="flex flex-col gap-2">
              <For each={data().items}>
                {(item) => (
                  <div data-testid="memory-fact-card" data-status={item.status} data-id={item.id} class="flex flex-col gap-2 rounded-md border border-v2-border-border-base p-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Tag variant={statusTagVariant(item.status)}>{statusLabel(item.status, t)}</Tag>
                      <span class="text-xs text-v2-text-text-muted">{item.factType}</span>
                      <Show when={item.createdBy === "author"}>
                        <Tag variant="accent">{t("novel.settings.memory.createdBy.author" as never)}</Tag>
                      </Show>
                      <span class="text-xs text-v2-text-text-faint">
                        {chapterRefLabel(item, t)}
                        {" · "}
                        {t("novel.settings.memory.confidence" as never, { value: item.confidence })}
                      </span>
                    </div>
                    <div class="break-all text-sm">{item.text}</div>
                    <Show when={item.quote}>
                      {(quote) => (
                        <div class="break-all text-xs text-v2-text-text-muted">
                          {t("novel.settings.memory.quote" as never)}：{quote()}
                        </div>
                      )}
                    </Show>
                    <Show when={item.entityHint}>
                      {(hint) => <div class="text-xs text-v2-text-text-faint">{t("novel.settings.memory.entityHint" as never)}：{hint()}</div>}
                    </Show>
                    <Show when={canUnmerge(item)}>
                      <div class="text-xs text-v2-text-text-faint">{t("novel.settings.memory.mergedInto" as never)}</div>
                    </Show>

                    <div class="flex flex-wrap items-center gap-2">
                      <Show when={canApprove(item)}>
                        <ButtonV2
                          variant="contrast"
                          size="small"
                          disabled={approveFact.isPending}
                          onClick={() => void approveFact.mutateAsync(item.id)}
                        >
                          {t("novel.settings.memory.action.approve" as never)}
                        </ButtonV2>
                      </Show>
                      <Show when={canEdit(item)}>
                        <ButtonV2 variant="neutral" size="small" onClick={() => togglePanel(item, "edit")}>
                          {t("novel.settings.memory.action.edit" as never)}
                        </ButtonV2>
                      </Show>
                      <Show when={canRetire(item)}>
                        <ButtonV2 variant="neutral" size="small" onClick={() => togglePanel(item, "retire-confirm")}>
                          {t("novel.settings.memory.action.retire" as never)}
                        </ButtonV2>
                      </Show>
                      <Show when={canUnmerge(item)}>
                        <ButtonV2
                          variant="neutral"
                          size="small"
                          disabled={unmergeFact.isPending}
                          onClick={() => void unmergeFact.mutateAsync(item.id)}
                        >
                          {t("novel.settings.memory.action.unmerge" as never)}
                        </ButtonV2>
                      </Show>
                      <ButtonV2 variant="neutral" size="small" onClick={() => togglePanel(item, "note")}>
                        {t("novel.settings.memory.action.note" as never)}
                      </ButtonV2>
                    </div>

                    <Show when={panel()?.id === item.id && panel()?.kind === "edit"}>
                      <div class="flex flex-col gap-2">
                        <TextareaV2
                          value={editText()}
                          onInput={(event) => setEditText(event.currentTarget.value)}
                          placeholder={t("novel.settings.memory.editTextPlaceholder" as never)}
                          rows={3}
                        />
                        <TextInputV2
                          value={editEntityHint()}
                          onInput={(event) => setEditEntityHint(event.currentTarget.value)}
                          placeholder={t("novel.settings.memory.editEntityHintPlaceholder" as never)}
                        />
                        <div class="flex justify-end">
                          <ButtonV2 variant="contrast" size="small" disabled={editFact.isPending} onClick={() => submitEdit(item)}>
                            {t("novel.settings.memory.action.save" as never)}
                          </ButtonV2>
                        </div>
                      </div>
                    </Show>

                    {/* 作废二次确认（D5 边界：普通作废无恢复通道） */}
                    <Show when={panel()?.id === item.id && panel()?.kind === "retire-confirm"}>
                      <div class="flex items-center justify-between gap-2 rounded-md border border-v2-state-border-danger p-2">
                        <span class="text-xs text-v2-state-fg-danger">{t("novel.settings.memory.retireConfirm" as never)}</span>
                        <ButtonV2
                          variant="contrast"
                          size="small"
                          disabled={retireFact.isPending}
                          onClick={() => void retireFact.mutateAsync(item.id)}
                        >
                          {t("novel.settings.memory.action.retire" as never)}
                        </ButtonV2>
                      </div>
                    </Show>

                    <Show when={panel()?.id === item.id && panel()?.kind === "note"}>
                      <div class="flex flex-col gap-2">
                        <TextareaV2
                          value={noteText()}
                          onInput={(event) => setNoteText(event.currentTarget.value)}
                          placeholder={t("novel.settings.memory.notePlaceholder" as never)}
                          rows={2}
                        />
                        <div class="flex justify-end">
                          <ButtonV2
                            variant="contrast"
                            size="small"
                            disabled={sendInstruction.isPending}
                            onClick={() =>
                              void sendInstruction.mutateAsync(
                                buildHandoffPrompt({ novelID: props.novelID(), item, note: noteText() }),
                              )
                            }
                          >
                            {t("novel.settings.memory.action.handoff" as never)}
                          </ButtonV2>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={data().items.length >= limit()}>
                <div class="flex justify-center">
                  <ButtonV2 variant="neutral" size="small" disabled={itemsQuery.isFetching} onClick={() => setLimit((size) => size + MEMORY_PAGE_SIZE)}>
                    {t("novel.settings.memory.loadMore" as never)}
                  </ButtonV2>
                </div>
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </div>
  )
}
