/**
 * 书内对话面板空态（0 绑定会话，design D6）：极简 composer + 建议 chip。
 * 首条消息提交时走懒创建三步（createAndBindSession），成功后切入该会话；
 * 失败时 toast 报错并保留已输入文本。不复用通用重型 composer——面板场景
 * 只有"首条消息"一个职责，模型与 agent 走项目默认。
 */
import { createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opennovel-ai/ui/v2/icon"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useBindSession } from "@/context/novel-queries"
import { createAndBindSession } from "./workspace-data"
import { showToast } from "@/utils/toast"

/** 建议 chip：点击即以该建议文本作为首条消息（懒创建或发入当前空会话） */
export function ChatSuggestionChip(props: { suggestion: string; onPick: (text: string) => void }) {
  const language = useLanguage()
  return (
    <ButtonV2 variant="outline" size="small" onClick={() => props.onPick(props.suggestion)}>
      {language.t("novel.workspace.chatSuggestionPrefix")}
      {props.suggestion}
    </ButtonV2>
  )
}

export function NovelChatEmptyState(props: { dir: string; novelID: string }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const bindSession = useBindSession()
  const [text, setText] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const navigateToSession = (sessionID: string) =>
    navigate(`/${props.dir}/novel/${props.novelID}/session/${sessionID}`)

  async function submit(raw: string) {
    const prompt = raw.trim()
    if (!prompt || sending()) return
    setSending(true)
    try {
      const sessionID = await createAndBindSession({ sdk, bindSession, novelID: props.novelID, prompt })
      // 成功才清空输入；失败路径保留原文以待修改重发
      setText("")
      navigateToSession(sessionID)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("novel.error.createFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div class="flex flex-col flex-1 items-center justify-center gap-4 px-6 text-center">
      <p class="text-sm text-v2-text-text-muted">{language.t("novel.workspace.chatEmpty")}</p>
      <ChatSuggestionChip
        suggestion={language.t("novel.writing.writeNextChapter")}
        onPick={(text) => void submit(text)}
      />
      <div class="flex w-full items-center gap-2">
        <div class="flex-1 min-w-0">
          <TextInputV2
            fluid
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.isComposing) {
                e.preventDefault()
                void submit(text())
              }
            }}
            placeholder={language.t("novel.workspace.chatInputPlaceholder")}
          />
        </div>
        <IconButtonV2
          variant="contrast"
          size="small"
          icon={<Icon name="arrow-up" size="small" />}
          disabled={sending() || !text().trim()}
          aria-label={language.t("prompt.action.send")}
          onClick={() => void submit(text())}
        />
      </div>
    </div>
  )
}
