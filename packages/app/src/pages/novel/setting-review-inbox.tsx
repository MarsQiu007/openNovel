/**
 * 设定收件箱 — 设定树「AI 设定 > 整理」节点视图。
 *
 * 替换原整理分析面板：按来源分组展示候选 / 冲突 / 暂存草案，提供逐条证据
 * （来源章节、旧值/新值对照、冲突说明）、审阅操作（候选接受/拒绝/合并、
 * 冲突生成草案/忽略、暂存接受/编辑后接受/拒绝）、条目级审阅备注
 * （可交给 AI 处理）与 AI 一键整理批处理入口。
 * UI 不出现 plan_json 导入或跳过重校验的直接执行控件。
 */
import { type Accessor, For, Show, createSignal } from "solid-js"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import type { ReviewInboxItem } from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { CheckboxV2 } from "@opennovel-ai/ui/v2/checkbox-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { useBindSession, useNovelClient, useReviewInboxCounts, useReviewInboxItems } from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { useNovel } from "@/context/novel"
import { useLanguage } from "@/context/language"
import { sendNovelSessionInstruction } from "./workspace-data"
import {
  REVIEW_INBOX_PAGE_SIZE,
  buildBatchOrganizePrompt,
  buildHandoffPrompt,
  formatComparison,
  formatOperationErrors,
  groupInboxItems,
  type JsonPlain,
  kindLabel,
  parseAfterOverride,
  prettyJson,
  sourceLabel,
  type ReviewInboxSourceKey,
} from "./setting-review-inbox-data"

type SettingReviewInboxPanelProps = {
  novelID: Accessor<string>
}

type PanelKind = "note" | "draft" | "edit"

const FILTERS = ["all", "candidate", "conflict", "staged"] as const

const SOURCE_TAG_VARIANTS: Record<ReviewInboxSourceKey, "info" | "warning" | "accent"> = {
  candidate: "info",
  conflict: "warning",
  staged: "accent",
}

const EDIT_ERROR_KEYS = {
  empty: "novel.settings.inbox.error.editEmpty",
  invalid: "novel.settings.inbox.error.editInvalid",
  "not-object": "novel.settings.inbox.error.editNotObject",
} as const

