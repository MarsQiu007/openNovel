import { createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useCreateNovel } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { FieldV2 } from "@opennovel-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"

const GENRES = ["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"] as const

export default function NovelWizard() {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const createNovel = useCreateNovel()

  const [step, setStep] = createSignal(0)
  const [genre, setGenre] = createSignal<"" | (typeof GENRES)[number]>("")
  const [title, setTitle] = createSignal("")
  const [synopsis, setSynopsis] = createSignal("")

  const steps = [
    { title: language.t("novel.wizard.genre") },
    { title: language.t("novel.wizard.name") },
    { title: language.t("novel.wizard.description") },
    { title: language.t("novel.wizard.confirm.title") },
  ]

  function canNext() {
    switch (step()) {
      case 0:
        return genre() !== ""
      case 1:
        return title().trim().length > 0 && title().length <= 60
      case 2:
        return synopsis().trim().length > 0 && synopsis().length <= 500
      case 3:
        return true
    }
  }

  function next() {
    if (!canNext()) return
    if (step() < 3) setStep((s) => s + 1)
  }

  function prev() {
    if (step() > 0) setStep((s) => s - 1)
  }

  async function submit() {
    if (!genre() || !title().trim() || !synopsis().trim()) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
      })
      return
    }

    try {
      const result = await createNovel.mutateAsync({
        genre: genre() as (typeof GENRES)[number],
        title: title().trim(),
        synopsis: synopsis().trim(),
      })
      navigate(`/${base64Encode(sdk().directory)}/novel/${result.id}`)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div class="flex flex-col h-full items-center justify-center p-8">
      <div class="w-full max-w-2xl">
        {/* Step indicator */}
        <div class="flex items-center gap-2 mb-8">
          <For each={steps}>
            {(s, i) => (
              <>
                <div class="flex items-center gap-2">
                  <div
                    class={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      i() <= step()
                        ? "bg-v2-background-bg-accent text-v2-text-text-contrast"
                        : "bg-v2-background-bg-layer-02 text-v2-text-text-muted"
                    }`}
                  >
                    {i() + 1}
                  </div>
                  <span class={`text-sm ${i() <= step() ? "text-v2-text-text-base" : "text-v2-text-text-muted"}`}>
                    {s.title}
                  </span>
                </div>
                {i() < 3 && (
                  <div
                    class={`flex-1 h-px ${i() < step() ? "bg-v2-background-bg-accent" : "bg-v2-border-border-base"}`}
                  />
                )}
              </>
            )}
          </For>
        </div>

        {/* Step 0: Genre selection */}
        <Show when={step() === 0}>
          <div class="grid grid-cols-4 gap-3">
            <For each={GENRES}>
              {(g) => (
                <ButtonV2
                  variant={genre() === g ? "contrast" : "outline"}
                  class="!h-auto !w-full !p-4"
                  onClick={() => setGenre(g)}
                >
                  <div class="text-sm font-medium">{language.t(`novel.genre.${g}`)}</div>
                </ButtonV2>
              )}
            </For>
          </div>
        </Show>

        {/* Step 1: Title input */}
        <Show when={step() === 1}>
          <FieldV2>
            <FieldV2.Label>{language.t("novel.wizard.name")}</FieldV2.Label>
            <TextInputV2
              fluid
              appearance="large"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              maxLength={60}
              placeholder={language.t("novel.wizard.namePlaceholder")}
            />
            <FieldV2.Suffix class="text-right">{title().length}/60</FieldV2.Suffix>
          </FieldV2>
        </Show>

        {/* Step 2: Synopsis input */}
        <Show when={step() === 2}>
          <FieldV2>
            <FieldV2.Label>{language.t("novel.wizard.description")}</FieldV2.Label>
            <TextareaV2
              fluid
              value={synopsis()}
              onInput={(e) => setSynopsis(e.currentTarget.value)}
              maxLength={500}
              rows={6}
              placeholder={language.t("novel.wizard.descriptionPlaceholder")}
            />
            <FieldV2.Suffix class="text-right">{synopsis().length}/500</FieldV2.Suffix>
          </FieldV2>
        </Show>

        {/* Step 3: Confirm */}
        <Show when={step() === 3}>
          <div class="flex flex-col gap-4 p-6 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
            <h3 class="text-base font-medium text-v2-text-text-base">{language.t("novel.wizard.confirm.title")}</h3>
            <p class="text-sm text-v2-text-text-muted">{language.t("novel.wizard.confirm.description")}</p>
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2">
                <span class="text-sm text-v2-text-text-muted">{language.t("novel.wizard.genre")}:</span>
                <span class="text-sm font-medium text-v2-text-text-base">
                  {genre() ? language.t(`novel.genre.${genre()}`) : ""}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-sm text-v2-text-text-muted">{language.t("novel.wizard.name")}:</span>
                <span class="text-sm font-medium text-v2-text-text-base">{title()}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-sm text-v2-text-text-muted">{language.t("novel.wizard.description")}:</span>
                <p class="text-sm text-v2-text-text-base whitespace-pre-wrap">{synopsis()}</p>
              </div>
            </div>
          </div>
        </Show>

        {/* Navigation buttons */}
        <div class="flex items-center justify-between mt-8">
          <ButtonV2 variant="outline" size="large" onClick={prev} disabled={step() === 0}>
            {language.t("common.goBack")}
          </ButtonV2>
          <Show
            when={step() < 3}
            fallback={
              <ButtonV2 variant="contrast" size="large" onClick={submit} disabled={createNovel.isPending}>
                {createNovel.isPending ? language.t("common.saving") : language.t("common.submit")}
              </ButtonV2>
            }
          >
            <ButtonV2 variant="contrast" size="large" onClick={next} disabled={!canNext()}>
              {language.t("common.continue")}
            </ButtonV2>
          </Show>
        </div>
      </div>
    </div>
  )
}
