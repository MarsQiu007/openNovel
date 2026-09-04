import { createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useNovel } from "@/context/novel"
import { useBindSession } from "@/context/novel-queries"
import { useNovelActivity } from "@/context/novel-approval"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"

export async function findBoundNovelSession(
  sdk: ReturnType<typeof useSDK>,
  novel: ReturnType<typeof useNovel>,
  novelID: string,
): Promise<string | null> {
  // 用批量绑定接口一次拿到全部绑定关系，避免逐会话 N+1 查询
  const [{ data: sessionList }, bindings] = await Promise.all([
    sdk().client.session.list(),
    novel.listSessionBindings(),
  ])
  if (!sessionList || !bindings) return null
  const boundIds = new Set(bindings.filter((b) => b.novelID === novelID).map((b) => b.sessionID))
  if (boundIds.size === 0) return null
  // 子代理会话（parentID 非空）会被上下文注入的懒绑定连带标记，不属于用户的对话线
  const session = sessionList.find((s) => boundIds.has(s.id) && !s.time.archived && !s.parentID)
  return session?.id ?? null
}

export default function WritingFlowButton(props: { novelID: string; novelTitle: string; layout?: "row" | "stack" }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const novel = useNovel()
  const bindSession = useBindSession()
  const active = useNovelActivity()
  const [isCreating, setIsCreating] = createSignal(false)
  const [instruction, setInstruction] = createSignal("")

  async function handleClick() {
    if (isCreating()) return
    setIsCreating(true)

    try {
      const custom = instruction().trim()

      // Check for already-bound session
      const boundID = await findBoundNovelSession(sdk, novel, props.novelID)
      if (boundID) {
        if (custom) {
          await sdk().client.session.prompt({
            sessionID: boundID,
            directory: sdk().directory,
            parts: [{ type: "text", text: `${language.t("novel.writing.instructionPrefix")}${custom}` }],
          })
        }
        navigate(`/${base64Encode(sdk().directory)}/novel/${props.novelID}/session/${boundID}`)
        return
      }

      // Create new session
      const result = await sdk().client.session.create({
        directory: sdk().directory,
        title: props.novelTitle,
      })
      if (!result.data) throw new Error("No session data returned")

      await bindSession.mutateAsync({
        novelID: props.novelID,
        sessionID: result.data.id,
      })

      const prompt = custom
        ? `${language.t("novel.writing.writeNextChapterPrompt")}\n\n${language.t("novel.writing.instructionPrefix")}${custom}`
        : language.t("novel.writing.writeNextChapterPrompt")

      await sdk().client.session.prompt({
        sessionID: result.data.id,
        directory: sdk().directory,
        parts: [{ type: "text", text: prompt }],
      })

      navigate(`/${base64Encode(sdk().directory)}/novel/${props.novelID}/session/${result.data.id}`)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("novel.error.createFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsCreating(false)
    }
  }

  // stack：窄容器（右栏面板区）竖排——输入框与按钮各占整行，避免横向挤压断行
  const stack = () => props.layout === "stack"
  return (
    <div class={stack() ? "flex w-full flex-col items-stretch gap-2" : "flex items-center gap-2"}>
      <div class={stack() ? "min-w-0" : "w-56"}>
        <TextInputV2
          fluid
          appearance="large"
          value={instruction()}
          onInput={(e) => setInstruction(e.currentTarget.value)}
          placeholder={language.t("novel.writing.customPromptPlaceholder")}
        />
      </div>
      <ButtonV2 variant="contrast" size="large" onClick={handleClick} disabled={isCreating()}>
        {active() ? language.t("novel.writing.writeNextChapter") : language.t("novel.workspace.startWriting")}
      </ButtonV2>
    </div>
  )
}