export function SettingReviewInboxPanel(props: SettingReviewInboxPanelProps) {
  const client = useNovelClient()
  const sdk = useSDK()
  const novel = useNovel()
  const bindSession = useBindSession()
  const queryClient = useQueryClient()
  const language = useLanguage()
  const t = language.t

  const [sourceFilter, setSourceFilter] = createSignal<ReviewInboxSourceKey | null>(null)
  const [limit, setLimit] = createSignal(REVIEW_INBOX_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = createSignal<readonly string[]>([])
  const [panel, setPanel] = createSignal<{ id: string; kind: PanelKind } | null>(null)
  const [noteText, setNoteText] = createSignal("")
  const [draftText, setDraftText] = createSignal("")
  const [editText, setEditText] = createSignal("")
  const [status, setStatus] = createSignal<{ kind: "ok" | "error"; lines: string[] } | null>(null)

  const counts = useReviewInboxCounts(props.novelID)
  const itemsQuery = useReviewInboxItems(props.novelID, sourceFilter, limit)

  function refreshInbox() {
    const dir = sdk().directory
    void queryClient.invalidateQueries({ queryKey: ["novel", "review-inbox-counts", dir, props.novelID()] })
    void queryClient.invalidateQueries({ queryKey: ["novel", "review-inbox-items", dir, props.novelID()] })
  }

  // 审阅操作统一收尾：成功提示 + 关闭面板 + 清空选择 + 失效联动（徽标计数随处理递减）
  function handleResult(result: { ok: boolean; error?: string; errors?: readonly string[]; formatErrors?: readonly string[] }, okKey: Parameters<typeof t>[0]) {
    if (result.ok) {
      setStatus({ kind: "ok", lines: [t(okKey)] })
      setPanel(null)
      setSelectedIds([])
      refreshInbox()
      return
    }
    setStatus({ kind: "error", lines: formatOperationErrors(result) })
  }

  function handleError(error: unknown) {
    setStatus({ kind: "error", lines: [String(error)] })
  }

  const acceptCandidate = useMutation(() => ({
    mutationFn: (candidateID: string) =>
      client()["server.novel"]["candidate-accept"]({
        novelID: props.novelID(),
        candidateID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.inbox.ok.accepted"),
    onError: handleError,
  }))

  const rejectCandidate = useMutation(() => ({
    mutationFn: (candidateID: string) =>
      client()["server.novel"]["candidate-reject"]({
        novelID: props.novelID(),
        candidateID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.inbox.ok.rejected"),
    onError: handleError,
  }))

  const mergeCandidates = useMutation(() => ({
    mutationFn: (pendingIds: string[]) =>
      client()["server.novel"]["candidate-merge"]({
        novelID: props.novelID(),
        location: { directory: sdk().directory },
        pendingIds,
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.inbox.ok.merged"),
    onError: handleError,
  }))

  const resolveConflict = useMutation(() => ({
    mutationFn: (input: { conflictID: string; action: "update_entry" | "keep_current"; content?: string }) =>
      client()["server.novel"]["conflict-resolve"]({
        novelID: props.novelID(),
        conflictID: input.conflictID,
        location: { directory: sdk().directory },
        action: input.action,
        content: input.content,
        source: "user",
      }),
    onSuccess: (result, variables) =>
      handleResult(result, variables.action === "update_entry" ? "novel.settings.inbox.ok.draftCreated" : "novel.settings.inbox.ok.ignored"),
    onError: handleError,
  }))

  const acceptStaged = useMutation(() => ({
    mutationFn: (input: { stagedID: string; after?: { readonly [key: string]: JsonPlain } }) =>
      client()["server.novel"]["staged-accept"]({
        novelID: props.novelID(),
        stagedID: input.stagedID,
        location: { directory: sdk().directory },
        after: input.after,
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.inbox.ok.stagedAccepted"),
    onError: handleError,
  }))

  const rejectStaged = useMutation(() => ({
    mutationFn: (stagedID: string) =>
      client()["server.novel"]["staged-reject"]({
        novelID: props.novelID(),
        stagedID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.inbox.ok.stagedRejected"),
    onError: handleError,
  }))

  const sendInstruction = useMutation(() => ({
    mutationFn: (prompt: string) =>
      sendNovelSessionInstruction({ sdk, novel, bindSession, novelID: props.novelID(), prompt }),
    onSuccess: () => {
      setStatus({ kind: "ok", lines: [t("novel.settings.inbox.ok.handoff")] })
      setPanel(null)
    },
    onError: handleError,
  }))

  const aiFix = useMutation(() => ({
    mutationFn: (prompt: string) =>
      sendNovelSessionInstruction({ sdk, novel, bindSession, novelID: props.novelID(), prompt }),
    onSuccess: () => setStatus({ kind: "ok", lines: [t("novel.settings.inbox.ok.aiFix")] }),
    onError: handleError,
  }))

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((value) => value !== id)))
  }

  // 打开条目侧面板（审阅备注 / 冲突草案 / 暂存编辑），再次点击同一面板收起
  function togglePanel(id: string, kind: PanelKind, initialEdit = "") {
    setPanel((prev) => (prev?.id === id && prev.kind === kind ? null : { id, kind }))
    setNoteText("")
    setDraftText("")
    setEditText(initialEdit)
  }

  // 编辑后接受：after 覆盖对象同样走接受前重校验
  function submitEdit(item: ReviewInboxItem) {
    const parsed = parseAfterOverride(editText())
    if (!parsed.ok) {
      setStatus({ kind: "error", lines: [t(EDIT_ERROR_KEYS[parsed.reason])] })
      return
    }
    void acceptStaged.mutateAsync({ stagedID: item.id, after: parsed.value })
  }

  return (
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-lg font-bold">{t("novel.settings.inbox.title")}</h2>
          <Show when={counts.data}>
            {(data) => <div class="text-xs text-v2-text-text-muted">{t("novel.settings.inbox.total", { count: data().total })}</div>}
          </Show>
        </div>
        <ButtonV2
          variant="neutral"
          size="small"
          disabled={aiFix.isPending}
          onClick={() => void aiFix.mutateAsync(buildBatchOrganizePrompt(props.novelID()))}
        >
          {aiFix.isPending ? t("novel.settings.inbox.aiFixing") : t("novel.settings.inbox.aiFix")}
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

      <div class="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControlV2
          value={sourceFilter() ?? "all"}
          onChange={(value) => {
            setSourceFilter(value === "all" ? null : (value as ReviewInboxSourceKey))
            setLimit(REVIEW_INBOX_PAGE_SIZE)
            setSelectedIds([])
          }}
        >
          <For each={[...FILTERS]}>{(filter) => <SegmentedControlItemV2 value={filter}>{sourceLabel(filter, t)}</SegmentedControlItemV2>}</For>
        </SegmentedControlV2>
        <Show when={selectedIds().length > 0}>
          <div class="flex items-center gap-2">
            <span class="text-xs text-v2-text-text-muted">{t("novel.settings.inbox.selected", { count: selectedIds().length })}</span>
            <Show when={selectedIds().length >= 2}>
              <ButtonV2
                variant="contrast"
                size="small"
                disabled={mergeCandidates.isPending}
                onClick={() => void mergeCandidates.mutateAsync([...selectedIds()])}
              >
                {t("novel.settings.inbox.action.merge", { count: selectedIds().length })}
              </ButtonV2>
            </Show>
          </div>
        </Show>
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
            fallback={<div class="rounded-md border border-v2-border-border-base p-4 text-sm">{t("novel.settings.inbox.empty")}</div>}
          >
            <div class="flex flex-col gap-5">
              <For each={groupInboxItems(data().items)}>
                {(group) => (
                  <section class="flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                      <h3 class="text-sm font-semibold">{sourceLabel(group.source, t)}</h3>
                      <span class="text-xs text-v2-text-text-faint">{t("novel.settings.inbox.group.count", { count: group.items.length })}</span>
                    </div>
                    <For each={group.items}>
                      {(item) => (
                        <div data-testid="setting-inbox-card" data-source={item.source} data-id={item.id} class="flex flex-col gap-2 rounded-md border border-v2-border-border-base p-3">
                          <div class="flex items-start gap-2">
                            <Show when={item.source === "candidate"}>
                              <CheckboxV2
                                checked={selectedIds().includes(item.id)}
                                onChange={(checked) => toggleSelected(item.id, checked)}
                                label=""
                                hideLabel
                                class="mt-0.5 shrink-0"
                              />
                            </Show>
                            <div class="min-w-0 flex-1">
                              <div class="flex flex-wrap items-center gap-2">
                                <Tag variant={SOURCE_TAG_VARIANTS[item.source]}>{sourceLabel(item.source, t)}</Tag>
                                <span class="text-xs text-v2-text-text-muted">{kindLabel(item.source, item.kind, t)}</span>
                                <span class="truncate font-medium">{item.title}</span>
                              </div>
                              <div class="mt-1 text-xs text-v2-text-text-faint">
                                {new Date(item.createdAt).toLocaleString()}
                                <Show when={item.sourceChapterId}>
                                  {(chapterId) => (
                                    <>
                                      {" · "}
                                      {t("novel.settings.inbox.sourceChapter")} {chapterId().slice(0, 8)}
                                    </>
                                  )}
                                </Show>
                              </div>
                            </div>
                          </div>
                          <Show when={item.summary !== ""}>
                            <div class="break-all text-sm">{item.summary}</div>
                          </Show>
                          <Show when={item.evidence !== ""}>
                            <div class="break-all text-xs text-v2-text-text-muted">
                              {t("novel.settings.inbox.evidence")}：{item.evidence}
                            </div>
                          </Show>
                          <Show when={formatComparison(item)}>
                            {(comparison) => (
                              <div class="grid gap-2 md:grid-cols-2">
                                <div class="min-w-0">
                                  <div class="text-xs font-medium text-v2-text-text-muted">{t("novel.settings.inbox.before")}</div>
                                  <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-v2-background-bg-layer-02 p-2 text-xs">
                                    {comparison().beforeText === "" ? t("novel.settings.inbox.beforeEmpty") : comparison().beforeText}
                                  </pre>
                                </div>
                                <div class="min-w-0">
                                  <div class="text-xs font-medium text-v2-text-text-muted">{t("novel.settings.inbox.after")}</div>
                                  <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-v2-background-bg-layer-02 p-2 text-xs">
                                    {comparison().afterText === "" ? t("novel.settings.inbox.afterEmpty") : comparison().afterText}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </Show>
                          <div class="flex flex-wrap items-center gap-2">
                            <Show when={item.source === "candidate"}>
                              <ButtonV2
                                variant="contrast"
                                size="small"
                                disabled={acceptCandidate.isPending}
                                onClick={() => void acceptCandidate.mutateAsync(item.id)}
                              >
                                {t("novel.settings.inbox.action.accept")}
                              </ButtonV2>
                              <ButtonV2
                                variant="neutral"
                                size="small"
                                disabled={rejectCandidate.isPending}
                                onClick={() => void rejectCandidate.mutateAsync(item.id)}
                              >
                                {t("novel.settings.inbox.action.reject")}
                              </ButtonV2>
                            </Show>
                            <Show when={item.source === "conflict"}>
                              <ButtonV2 variant="contrast" size="small" onClick={() => togglePanel(item.id, "draft")}>
                                {t("novel.settings.inbox.action.resolveDraft")}
                              </ButtonV2>
                              <ButtonV2
                                variant="neutral"
                                size="small"
                                disabled={resolveConflict.isPending}
                                onClick={() => void resolveConflict.mutateAsync({ conflictID: item.id, action: "keep_current" })}
                              >
                                {t("novel.settings.inbox.action.keepCurrent")}
                              </ButtonV2>
                            </Show>
                            <Show when={item.source === "staged"}>
                              <ButtonV2
                                variant="contrast"
                                size="small"
                                disabled={acceptStaged.isPending}
                                onClick={() => void acceptStaged.mutateAsync({ stagedID: item.id })}
                              >
                                {t("novel.settings.inbox.action.accept")}
                              </ButtonV2>
                              <ButtonV2 variant="neutral" size="small" onClick={() => togglePanel(item.id, "edit", prettyJson(item.after))}>
                                {t("novel.settings.inbox.action.editAccept")}
                              </ButtonV2>
                              <ButtonV2
                                variant="neutral"
                                size="small"
                                disabled={rejectStaged.isPending}
                                onClick={() => void rejectStaged.mutateAsync(item.id)}
                              >
                                {t("novel.settings.inbox.action.reject")}
                              </ButtonV2>
                            </Show>
                            <ButtonV2 variant="neutral" size="small" onClick={() => togglePanel(item.id, "note")}>
                              {t("novel.settings.inbox.action.note")}
                            </ButtonV2>
                          </div>

                          <Show when={panel()?.id === item.id && panel()?.kind === "note"}>
                            <div class="flex flex-col gap-2">
                              <TextareaV2
                                value={noteText()}
                                onInput={(event) => setNoteText(event.currentTarget.value)}
                                placeholder={t("novel.settings.inbox.notePlaceholder")}
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
                                  {sendInstruction.isPending ? t("novel.settings.inbox.aiFixing") : t("novel.settings.inbox.action.handoff")}
                                </ButtonV2>
                              </div>
                            </div>
                          </Show>

                          <Show when={panel()?.id === item.id && panel()?.kind === "draft"}>
                            <div class="flex flex-col gap-2">
                              <TextareaV2
                                value={draftText()}
                                onInput={(event) => setDraftText(event.currentTarget.value)}
                                placeholder={t("novel.settings.inbox.draftPlaceholder")}
                                rows={3}
                              />
                              <div class="flex justify-end">
                                <ButtonV2
                                  variant="contrast"
                                  size="small"
                                  disabled={draftText().trim() === "" || resolveConflict.isPending}
                                  onClick={() => void resolveConflict.mutateAsync({ conflictID: item.id, action: "update_entry", content: draftText() })}
                                >
                                  {t("novel.settings.inbox.action.resolveDraft")}
                                </ButtonV2>
                              </div>
                            </div>
                          </Show>

                          <Show when={panel()?.id === item.id && panel()?.kind === "edit"}>
                            <div class="flex flex-col gap-2">
                              <TextareaV2
                                value={editText()}
                                onInput={(event) => setEditText(event.currentTarget.value)}
                                placeholder={t("novel.settings.inbox.editPlaceholder")}
                                rows={6}
                                class="font-mono text-xs"
                              />
                              <div class="flex justify-end">
                                <ButtonV2 variant="contrast" size="small" disabled={acceptStaged.isPending} onClick={() => submitEdit(item)}>
                                  {t("novel.settings.inbox.action.editAccept")}
                                </ButtonV2>
                              </div>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </section>
                )}
              </For>
              <Show when={data().items.length >= limit()}>
                <div class="flex justify-center">
                  <ButtonV2 variant="neutral" size="small" disabled={itemsQuery.isFetching} onClick={() => setLimit((size) => size + REVIEW_INBOX_PAGE_SIZE)}>
                    {t("novel.settings.inbox.loadMore")}
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
