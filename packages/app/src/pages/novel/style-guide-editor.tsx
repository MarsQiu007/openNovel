/**
 * 设定中心 — 写作风格表单（tone / pov / tense / rules / 篇幅限制）。
 *
 * 从 world-reader.tsx 抽出为独立模块（setting-center-tree）；篇幅限制复选框自头部
 * 编辑表单迁入本节点（chapter-length-limit 的 UI 落点）：回填与写入语义不变，
 * rules 文本域排除 chapter_length_limit 键，保存时以 "true"/"false" 写入 rules。
 */
import { type Accessor, createEffect, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { useStyleGuide, useUpdateStyleGuide } from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { CheckboxV2 } from "@opennovel-ai/ui/v2/checkbox-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"

export type StyleGuideEditorProps = {
  novelID: Accessor<string>
}

export function StyleGuideEditor(props: StyleGuideEditorProps) {
  const language = useLanguage()
  const query = useStyleGuide(props.novelID)
  const update = useUpdateStyleGuide()
  const [tone, setTone] = createSignal("")
  const [pov, setPov] = createSignal("")
  const [tense, setTense] = createSignal("")
  const [rules, setRules] = createSignal("")
  const [lengthLimit, setLengthLimit] = createSignal(false)

  // 初次载入 / 远端变更时填充表单；chapter_length_limit 由复选框独立承载，不进 rules 文本域
  createEffect(() => {
    const data = query.data
    if (!data) return
    setTone(data.tone)
    setPov(data.pov)
    setTense(data.tense)
    setLengthLimit(data.rules?.chapter_length_limit === "true")
    setRules(
      Object.entries(data.rules ?? {})
        .filter(([k]) => k !== "chapter_length_limit")
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    )
  })

  async function save() {
    const parsed = Object.fromEntries(
      rules()
        .split("\n")
        .map((line) => {
          const idx = line.search(/[:：]/)
          if (idx <= 0) return null
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as const
        })
        .filter((entry): entry is readonly [string, string] => entry !== null && entry[0].length > 0),
    )
    await update.mutateAsync({
      novelID: props.novelID(),
      tone: tone().trim(),
      pov: pov().trim(),
      tense: tense().trim(),
      rules: { chapter_length_limit: lengthLimit() ? "true" : "false", ...parsed },
    })
    showToast({
      variant: "success",
      title: language.t("novel.settings.style.saved"),
    })
  }

  return (
    <div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <Show
        when={!query.isLoading}
        fallback={
          <div class="flex items-center justify-center py-8">
            <Spinner class="w-5 h-5 text-v2-text-text-muted" />
          </div>
        }
      >
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={tone()}
              onInput={(e) => setTone(e.currentTarget.value)}
              placeholder={language.t("novel.style.tone")}
            />
          </div>
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={pov()}
              onInput={(e) => setPov(e.currentTarget.value)}
              placeholder={language.t("novel.style.pov")}
            />
          </div>
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={tense()}
              onInput={(e) => setTense(e.currentTarget.value)}
              placeholder={language.t("novel.style.tense")}
            />
          </div>
        </div>
        <TextareaV2
          fluid
          class="font-mono"
          value={rules()}
          onInput={(e) => setRules(e.currentTarget.value)}
          placeholder={language.t("novel.style.rulesHint")}
          rows={10}
        />
        <CheckboxV2
          checked={lengthLimit()}
          onChange={(checked) => setLengthLimit(checked)}
          label="篇幅限制（±15%）"
          description="启用后，每章正文字数必须落在目标字数 ±15% 区间内，超出会被拒绝写入"
        />
        <div>
          <ButtonV2 variant="contrast" size="small" onClick={() => void save()} disabled={update.isPending}>
            {update.isPending ? language.t("novel.settings.entry.saving") : language.t("common.action.save")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}
