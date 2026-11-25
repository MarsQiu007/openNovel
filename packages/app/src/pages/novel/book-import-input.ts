import type { NovelImportEncoding } from "@opennovel-ai/schema/novel"

export interface ImportFile {
  name: string
  dataUrl: string
}

export interface ImportParseOptions {
  cleanEnabled: boolean
  encoding: "auto" | NovelImportEncoding
  fallbackFixedLength: boolean
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
}) {
  if (input.analyzing || input.applying) return false
  if (input.preview === null) return false
  const normalizedTitle = input.title.trim()
  if (normalizedTitle.length === 0 || input.title.length > 60) return false
  return input.preview.volumes.length > 0 || input.fallbackFixedLength
}
