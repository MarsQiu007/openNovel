import { createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useAnalyzeImport, useApplyImport } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import type { NovelImportEncoding, NovelImportIssue, NovelImportPreview, NovelImportReport } from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { FieldV2 } from "@opennovel-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { Switch } from "@opennovel-ai/ui/v2/switch-v2"
import { Icon } from "@opennovel-ai/ui/v2/icon"
import { IMPORT_SUPPORTED_EXTENSIONS, importFilenameToTitle, isSupportedImportFileName } from "./book-import-utils"

const ENCODING_OPTIONS: NovelImportEncoding[] = ["utf-8", "utf-16le", "utf-16be", "gb18030", "big5"]

const ISSUE_TYPE_KEYS: Record<NovelImportIssue["type"], string> = {
  "sequence-gap": "novel.import.issues.sequence-gap",
  "duplicate-number": "novel.import.issues.duplicate-number",
  "order-mismatch": "novel.import.issues.order-mismatch",
  "unrecognized-boundary": "novel.import.issues.unrecognized-boundary",
}

const SUMMARY_KEYS = [
  ["whitespaceTrimmed", "novel.import.summary.whitespaceTrimmed"],
  ["blankLinesCollapsed", "novel.import.summary.blankLinesCollapsed"],
  ["punctuationNormalized", "novel.import.summary.punctuationNormalized"],
  ["linesMerged", "novel.import.summary.linesMerged"],
  ["adsRemoved", "novel.import.summary.adsRemoved"],
  ["duplicatesRemoved", "novel.import.summary.duplicatesRemoved"],
] as const

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function errorMessage(err: unknown): string {
  const data = (err as { data?: { message?: string } }).data
  return data?.message ?? (err instanceof Error ? err.message : String(err))
}

