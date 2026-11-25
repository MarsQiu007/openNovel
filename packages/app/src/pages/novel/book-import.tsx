/**
 * 书籍导入配置态（原文驱动导入）：文件、编码、书名、目标章长与正文修复强度。
 * 启动后跳转到同一任务的处理页 /:dir/novel/:novelID/import（jobID 稳定键，
 * 离开重进由持久化任务恢复）。无固定长度开关、无机械预览令牌。
 * 新固定文案用简体中文直写：locale 冻结（AGENTS.md），既有 key 继续走 language.t。
 */
import { createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useStartImport } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import type { NovelImportEncoding, NovelImportRepairLevel } from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { FieldV2 } from "@opennovel-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { Switch } from "@opennovel-ai/ui/v2/switch-v2"
import { Icon } from "@opennovel-ai/ui/v2/icon"
import { IMPORT_SUPPORTED_EXTENSIONS, importFilenameToTitle, isSupportedImportFileName } from "./book-import-utils"

const ENCODING_OPTIONS: NovelImportEncoding[] = ["utf-8", "utf-16le", "utf-16be", "gb18030", "big5"]

function parseEncodingSelect(value: string): "auto" | NovelImportEncoding {
  if (value === "auto") return "auto"
  return ENCODING_OPTIONS.find((option) => option === value) ?? "auto"
}

function parseRepairLevelSelect(value: string): NovelImportRepairLevel {
  return value === "aggressive" || value === "off" ? value : "standard"
}

function parseTargetChapterChars(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  const value = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(value) || value < 500 || value > 100_000) return undefined
  return value
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "data" in err) {
    const inner: unknown = err.data
    if (typeof inner === "object" && inner !== null && "message" in inner && typeof inner.message === "string") {
      return inner.message
    }
  }
  return err instanceof Error ? err.message : String(err)
}

export default function NovelImportWizard() {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const startImport = useStartImport()

  const [file, setFile] = createSignal<{ name: string; dataUrl: string } | null>(null)
  const [cleanEnabled, setCleanEnabled] = createSignal(true)
  const [encoding, setEncoding] = createSignal<"auto" | NovelImportEncoding>("auto")
  const [title, setTitle] = createSignal("")
  const [targetChars, setTargetChars] = createSignal("")
  const [repairLevel, setRepairLevel] = createSignal<NovelImportRepairLevel>("standard")

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
      if (title().trim().length === 0) setTitle(importFilenameToTitle(selected.name))
    } catch {
      showToast({ variant: "error", title: language.t("common.requestFailed") })
    }
  }

  function cancel() {
    // 启动前取消不产生任何书籍/原文/任务数据，直接离开
    navigate(`/${base64Encode(sdk().directory)}/`)
  }

  async function start() {
    const current = file()
    if (!current || startImport.isPending) return
    const normalizedTitle = title().trim()
    if (normalizedTitle.length === 0) {
      showToast({ variant: "error", title: language.t("novel.import.bookTitle") })
      return
    }
    try {
      const enc = encoding()
      const target = parseTargetChapterChars(targetChars())
      const progress = await startImport.mutateAsync({
        dataUrl: current.dataUrl,
        filename: current.name,
        title: normalizedTitle,
        ...(enc === "auto" ? {} : { encoding: enc }),
        ...(target === undefined ? {} : { targetChapterChars: target }),
        repairLevel: cleanEnabled() ? repairLevel() : "off",
      })
      navigate(`/${base64Encode(sdk().directory)}/novel/${progress.novelId}/import`)
    } catch (err) {
      showToast({ variant: "error", title: language.t("novel.import.applyFailed"), description: errorMessage(err) })
    }
  }

  return (
    <div class="flex flex-col h-full items-center justify-center p-8">
      <div class="w-full max-w-2xl">
        <div class="mb-6 flex">
          <ButtonV2 variant="ghost-muted" size="small" onClick={cancel}>
            ← {language.t("novel.bookshelf.open")}
          </ButtonV2>
        </div>
        <h2 class="text-lg font-medium text-v2-text-text-base mb-6">导入书稿</h2>
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
            <FieldV2.Label>{language.t("novel.import.bookTitle")}</FieldV2.Label>
            <TextInputV2 fluid value={title()} onInput={(e) => setTitle(e.currentTarget.value)} maxLength={60} />
            <FieldV2.Suffix class="text-right">{title().length}/60</FieldV2.Suffix>
          </FieldV2>

          <FieldV2>
            <FieldV2.Label>{language.t("novel.import.encoding")}</FieldV2.Label>
            <select
              value={encoding()}
              onChange={(e) => setEncoding(parseEncodingSelect(e.currentTarget.value))}
              class="h-8 px-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-base text-sm outline-none focus:border-v2-border-border-focus transition-colors cursor-pointer"
            >
              <option value="auto">{language.t("novel.import.encoding.auto")}</option>
              <For each={ENCODING_OPTIONS}>
                {(option) => <option value={option}>{language.t(`novel.import.encodings.${option}`)}</option>}
              </For>
            </select>
          </FieldV2>

          <FieldV2>
            <FieldV2.Label>目标章长（字符）</FieldV2.Label>
            <TextInputV2
              fluid
              value={targetChars()}
              onInput={(e) => setTargetChars(e.currentTarget.value)}
              placeholder="3000"
            />
            <FieldV2.Suffix class="text-xs text-v2-text-text-muted">
              Agent 软参考，不硬切
            </FieldV2.Suffix>
          </FieldV2>

          <div class="flex items-center gap-3">
            <Switch checked={cleanEnabled()} onChange={(checked: boolean) => setCleanEnabled(checked)}>
              {language.t("novel.import.clean")}
            </Switch>
            <span class="text-xs text-v2-text-text-muted">{language.t("novel.import.cleanHint")}</span>
          </div>

          <Show when={cleanEnabled()}>
            <div class="flex items-center gap-2 pl-1">
              <span class="text-xs text-v2-text-text-muted">修复强度</span>
              <select
                value={repairLevel()}
                onChange={(e) => setRepairLevel(parseRepairLevelSelect(e.currentTarget.value))}
                class="h-7 px-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-base text-xs outline-none focus:border-v2-border-border-focus transition-colors cursor-pointer"
              >
                <option value="standard">常规修复</option>
                <option value="aggressive">积极清理</option>
              </select>
            </div>
          </Show>

          <div class="flex items-center justify-between mt-4">
            <ButtonV2 variant="outline" size="large" onClick={cancel}>
              {language.t("novel.import.cancel")}
            </ButtonV2>
            <ButtonV2 variant="contrast" size="large" onClick={() => void start()} disabled={!file() || startImport.isPending}>
              {startImport.isPending ? language.t("novel.import.applying") : "开始导入"}
            </ButtonV2>
          </div>
        </div>
      </div>
    </div>
  )
}

