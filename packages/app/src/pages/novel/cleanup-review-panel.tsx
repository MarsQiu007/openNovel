/**
 * 清理修订审阅面板 — 设定树「AI 设定 > 清理修订」节点视图（chapter-cleanup-review）。
 *
 * 按状态过滤展示导入整理落库的章节修订提案：原文/建议对照、理由与置信度；
 * 待审项逐条接受/拒绝，低风险项可批量接受（服务端权威过滤），已应用项可撤销。
 */
import { type Accessor, For, Show, createSignal } from "solid-js"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import type { CleanupProposal } from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { CheckboxV2 } from "@opennovel-ai/ui/v2/checkbox-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { useCleanupProposalCounts, useCleanupProposals, useNovelClient } from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useConfirmDelete } from "./confirm-dialog"
import {
  CLEANUP_STATUS_FILTERS,
  groupByChapter,
  isBatchSelectable,
  isLowRiskProposal,
  kindLabelKey,
  statusLabelKey,
  statusTagVariant,
  type CleanupStatusFilter,
} from "./cleanup-review-data"

type CleanupReviewPanelProps = {
  novelID: Accessor<string>
}

export function CleanupReviewPanel(props: CleanupReviewPanelProps) {
  const client = useNovelClient()
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const language = useLanguage()
  const t = language.t
  const confirmDialog = useConfirmDelete()

  const [statusFilter, setStatusFilter] = createSignal<CleanupStatusFilter>("pending")
  const [selectedIds, setSelectedIds] = createSignal<readonly string[]>([])
  const [status, setStatus] = createSignal<{ kind: "ok" | "error"; lines: string[] } | null>(null)

  const counts = useCleanupProposalCounts(props.novelID)
  const itemsQuery = useCleanupProposals(props.novelID, () => (statusFilter() === "all" ? null : statusFilter()))

  function refresh() {
    const dir = sdk().directory
    void queryClient.invalidateQueries({ queryKey: ["novel", "cleanup-proposal-counts", dir, props.novelID()] })
    void queryClient.invalidateQueries({ queryKey: ["novel", "cleanup-proposal-items", dir, props.novelID()] })
  }

  function handleResult(
    result: { ok: boolean; error?: string; skipped?: readonly { readonly id: string; readonly reason: string }[] },
    okKey: Parameters<typeof t>[0],
  ) {
    if (result.ok) {
      const skipped = result.skipped ?? []
      const lines = [t(okKey)]
      for (const item of skipped) lines.push(t("novel.settings.cleanup.skippedLine", { reason: item.reason }))
      setStatus({ kind: "ok", lines })
      setSelectedIds([])
      refresh()
      return
    }
    setStatus({ kind: "error", lines: [result.error ?? String(result)] })
  }

  function handleError(error: unknown) {
    setStatus({ kind: "error", lines: [String(error)] })
  }

  const accept = useMutation(() => ({
    mutationFn: (proposalID: string) =>
      client()["server.novel"]["proposal-accept"]({
        novelID: props.novelID(),
        proposalID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.cleanup.ok.accepted"),
    onError: handleError,
  }))

  const acceptBatch = useMutation(() => ({
    mutationFn: (proposalIds: string[]) =>
      client()["server.novel"]["proposal-accept-batch"]({
        novelID: props.novelID(),
        location: { directory: sdk().directory },
        proposalIds,
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.cleanup.ok.batchAccepted"),
    onError: handleError,
  }))

  const reject = useMutation(() => ({
    mutationFn: (proposalID: string) =>
      client()["server.novel"]["proposal-reject"]({
        novelID: props.novelID(),
        proposalID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.cleanup.ok.rejected"),
    onError: handleError,
  }))

  const revert = useMutation(() => ({
    mutationFn: (proposalID: string) =>
      client()["server.novel"]["proposal-revert"]({
        novelID: props.novelID(),
        proposalID,
        location: { directory: sdk().directory },
      }),
    onSuccess: (result) => handleResult(result, "novel.settings.cleanup.ok.reverted"),
    onError: handleError,
  }))

  function confirmRevert(proposalID: string) {
    confirmDialog({
      title: t("novel.settings.cleanup.revertTitle"),
      message: t("novel.settings.cleanup.revertWarning"),
      confirmLabel: t("novel.settings.cleanup.action.revert"),
      onConfirm: () => void revert.mutateAsync(proposalID),
    })
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((value) => value !== id)))
  }

  const selectableIds = (): string[] => (itemsQuery.data?.items ?? []).filter((p) => isBatchSelectable(p)).map((p) => p.id)
  const allSelected = () => selectableIds().length > 0 && selectableIds().every((id) => selectedIds().includes(id))

  return (
    <div class="flex h-full flex-col gap-3 overflow-auto p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">{t("novel.settings.cleanup.title")}</h2>
        <span class="text-xs text-v2-text-text-muted">
          {t("novel.settings.cleanup.pendingBadge", { count: counts.data?.pending ?? 0 })}
        </span>
      </div>

      <SegmentedControlV2
        value={statusFilter()}
        onChange={(value) => {
          setStatusFilter(value as CleanupStatusFilter)
          setSelectedIds([])
        }}
      >
        <For each={CLEANUP_STATUS_FILTERS}>
          {(filter) => (
            <SegmentedControlItemV2 value={filter}>
              {filter === "all" ? t("novel.settings.cleanup.filter.all") : t(statusLabelKey(filter) as never)}
            </SegmentedControlItemV2>
          )}
        </For>
      </SegmentedControlV2>

      <Show when={statusFilter() === "pending" && selectableIds().length > 0}>
        <div class="flex items-center justify-between gap-2 rounded border border-v2-border-border-base px-3 py-2">
          <CheckboxV2
            checked={allSelected()}
            onChange={(checked: boolean) => setSelectedIds(checked ? selectableIds() : [])}
            label={t("novel.settings.cleanup.selectAllLowRisk", { count: selectableIds().length })}
          />
          <ButtonV2
            variant="contrast"
            size="small"
            disabled={selectedIds().length === 0 || acceptBatch.isPending}
            onClick={() => void acceptBatch.mutateAsync([...selectedIds()])}
          >
            {t("novel.settings.cleanup.action.batchAccept", { count: selectedIds().length })}
          </ButtonV2>
        </div>
      </Show>

      <Show when={status()}>
        {(current) => (
          <div
            class="rounded px-3 py-2 text-xs"
            classList={{
              "bg-v2-background-bg-layer-02 text-v2-text-text-default": current().kind === "ok",
              "bg-v2-background-bg-layer-02 text-v2-text-text-critical": current().kind === "error",
            }}
          >
            <For each={current().lines}>{(line) => <div class="break-all">{line}</div>}</For>
          </div>
        )}
      </Show>

      <Show
        when={(itemsQuery.data?.items ?? []).length > 0}
        fallback={<div class="py-8 text-center text-sm text-v2-text-text-muted">{t("novel.settings.cleanup.empty")}</div>}
      >
        <For each={groupByChapter(itemsQuery.data?.items ?? [])}>
          {(group) => (
            <div class="flex flex-col gap-2">
              <div class="text-xs font-medium text-v2-text-text-faint">
                {t("novel.settings.cleanup.chapterLabel")} {group.chapterId.slice(0, 8)}
              </div>
              <For each={group.items}>
                {(item) => <CleanupProposalRow item={item} onAccept={(id) => void accept.mutateAsync(id)} onReject={(id) => void reject.mutateAsync(id)} onRevert={confirmRevert} onToggle={toggleSelected} selected={selectedIds().includes(item.id)} acceptPending={accept.isPending} rejectPending={reject.isPending} />}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

type RowProps = {
  item: CleanupProposal
  selected: boolean
  acceptPending: boolean
  rejectPending: boolean
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRevert: (id: string) => void
  onToggle: (id: string, checked: boolean) => void
}

function CleanupProposalRow(props: RowProps) {
  const t = useLanguage().t
  return (
    <div class="rounded border border-v2-border-border-base p-3">
      <div class="flex items-center gap-2">
        <Show when={isBatchSelectable(props.item)}>
          <CheckboxV2 checked={props.selected} onChange={(checked: boolean) => props.onToggle(props.item.id, checked)} label="" />
        </Show>
        <Tag variant={statusTagVariant(props.item.status)}>{t(statusLabelKey(props.item.status) as never)}</Tag>
        <Tag variant="info">{t(kindLabelKey(props.item.kind) as never)}</Tag>
        <Show when={isLowRiskProposal(props.item.kind, props.item.confidence)}>
          <Tag variant="success">{t("novel.settings.cleanup.lowRisk")}</Tag>
        </Show>
        <span class="ml-auto text-xs text-v2-text-text-faint">
          {t("novel.settings.cleanup.confidence", { value: Math.round(props.item.confidence * 100) })}
        </span>
      </div>
      <div class="mt-2 grid gap-2 md:grid-cols-2">
        <div class="min-w-0">
          <div class="text-xs font-medium text-v2-text-text-muted">{t("novel.settings.cleanup.quote")}</div>
          <pre class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-v2-background-bg-layer-02 p-2 text-xs">
            {props.item.quote}
          </pre>
        </div>
        <div class="min-w-0">
          <div class="text-xs font-medium text-v2-text-text-muted">{t("novel.settings.cleanup.replacement")}</div>
          <pre class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-v2-background-bg-layer-02 p-2 text-xs">
            {props.item.replacement === "" ? t("novel.settings.cleanup.replacementEmpty") : props.item.replacement}
          </pre>
        </div>
      </div>
      <Show when={props.item.reason !== ""}>
        <div class="mt-1 break-all text-xs text-v2-text-text-muted">
          {t("novel.settings.cleanup.reason")}：{props.item.reason}
        </div>
      </Show>
      <Show when={props.item.failReason}>
        <div class="mt-1 break-all text-xs text-v2-text-text-critical">
          {t("novel.settings.cleanup.failReason")}：{props.item.failReason}
        </div>
      </Show>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Show when={props.item.status === "pending"}>
          <ButtonV2 variant="contrast" size="small" disabled={props.acceptPending} onClick={() => props.onAccept(props.item.id)}>
            {t("novel.settings.cleanup.action.accept")}
          </ButtonV2>
          <ButtonV2 variant="neutral" size="small" disabled={props.rejectPending} onClick={() => props.onReject(props.item.id)}>
            {t("novel.settings.cleanup.action.reject")}
          </ButtonV2>
        </Show>
        <Show when={props.item.status === "applied"}>
          <ButtonV2 variant="neutral" size="small" onClick={() => props.onRevert(props.item.id)}>
            {t("novel.settings.cleanup.action.revert")}
          </ButtonV2>
        </Show>
      </div>
    </div>
  )
}
