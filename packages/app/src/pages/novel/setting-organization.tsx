/**
 * 设定中心 — 设定整理面板。
 *
 * UI 只提供分析报告、计划导入、dry run 预览和显式确认执行；
 * 不自动生成整理计划，也不渲染 Markdown。
 */
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import type {
  SettingOrganizationAnalyzeResult,
  SettingOrganizationApplyResult,
  SettingOrganizationDryRunResult,
  SettingOrganizationIssue,
  SettingOrganizationPreview,
  SettingOrganizationRemainingOperation,
  SettingOrganizationOperationResult,
} from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { useNovelClient, novelKeys } from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { useConfirmDelete } from "./confirm-dialog"
import {
  countActions,
  hasAppliedChanges,
  isApplyReady,
  isPlanCurrent,
  prepareApplyRequest,
  type SettingOrganizationPlanState,
} from "./setting-organization-state"

type SettingOrganizationPanelProps = {
  novelID: Accessor<string>
}

const ACTION_LABELS: Record<SettingOrganizationPreview["action"], string> = {
  update: "更新",
  merge: "合并",
  delete: "删除",
}

const ENTITY_LABELS: Record<SettingOrganizationPreview["entityType"], string> = {
  world_entry: "世界观",
  character: "角色",
  relationship: "关系",
  plot_thread: "剧情线",
  foreshadowing: "伏笔",
}

const ISSUE_LABELS: Record<SettingOrganizationIssue["type"], string> = {
  nonstandard_category: "非标准分类",
  duplicate_title: "重复标题",
  similar_title: "相似标题",
  duplicate_identity: "重复身份",
  empty_field: "空字段",
  long_single_paragraph: "长单段内容",
  markdown_syntax: "Markdown 残留",
}

function PlainText(props: { text: string; class?: string }) {
  return (
    <div class={`whitespace-pre-wrap break-words ${props.class ?? ""}`}>
      <For each={props.text.split(/\n{2,}/).filter((part) => part.trim())}>
        {(paragraph, index) => (
          <Show when={index() > 0} fallback={<p>{paragraph}</p>}>
            <p class="mt-2">{paragraph}</p>
          </Show>
        )}
      </For>
    </div>
  )
}

function IssueItem(props: { issue: SettingOrganizationIssue }) {
  return (
    <div class="rounded-md border border-v2-border-border-base p-3">
      <div class="flex flex-wrap items-center gap-2 text-xs text-v2-text-text-muted">
        <span class="rounded-sm bg-v2-bg-bg-muted px-1.5 py-0.5">{ISSUE_LABELS[props.issue.type]}</span>
        <span>{ENTITY_LABELS[props.issue.entityType]}</span>
        <span class="font-mono">{props.issue.issueId}</span>
      </div>
      <PlainText text={props.issue.evidence} class="mt-2 text-sm text-v2-text-text-base" />
      <PlainText text={props.issue.suggestion} class="mt-2 text-sm text-v2-text-text-muted" />
    </div>
  )
}

function PreviewItem(props: { preview: SettingOrganizationPreview }) {
  return (
    <div class="rounded-md border border-v2-border-border-base p-3">
      <div class="flex flex-wrap items-center gap-2 text-xs text-v2-text-text-muted">
        <span class="font-medium text-v2-text-text-base">
          [{props.preview.index}] {ACTION_LABELS[props.preview.action]} {ENTITY_LABELS[props.preview.entityType]}
        </span>
        <For each={props.preview.fields}>
          {(field) => <span class="rounded-sm bg-v2-bg-bg-muted px-1.5 py-0.5">{field}</span>}
        </For>
      </div>
      <PlainText text={props.preview.summary} class="mt-2 text-sm" />
      <div class="mt-2 font-mono text-xs text-v2-text-text-faint">{props.preview.entryIds.join("、")}</div>
    </div>
  )
}

function ResultItem(props: { result: SettingOrganizationOperationResult }) {
  const effect = () => {
    if (props.result.status === "failed") return props.result.error ?? "执行失败"
    if (props.result.action === "delete") return "已删除"
    const changed = props.result.changedFields?.join("、") || "无字段变化"
    return `字段 ${changed}；历史 ${props.result.historyCount ?? 0}，级联 ${props.result.cascadeTasks ?? 0}`
  }
  return (
    <div class="rounded-md border border-v2-border-border-base p-3 text-sm">
      <div class="flex flex-wrap items-center gap-2 text-xs text-v2-text-text-muted">
        <span class="font-medium text-v2-text-text-base">
          [{props.result.index}] {ACTION_LABELS[props.result.action]} {ENTITY_LABELS[props.result.entityType]}
        </span>
        <span class={props.result.status === "success" ? "text-v2-state-fg-success" : "text-v2-state-fg-danger"}>
          {props.result.status === "success" ? "成功" : "失败"}
        </span>
      </div>
      <PlainText text={effect()} class="mt-2" />
      <div class="mt-2 font-mono text-xs text-v2-text-text-faint">{props.result.entryIds.join("、")}</div>
    </div>
  )
}

