import { createSignal, Match, Show, Switch } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import { useNavigate } from "@solidjs/router"
import { useChapterApprovalState } from "@/context/novel-approval"
import { useBindSession, useChapterDetail, useSubmitApproval } from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useNovel } from "@/context/novel"
import { findBoundNovelSession, formatRejectionRewritePrompt, sendNovelSessionInstruction } from "./workspace-data"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Tag, type TagProps } from "@opennovel-ai/ui/v2/badge-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"

// ─── Status badge variants ───

type TagVariant = NonNullable<TagProps["variant"]>

const STATUS_BADGE: Record<string, TagVariant> = {
  planned: "neutral",
  draft: "neutral",
  outline: "neutral",
  failed: "danger",
  drafting: "info",
  audited: "warning",
  revised: "info",
  pending_review: "warning",
  final: "success",
  rejected: "danger",
  published: "success",
}

// ─── Status label helper ───

function statusLabel(language: ReturnType<typeof useLanguage>, status: string): string {
  if (status in STATUS_BADGE) return language.t(`novel.chapter.status.${status}`)
  return language.t("novel.chapter.status.none")
}

// ─── Props ───

type ApprovalBarProps = {
  novelID: string
  chapterID: string
  status: string
  onOpenReview: () => void
}

// ─── Component ───

export default function ApprovalBar(props: ApprovalBarProps) {
  const language = useLanguage()
  const approvalState = useChapterApprovalState({ status: props.status })
  const approval = useSubmitApproval()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  const novel = useNovel()
  const navigate = useNavigate()
  const bindSession = useBindSession()
  const chapter = useChapterDetail(() => props.novelID, () => props.chapterID)
  const [rejecting, setRejecting] = createSignal(false)
  const [rejectComment, setRejectComment] = createSignal("")
  const [sendRewrite, setSendRewrite] = createSignal(false)

  const viewReview = async () => {
    const boundID = await findBoundNovelSession(sdk, novel, props.novelID)
    if (boundID) {
      navigate(`/${base64Encode(sdk().directory)}/novel/${props.novelID}/session/${boundID}`)
    }
  }

  const dispatchRewriteInstruction = async (comment?: string) => {
    try {
      const prompt = formatRejectionRewritePrompt({
        novelID: props.novelID,
        chapterID: props.chapterID,
        chapterTitle: chapter.data?.title,
        chapterOrder: chapter.data?.order,
        comment,
      })
      const sessionID = await sendNovelSessionInstruction({
        sdk,
        novel,
        bindSession,
        novelID: props.novelID,
        prompt,
      })
      navigate(`/${base64Encode(sdk().directory)}/novel/${props.novelID}/session/${sessionID}`)
      showToast({ variant: "success", title: "已发送 AI 重写指令" })
    } catch (error) {
      showToast({
        variant: "error",
        title: `驳回已保存，但 AI 重写指令发送失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const handleAction = (action: "approve" | "reject", comment?: string) => {
    const shouldSendRewrite = action === "reject" && sendRewrite()
    approval.mutate(
      { novelID: props.novelID, chapterID: props.chapterID, action, comment },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: ["novel", "chapters", sdk().directory, props.novelID],
          })
          setRejecting(false)
          setRejectComment("")
          setSendRewrite(false)
          const title =
            action === "approve" ? language.t("novel.approval.confirmed") : language.t("novel.chapter.status.rejected")
          showToast({ variant: "success", title })
          if (shouldSendRewrite) void dispatchRewriteInstruction(comment)
        },
        onError: (error) => {
          showToast({
            variant: "error",
            title: error instanceof Error ? error.message : String(error),
          })
        },
      },
    )
  }

  return (
    <Switch>
      <Match when={approvalState === "pending"}>
        <div class="shrink-0">
          <div class="flex items-center justify-between px-6 py-3 border-t border-v2-border-border-base">
            <div class="flex items-center gap-3">
              <span class="text-sm text-v2-text-text-faint">{language.t("novel.approval.pending")}</span>
              <button type="button" class="text-xs text-v2-text-text-accent hover:underline" onClick={props.onOpenReview}>
                审查详情
              </button>
              <button
                type="button"
                class="text-xs text-v2-text-text-accent hover:underline"
                onClick={() => void viewReview()}
              >
                {language.t("novel.approval.viewReview")}
              </button>
            </div>
            <div class="flex items-center gap-2">
              <ButtonV2 variant="contrast" onClick={() => handleAction("approve")} disabled={approval.isPending}>
                {language.t("novel.approval.approve")}
              </ButtonV2>
              <ButtonV2 variant="danger" onClick={() => setRejecting(true)} disabled={approval.isPending}>
                {language.t("novel.approval.reject")}
              </ButtonV2>
            </div>
          </div>
          <Show when={rejecting()}>
            <div class="px-6 py-3 border-t border-v2-border-border-base space-y-2">
              <TextareaV2
                fluid
                rows={2}
                placeholder={language.t("novel.approval.commentPlaceholder")}
                value={rejectComment()}
                onInput={(e) => setRejectComment(e.currentTarget.value)}
              />
              <label class="flex cursor-pointer items-center gap-2 text-xs text-v2-text-text-base">
                <input
                  type="checkbox"
                  checked={sendRewrite()}
                  onInput={(e) => setSendRewrite(e.currentTarget.checked)}
                />
                <span>同时让 AI 按驳回意见重写</span>
              </label>
              <div class="flex items-center justify-end gap-2">
                <ButtonV2
                  variant="ghost-muted"
                  size="small"
                  onClick={() => {
                    setRejecting(false)
                    setRejectComment("")
                    setSendRewrite(false)
                  }}
                >
                  {language.t("novel.approval.commentCancel")}
                </ButtonV2>
                <ButtonV2
                  variant="danger"
                  size="small"
                  onClick={() => handleAction("reject", rejectComment().trim() || undefined)}
                  disabled={approval.isPending}
                >
                  {language.t("novel.approval.commentConfirm")}
                </ButtonV2>
              </div>
            </div>
          </Show>
        </div>
      </Match>
      <Match when={approvalState === "settled"}>
        <div class="flex items-center justify-between px-6 py-3 border-t border-v2-border-border-base shrink-0">
          <div class="flex items-center gap-3">
            <span class="text-sm text-v2-text-text-faint">{language.t("novel.approval.title")}</span>
            <button type="button" class="text-xs text-v2-text-text-accent hover:underline" onClick={props.onOpenReview}>
              审查详情
            </button>
          </div>
          <Tag variant={STATUS_BADGE[props.status] ?? "neutral"}>{statusLabel(language, props.status)}</Tag>
        </div>
      </Match>
      <Match when={approvalState === "none"}>
        <div class="flex items-center justify-between px-6 py-3 border-t border-v2-border-border-base shrink-0">
          <span class="text-sm text-v2-text-text-faint">{statusLabel(language, props.status)}</span>
        </div>
      </Match>
    </Switch>
  )
}
