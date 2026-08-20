import { type Component, createEffect, createSignal, For, Show } from "solid-js"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { DialogV2, DialogFooter, DialogHeader, DialogTitleGroup } from "@opennovel-ai/ui/v2/dialog-v2"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

export type SoulTemplate = { nameKey: string; contentKey: string }

export const SOUL_TEMPLATES: SoulTemplate[] = [
  { nameKey: "settings.soul.template.gentle.name", contentKey: "settings.soul.template.gentle.content" },
  { nameKey: "settings.soul.template.sharp.name", contentKey: "settings.soul.template.sharp.content" },
  { nameKey: "settings.soul.template.critic.name", contentKey: "settings.soul.template.critic.content" },
]

/** 软上限：超过此字数给出提示，不强制拦截（防止塞爆上下文窗口） */
const SOFT_LIMIT = 2000

type SoulEditorProps = {
  /** 初始内容（远端数据加载完成后变化时填充一次） */
  value: () => string | undefined
  loading: boolean
  saving: boolean
  /** 顶部说明（如"未设置时使用全局灵魂"），全局编辑器可不传 */
  hint?: string
  onSave: (content: string) => Promise<void>
}

export const SoulEditor: Component<SoulEditorProps> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const [content, setContent] = createSignal("")

  // 远端数据到达时填充（只填充一次，避免覆盖用户输入）
  let filled = false
  createEffect(() => {
    if (filled || props.loading) return
    const value = props.value()
    if (value === undefined) return
    filled = true
    setContent(value)
  })

  function confirmOverwrite(title: string): Promise<boolean> {
    return new Promise((resolve) => {
      // 用 push 叠加在设置弹窗之上，避免 show 关掉底层设置弹窗
      dialog.push(() => (
        <DialogV2 fit>
          <DialogHeader hideClose>
            <DialogTitleGroup title={title} description={language.t("settings.soul.overwriteConfirm")} />
          </DialogHeader>
          <DialogFooter>
            <ButtonV2
              variant="ghost"
              onClick={() => {
                dialog.close()
                resolve(false)
              }}
            >
              {language.t("common.cancel")}
            </ButtonV2>
            <ButtonV2
              variant="contrast"
              onClick={() => {
                dialog.close()
                resolve(true)
              }}
            >
              {language.t("common.continue")}
            </ButtonV2>
          </DialogFooter>
        </DialogV2>
      ))
    })
  }

  async function applyTemplate(template: SoulTemplate) {
    if (content().trim() && !(await confirmOverwrite(language.t(template.nameKey)))) return
    setContent(language.t(template.contentKey))
  }

  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-5 h-5 text-v2-text-text-muted" />
        </div>
      }
    >
      <div class="flex flex-col gap-4 p-6 max-w-3xl">
        <Show when={props.hint}>
          <p class="text-sm text-v2-text-text-muted">{props.hint}</p>
        </Show>
        <textarea
          class="w-full min-h-48 rounded-md bg-v2-background-base border border-v2-border-border-base p-3 text-sm text-v2-text-text-base outline-none focus:border-v2-border-border-active"
          value={content()}
          onInput={(e) => setContent(e.currentTarget.value)}
          placeholder={language.t("settings.soul.placeholder")}
        />
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-v2-text-text-muted">{language.t("settings.soul.templates")}</span>
          <For each={SOUL_TEMPLATES}>
            {(template) => (
              <ButtonV2 variant="ghost" size="small" onClick={() => void applyTemplate(template)}>
                {language.t(template.nameKey)}
              </ButtonV2>
            )}
          </For>
          <span
            class="ml-auto text-xs"
            classList={{
              "text-v2-text-text-muted": content().length <= SOFT_LIMIT,
              "text-v2-text-text-warning": content().length > SOFT_LIMIT,
            }}
          >
            {content().length > SOFT_LIMIT
              ? language.t("settings.soul.tooLong", { count: content().length })
              : language.t("settings.soul.charCount", { count: content().length })}
          </span>
          <ButtonV2 disabled={props.saving} onClick={() => void props.onSave(content().trim())}>
            {props.saving ? language.t("novel.settings.entry.saving") : language.t("settings.soul.save")}
          </ButtonV2>
        </div>
      </div>
    </Show>
  )
}