function RemainingItem(props: { item: SettingOrganizationRemainingOperation }) {
  return (
    <div class="rounded-md border border-dashed border-v2-border-border-base p-3 text-sm">
      [{props.item.index}] {ACTION_LABELS[props.item.action]} {ENTITY_LABELS[props.item.entityType]}
      <span class="ml-2 font-mono text-xs text-v2-text-text-faint">{props.item.entryIds.join("、")}</span>
    </div>
  )
}

export function SettingOrganizationPanel(props: SettingOrganizationPanelProps) {
  const client = useNovelClient()
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const confirmApply = useConfirmDelete()
  const [planJson, setPlanJson] = createSignal("")
  const [submittedPlanJson, setSubmittedPlanJson] = createSignal("")
  const [dryRun, setDryRun] = createSignal<SettingOrganizationDryRunResult | null>(null)
  const [applyResult, setApplyResult] = createSignal<SettingOrganizationApplyResult | null>(null)

  const analysis = createQuery(() => ({
    queryKey: ["novel", "setting-organization-analysis", sdk().directory, props.novelID()],
    queryFn: async (): Promise<SettingOrganizationAnalyzeResult> =>
      client()["server.novel"].analyze({
        novelID: props.novelID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!props.novelID(),
  }))

  const dryRunMutation = useMutation(() => ({
    mutationFn: async (plan: string): Promise<SettingOrganizationDryRunResult> =>
      client()["server.novel"]["dry-run"]({
        novelID: props.novelID(),
        location: { directory: sdk().directory },
        planJson: plan,
      }),
    onSuccess: (result) => {
      setDryRun(result)
      setSubmittedPlanJson(planJson())
    },
  }))

  createEffect(() => {
    const result = analysis.data
    if (result?.suggestedPlanJson) {
      setPlanJson(result.suggestedPlanJson)
      setDryRun(null)
      setSubmittedPlanJson("")
      void dryRunMutation.mutateAsync(result.suggestedPlanJson)
      return
    }
    if (result && !result.suggestedPlanJson && result.count > 0) {
      setPlanJson("")
      setDryRun(null)
      setSubmittedPlanJson("")
    }
  })

  const applyMutation = useMutation(() => ({
    mutationFn: async (input: {
      planJson: string
      planDigest: string
    }): Promise<SettingOrganizationApplyResult> =>
      client()["server.novel"].apply({
        novelID: props.novelID(),
        location: { directory: sdk().directory },
        planJson: input.planJson,
        planDigest: input.planDigest,
        confirmed: true,
      }),
  }))

  const planState = createMemo<SettingOrganizationPlanState>(() => ({
    planJson: planJson(),
    submittedPlanJson: submittedPlanJson(),
    dryRun: dryRun(),
  }))
  const applyReady = createMemo(() => isApplyReady(planState()))
  const planChanged = createMemo(() => !!planJson() && !isPlanCurrent(planState()))
  const actionCounts = createMemo(() => countActions(dryRun()?.previews ?? []))

  async function refreshAfterApply(result: SettingOrganizationApplyResult) {
    if (!hasAppliedChanges(result)) return
    setDryRun(null)
    setSubmittedPlanJson("")
    const dir = sdk().directory
    const novelID = props.novelID()
    for (const key of [
      novelKeys.detail(dir, novelID),
      novelKeys.characters(dir, novelID),
      novelKeys.relationships(dir, novelID),
      novelKeys["plot-threads"](dir, novelID),
      novelKeys.foreshadowing(dir, novelID),
      novelKeys["world-entries"](dir, novelID),
      novelKeys["all-character-states"](dir, novelID),
    ]) {
      await queryClient.invalidateQueries({ queryKey: key })
    }
    await analysis.refetch()
  }

  async function executeApply() {
    const request = prepareApplyRequest(planState(), true)
    if (!request) return
    const result = await applyMutation.mutateAsync(request)
    setApplyResult(result)
    await refreshAfterApply(result)
  }

  function requestApply() {
    if (!applyReady()) return
    const previews = dryRun()?.previews ?? []
    const counts = actionCounts()
    const entities = [...new Set(previews.map((preview) => ENTITY_LABELS[preview.entityType]))].join("、")
    confirmApply({
      title: "确认执行整理计划",
      message: [
        `将执行 ${previews.length} 个操作：更新 ${counts.update}、合并 ${counts.merge}、删除 ${counts.delete}。`,
        entities ? `主要影响：${entities}。` : "",
        "执行前会重新校验；删除和合并会影响关联条目，可能无法自动恢复。",
      ]
        .filter(Boolean)
        .join("\n"),
      confirmLabel: "确认执行",
      onConfirm: () => void executeApply(),
    })
  }

  return (
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-bold">设定整理</h2>
          <ButtonV2 variant="neutral" size="small" onClick={() => {
              setDryRun(null)
              setSubmittedPlanJson("")
              void analysis.refetch()
            }} disabled={analysis.isFetching}>
            重新分析
          </ButtonV2>
        </div>
        <Show when={analysis.isLoading}>
          <div class="flex items-center justify-center py-8">
            <Spinner class="h-5 w-5 text-v2-text-text-muted" />
          </div>
        </Show>
        <Show when={analysis.error}>
          <div class="rounded-md border border-v2-state-border-danger p-3 text-sm text-v2-state-fg-danger">
            <PlainText text={String(analysis.error)} />
            <ButtonV2 class="mt-2" variant="neutral" size="small" onClick={() => void analysis.refetch()}>
              重试
            </ButtonV2>
          </div>
        </Show>
        <Show when={analysis.data}>
          {(data) => (
            <Show
              when={data().count > 0}
              fallback={<div class="rounded-md border border-v2-border-border-base p-4 text-sm">当前无需整理。</div>}
            >
              <div class="flex flex-col gap-3">
                <div class="text-sm text-v2-text-text-muted">发现 {data().count} 个可整理问题。</div>
                <For each={data().issues}>{(issue) => <IssueItem issue={issue} />}</For>
              </div>
            </Show>
          )}
        </Show>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="font-semibold">整理计划</h3>
        <p class="text-sm text-v2-text-text-muted">
          分析完成后已自动生成安全修复计划（同标题合并 + 分类修正）。如需处理其他类型问题（空字段、长段落等），可在会话中让 AI 生成补充计划后粘贴。
        </p>
        <TextareaV2
          rows={8}
          fluid
          class="font-mono"
          value={planJson()}
          onInput={(event) => setPlanJson(event.currentTarget.value)}
          placeholder='{"version": 2, "operations": []}'
        />
        <div class="flex items-center gap-2">
          <ButtonV2
            variant="contrast"
            size="small"
            onClick={() => void dryRunMutation.mutateAsync(planJson())}
            disabled={!planJson().trim() || dryRunMutation.isPending}
          >
            {dryRunMutation.isPending ? "校验中" : "Dry run"}
          </ButtonV2>
          <Show when={planChanged()}>
            <span class="text-sm text-v2-state-fg-warning">计划已修改，需要重新 dry run。</span>
          </Show>
        </div>
      </section>

      <Show when={dryRun()}>
        {(result) => (
          <section class="flex flex-col gap-3">
            <h3 class="font-semibold">Dry run 结果</h3>
            <Show
              when={result().valid}
              fallback={
                <div class="flex flex-col gap-2 rounded-md border border-v2-state-border-danger p-3">
                  <div class="text-sm text-v2-state-fg-danger">计划校验失败，未修改数据。</div>
                  <For each={result().errors}>
                    {(error) => <PlainText text={error} class="text-sm text-v2-state-fg-danger" />}
                  </For>
                </div>
              }
            >
              <div class="flex flex-col gap-3">
                <div class="text-sm text-v2-text-text-muted">
                  校验通过，共 {result().previews.length} 个操作。确认前不会修改数据。
                </div>
                <For each={result().previews}>{(preview) => <PreviewItem preview={preview} />}</For>
                <ButtonV2 variant="danger" size="small" onClick={requestApply} disabled={!applyReady()}>
                  确认执行
                </ButtonV2>
              </div>
            </Show>
          </section>
        )}
      </Show>

      <Show when={applyResult()}>
        {(result) => (
          <section class="flex flex-col gap-3">
            <h3 class="font-semibold">执行结果</h3>
            <div class="rounded-md border border-v2-border-border-base p-3 text-sm">
              {result().ok ? "整理计划执行完成。" : "整理计划部分失败或未执行。"}
            </div>
            <Show when={result().errors.length > 0}>
              <div class="flex flex-col gap-2 rounded-md border border-v2-state-border-danger p-3">
                <For each={result().errors}>
                  {(error) => <PlainText text={error} class="text-sm text-v2-state-fg-danger" />}
                </For>
              </div>
            </Show>
            <For each={result().results}>{(item) => <ResultItem result={item} />}</For>
            <Show when={result().remaining.length > 0}>
              <div class="text-sm text-v2-text-text-muted">未执行操作</div>
              <For each={result().remaining}>{(item) => <RemainingItem item={item} />}</For>
            </Show>
          </section>
        )}
      </Show>
    </div>
  )
}
