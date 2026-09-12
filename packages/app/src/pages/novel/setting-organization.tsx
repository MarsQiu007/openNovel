/**
 * 设定中心 — 设定整理面板。
 *
 * UI 只提供分析报告和 AI 一键整理入口；
 * 修复由 AI 在绑定会话中使用工具完成，UI 不直接修改数据。
 */
import { type Accessor, For, Show } from "solid-js"
import { createQuery, useMutation } from "@tanstack/solid-query"
import type { SettingOrganizationAnalyzeResult, SettingOrganizationIssue } from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { useNovelClient, useBindSession } from "@/context/novel-queries"
import { sendNovelSessionInstruction } from "./workspace-data"
import { useSDK } from "@/context/sdk"
import { useNovel } from "@/context/novel"

type SettingOrganizationPanelProps = {
  novelID: Accessor<string>
}

const ISSUE_TYPE_LABELS: Record<SettingOrganizationIssue["type"], string> = {
  nonstandard_category: "非标准分类",
  duplicate_title: "重复标题",
  similar_title: "相似标题",
  duplicate_identity: "重复身份",
  empty_field: "空字段",
  long_single_paragraph: "长单段内容",
  markdown_syntax: "Markdown 语法",
}

const ENTITY_LABELS: Record<SettingOrganizationIssue["entityType"], string> = {
  world_entry: "世界观",
  character: "角色",
  relationship: "关系",
  plot_thread: "剧情线",
  foreshadowing: "伏笔",
}

function IssueItem(props: { issue: SettingOrganizationIssue }) {
  return (
    <div class="rounded-md border border-v2-border-border-base p-3 text-sm">
      <div class="flex items-center gap-2">
        <span class="font-medium">{ISSUE_TYPE_LABELS[props.issue.type]}</span>
        <span class="text-v2-text-text-muted">{ENTITY_LABELS[props.issue.entityType]}</span>
      </div>
      <div class="mt-1 text-v2-text-text-muted">{props.issue.evidence}</div>
      <div class="mt-1 text-xs text-v2-text-text-faint">{props.issue.suggestion}</div>
    </div>
  )
}

export function SettingOrganizationPanel(props: SettingOrganizationPanelProps) {
  const client = useNovelClient()
  const sdk = useSDK()
  const novel = useNovel()
  const bindSession = useBindSession()

  const analysis = createQuery(() => ({
    queryKey: ["novel", "setting-organization-analysis", sdk().directory, props.novelID()],
    queryFn: async (): Promise<SettingOrganizationAnalyzeResult> =>
      client()["server.novel"].analyze({
        novelID: props.novelID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!props.novelID(),
  }))

  const aiFixMutation = useMutation(() => ({
    mutationFn: async (prompt: string): Promise<string> =>
      sendNovelSessionInstruction({
        sdk,
        novel,
        bindSession,
        novelID: props.novelID(),
        prompt,
      }),
  }))

  function buildAiFixPrompt(issues: readonly SettingOrganizationIssue[]): string {
    const lines = issues.map(
      (issue, i) => `${i + 1}. [${ENTITY_LABELS[issue.entityType]}/${ISSUE_TYPE_LABELS[issue.type]}] ${issue.evidence}（条目：${issue.entryIds.join(", ")}）`,
    )
    return [
      `小说 ID：${props.novelID()}\n\n请整理以上小说的设定问题。必须使用 organize_settings 工具完成完整受控流程：先 analyze，再基于报告生成 version 2 plan_json 并 dry_run 校验；把每个操作的影响用中文说明，等待我明确确认；确认后才能 apply，执行完成后再 analyze 复查。不要猜测或改写 novel_id，不要使用 update_setting / delete_setting 等旁路工具直接修改。`,
      "",
      ...lines,
      "",
      "对于需要补充内容的空字段，在 plan_json 的 update 操作中根据已有上下文合理补写。",
    ].join("\n")
  }

  return (
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-bold">设定整理</h2>
          <div class="flex items-center gap-2">
            <ButtonV2
              variant="neutral"
              size="small"
              onClick={() => {
                const issues = analysis.data?.issues
                if (issues && issues.length > 0) void aiFixMutation.mutateAsync(buildAiFixPrompt(issues))
              }}
              disabled={analysis.isFetching || aiFixMutation.isPending || (analysis.data?.count ?? 0) === 0}
            >
              {aiFixMutation.isPending ? "发送中…" : "AI 一键整理"}
            </ButtonV2>
            <ButtonV2 variant="neutral" size="small" onClick={() => void analysis.refetch()} disabled={analysis.isFetching}>
              {analysis.isFetching ? "分析中…" : "重新分析"}
            </ButtonV2>
          </div>
        </div>
        <Show when={analysis.isLoading}>
          <div class="flex items-center justify-center py-8">
            <Spinner class="h-5 w-5 text-v2-text-text-muted" />
          </div>
        </Show>
        <Show when={analysis.error}>
          <div class="rounded-md border border-v2-state-border-danger p-3 text-sm text-v2-state-fg-danger">
            {String(analysis.error)}
          </div>
        </Show>
        <Show when={analysis.data}>
          {(data) => (
            <Show
              when={data().count > 0}
              fallback={<div class="rounded-md border border-v2-border-border-base p-4 text-sm">✅ 设定很干净，没有需要整理的问题。</div>}
            >
              <div class="flex flex-col gap-3">
                <div class="text-sm text-v2-text-text-muted">发现 {data().count} 个可整理问题。</div>
                <For each={data().issues}>{(issue) => <IssueItem issue={issue} />}</For>
              </div>
            </Show>
          )}
        </Show>
      </section>
    </div>
  )
}
