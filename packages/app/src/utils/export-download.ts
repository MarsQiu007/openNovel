import type { ExportFormat } from "@opennovel-ai/schema/novel"

const EXPORT_MIME: Record<ExportFormat, string> = {
  markdown: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  epub: "application/epub+zip",
}

export function createExportBlob(content: string, format: ExportFormat) {
  const body = format === "epub" ? base64ToUint8Array(content) : content
  return new Blob([body], { type: EXPORT_MIME[format] })
}

function base64ToUint8Array(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}