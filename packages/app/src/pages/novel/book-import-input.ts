import type { NovelImportEncoding } from "@opennovel-ai/schema/novel"

export interface ImportFile {
  name: string
  dataUrl: string
}

export interface ImportParseOptions {
  cleanEnabled: boolean
  encoding: "auto" | NovelImportEncoding
  fallbackFixedLength: boolean
  splitRange: { min: number; max: number }
  /** 拆章方式（narrative-unit-split）：缺省 fast，ai 时透传给 analyze/apply */
  splitMode?: "fast" | "ai"
}

export const DEFAULT_SPLIT_RANGE = { min: 2000, max: 3000 }

/** 兜底分章字数范围合法性（与 server 契约一致：500–20000 且 min < max）。 */
export function isValidSplitRange(range: { min: number; max: number }): boolean {
  return (
    Number.isInteger(range.min) &&
    Number.isInteger(range.max) &&
    range.min >= 500 &&
    range.max <= 20000 &&
    range.min < range.max
  )
}

export interface ImportPreviewShape {
  volumes: ReadonlyArray<unknown>
}

export function importSourceInput(file: ImportFile, options: ImportParseOptions) {
  return {
    dataUrl: file.dataUrl,
    filename: file.name,
    cleanEnabled: options.cleanEnabled,
    ...(options.encoding === "auto" ? {} : { encoding: options.encoding }),
    fallbackFixedLength: options.fallbackFixedLength,
    splitRange: options.splitRange,
    ...(options.splitMode === "ai" ? { splitMode: "ai" as const } : {}),
  }
}

export function shouldResetImportTitle(previousPreview: unknown) {
  return previousPreview === null
}

export function canConfirmImport(input: {
  title: string
  preview: ImportPreviewShape | null
  fallbackFixedLength: boolean
  analyzing: boolean
  applying: boolean
  splitMode?: "fast" | "ai"
}) {
  if (input.analyzing || input.applying) return false
  if (input.preview === null) return false
  const normalizedTitle = input.title.trim()
  if (normalizedTitle.length === 0 || input.title.length > 60) return false
  // AI 拆章预览无卷章树（估算代替），允许确认
  if (input.splitMode === "ai") return true
  return input.preview.volumes.length > 0 || input.fallbackFixedLength
}