export default function NovelImportWizard() {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const analyzeImport = useAnalyzeImport()
  const applyImport = useApplyImport()

  const [step, setStep] = createSignal(0)
  const [file, setFile] = createSignal<{ name: string; dataUrl: string } | null>(null)
  const [cleanEnabled, setCleanEnabled] = createSignal(true)
  const [encoding, setEncoding] = createSignal<"auto" | NovelImportEncoding>("auto")
  const [fallbackFixedLength, setFallbackFixedLength] = createSignal(false)
  const [preview, setPreview] = createSignal<NovelImportPreview | null>(null)
  const [title, setTitle] = createSignal("")
  const [report, setReport] = createSignal<NovelImportReport | null>(null)

  const steps = [
    { title: language.t("novel.import.step.file") },
    { title: language.t("novel.import.step.preview") },
    { title: language.t("novel.import.step.report") },
  ]

  const unrecognized = () => {
    const current = preview()
    return current !== null && current.volumes.length === 0
  }

  let fileInput: HTMLInputElement | undefined

  async function pickFile(selected: File | undefined) {
    if (!selected) return
    if (!isSupportedImportFileName(selected.name)) {
      showToast({ variant: "error", title: language.t("novel.import.unsupported") })
      return
    }
    if (selected.size === 0) {
      showToast({ variant: "error", title: language.t("novel.import.emptyFile") })
      return
    }
    try {
      const dataUrl = await readFileDataUrl(selected)
      setFile({ name: selected.name, dataUrl })
      setPreview(null)
      setReport(null)
      setFallbackFixedLength(false)
    } catch {
      showToast({ variant: "error", title: language.t("common.requestFailed") })
    }
  }

  async function parse() {
    const current = file()
    if (!current) return
    const enc = encoding()
    try {
      const result = await analyzeImport.mutateAsync({
        dataUrl: current.dataUrl,
        filename: current.name,
        cleanEnabled: cleanEnabled(),
        ...(enc === "auto" ? {} : { encoding: enc }),
      })
      setPreview(result)
      setTitle(result.suggestedTitle || importFilenameToTitle(current.name))
      setStep(1)
    } catch (err) {
      showToast({ variant: "error", title: language.t("novel.import.parseFailed"), description: errorMessage(err) })
    }
  }

  function cancel() {
    // 取消不产生任何书籍数据：解析/确认全程不落库，直接离开即可
    navigate(`/${base64Encode(sdk().directory)}/`)
  }

  async function confirm() {
    const current = file()
    const currentPreview = preview()
    if (!current || !currentPreview) return
    const enc = encoding()
    try {
      const result = await applyImport.mutateAsync({
        previewToken: currentPreview.previewToken,
        title: title().trim(),
        dataUrl: current.dataUrl,
        filename: current.name,
        cleanEnabled: cleanEnabled(),
        ...(enc === "auto" ? {} : { encoding: enc }),
        fallbackFixedLength: fallbackFixedLength(),
      })
      setReport(result)
      setStep(2)
    } catch (err) {
      showToast({ variant: "error", title: language.t("novel.import.applyFailed"), description: errorMessage(err) })
    }
  }

  const canConfirm = () =>
    title().trim().length > 0 && title().length <= 60 && (!unrecognized() || fallbackFixedLength())

  return (
    <div class="flex flex-col h-full items-center justify-center p-8">
      <div class="w-full max-w-2xl">
        <div class="mb-6 flex">
          <ButtonV2 variant="ghost-muted" size="small" onClick={cancel}>
            ← {language.t("novel.bookshelf.open")}
          </ButtonV2>
        </div>
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
                {i() < steps.length - 1 && (
                  <div
                    class={`flex-1 h-px ${i() < step() ? "bg-v2-background-bg-accent" : "bg-v2-border-border-base"}`}
                  />
                )}
              </>
            )}
          </For>
        </div>

        {/* Step 0: 选择文件与解析选项 */}
        <Show when={step() === 0}>
          <div class="flex flex-col gap-4">
            <input
              ref={fileInput}
              type="file"
              accept={IMPORT_SUPPORTED_EXTENSIONS.join(",")}
              class="hidden"
              onChange={(e) => void pickFile(e.currentTarget.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileInput?.click()}
              class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-v2-border-border-base bg-v2-background-bg-layer-02 px-6 py-10 text-v2-text-text-muted hover:border-v2-border-border-focus transition-colors"
            >
              <Icon name="file" size="large" />
              <span class="text-sm">{file()?.name ?? language.t("novel.import.pick")}</span>
              <span class="text-xs">{language.t("novel.import.pickHint")}</span>
            </button>

            <FieldV2>
              <FieldV2.Label>{language.t("novel.import.encoding")}</FieldV2.Label>
              <select
                value={encoding()}
                onChange={(e) => setEncoding(e.currentTarget.value as "auto" | NovelImportEncoding)}
                class="h-8 px-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-base text-sm outline-none focus:border-v2-border-border-focus transition-colors cursor-pointer"
              >
                <option value="auto">{language.t("novel.import.encoding.auto")}</option>
                <For each={ENCODING_OPTIONS}>
                  {(option) => <option value={option}>{language.t(`novel.import.encodings.${option}`)}</option>}
                </For>
              </select>
            </FieldV2>

            <div class="flex items-center gap-3">
              <Switch checked={cleanEnabled()} onChange={(checked: boolean) => setCleanEnabled(checked)}>
                {language.t("novel.import.clean")}
              </Switch>
              <span class="text-xs text-v2-text-text-muted">{language.t("novel.import.cleanHint")}</span>
            </div>
          </div>
        </Show>

        {/* Step 1: 预览确认 */}
        <Show when={step() === 1}>
          <div class="flex flex-col gap-4">
            <FieldV2>
              <FieldV2.Label>{language.t("novel.import.bookTitle")}</FieldV2.Label>
              <TextInputV2 fluid value={title()} onInput={(e) => setTitle(e.currentTarget.value)} maxLength={60} />
              <FieldV2.Suffix class="text-right">{title().length}/60</FieldV2.Suffix>
            </FieldV2>

            <Show
              when={!unrecognized()}
              fallback={
                <div class="flex flex-col gap-3 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
                  <p class="text-sm text-v2-text-text-base">{language.t("novel.import.unrecognized")}</p>
                  <p class="text-xs text-v2-text-text-muted">{language.t("novel.import.unrecognizedHint")}</p>
                  <Switch
                    checked={fallbackFixedLength()}
                    onChange={(checked: boolean) => setFallbackFixedLength(checked)}
                  >
                    {language.t("novel.import.fallbackFixedLength")}
                  </Switch>
                </div>
              }
            >
              <div class="flex flex-col gap-2 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 max-h-64 overflow-y-auto">
                <For each={preview()?.volumes ?? []}>
                  {(volume) => (
                    <div class="flex flex-col gap-1">
                      <div class="text-sm font-medium text-v2-text-text-base">
                        {volume.title ?? language.t("novel.import.defaultVolume")}
                        <span class="text-xs text-v2-text-text-muted ml-2">
                          {language.t("novel.import.chapterCount", { count: volume.chapters.length })}
                        </span>
                      </div>
                      <For each={volume.chapters}>
                        {(chapter) => (
                          <div class="flex items-center justify-between pl-4 text-sm text-v2-text-text-muted">
                            <span class="truncate">{chapter.title}</span>
                            <span class="shrink-0 ml-2 text-xs">
                              {language.t("novel.import.wordCount", { count: chapter.wordCount })}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* 问题清单 */}
            <Show when={(preview()?.issues.length ?? 0) > 0}>
              <div class="flex flex-col gap-1 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
                <div class="text-sm font-medium text-v2-text-text-base">{language.t("novel.import.issues")}</div>
                <For each={preview()?.issues ?? []}>
                  {(issue) => (
                    <div class="text-sm text-v2-text-text-muted">
                      {language.t(ISSUE_TYPE_KEYS[issue.type])}：{issue.message}
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* 清洗摘要 */}
            <Show when={cleanEnabled()}>
              <div class="flex flex-col gap-1 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
                <div class="text-sm font-medium text-v2-text-text-base">{language.t("novel.import.summary.title")}</div>
                <For each={SUMMARY_KEYS}>
                  {([key, labelKey]) => (
                    <div class="flex items-center justify-between text-sm">
                      <span class="text-v2-text-text-muted">{language.t(labelKey)}</span>
                      <span class="text-v2-text-text-base">{preview()?.cleanSummary[key] ?? 0}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Step 2: 导入报告 */}
        <Show when={step() === 2}>
          <div class="flex flex-col gap-4 p-6 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
            <h3 class="text-base font-medium text-v2-text-text-base">{language.t("novel.import.report.title")}</h3>
            <div class="flex items-center gap-2">
              <span class="text-sm text-v2-text-text-muted">{language.t("novel.import.bookTitle")}:</span>
              <span class="text-sm font-medium text-v2-text-text-base">{report()?.title}</span>
            </div>
            <div class="flex items-center gap-4">
              <span class="text-sm text-v2-text-text-muted">
                {language.t("novel.import.report.volumes", { count: report()?.volumeCount ?? 0 })}
              </span>
              <span class="text-sm text-v2-text-text-muted">
                {language.t("novel.import.report.chapters", { count: report()?.chapterCount ?? 0 })}
              </span>
            </div>
            <Show when={(report()?.issues.length ?? 0) > 0}>
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium text-v2-text-text-base">{language.t("novel.import.issues")}</div>
                <For each={report()?.issues ?? []}>
                  {(issue) => (
                    <div class="text-sm text-v2-text-text-muted">
                      {language.t(ISSUE_TYPE_KEYS[issue.type])}：{issue.message}
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Navigation */}
        <div class="flex items-center justify-between mt-8">
          <Show
            when={step() === 1}
            fallback={
              <ButtonV2 variant="outline" size="large" onClick={cancel}>
                {language.t("novel.import.cancel")}
              </ButtonV2>
            }
          >
            <ButtonV2 variant="outline" size="large" onClick={() => setStep(0)}>
              {language.t("common.goBack")}
            </ButtonV2>
          </Show>
          <Show when={step() === 0}>
            <ButtonV2 variant="contrast" size="large" onClick={() => void parse()} disabled={!file() || analyzeImport.isPending}>
              {analyzeImport.isPending ? language.t("novel.import.parsing") : language.t("novel.import.parse")}
            </ButtonV2>
          </Show>
          <Show when={step() === 1}>
            <ButtonV2 variant="contrast" size="large" onClick={() => void confirm()} disabled={!canConfirm() || applyImport.isPending}>
              {applyImport.isPending ? language.t("novel.import.applying") : language.t("novel.import.confirm")}
            </ButtonV2>
          </Show>
          <Show when={step() === 2}>
            <ButtonV2
              variant="contrast"
              size="large"
              onClick={() => navigate(`/${base64Encode(sdk().directory)}/novel/${report()?.novelId}`)}
            >
              {language.t("novel.import.report.open")}
            </ButtonV2>
          </Show>
        </div>
      </div>
    </div>
  )
}
