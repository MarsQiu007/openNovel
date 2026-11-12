/**
 * 书籍导入编码检测（book-import）：dataUrl 解码、大小/空文件校验、编码识别。
 *
 * 识别顺序：BOM 哨兵（UTF-8/UTF-16）→ UTF-16 无 BOM 零字节哨兵 →
 * UTF-8/GB18030/Big5 候选按「常见汉字码位占比 + ASCII 奖励 - 控制字符惩罚」打分，
 * 最高分低于阈值报编码识别失败。纯函数（TextDecoder 除外）无 IO。
 */
import type { NovelImportEncoding } from "@opennovel-ai/schema/novel"

/** 单书导入大小上限：50 MiB 原始字节 */
export const IMPORT_SIZE_LIMIT_BYTES = 50 * 1024 * 1024

export type DataUrlDecodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid-text" | "file-too-large" | "empty" }

export function decodeDataUrlBytes(dataUrl: string): DataUrlDecodeResult {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(dataUrl)
  if (!match) return { ok: false, reason: "invalid-text" }
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(match[1] ?? ""), (char) => char.charCodeAt(0))
  } catch {
    return { ok: false, reason: "invalid-text" }
  }
  if (bytes.length === 0) return { ok: false, reason: "empty" }
  if (bytes.length > IMPORT_SIZE_LIMIT_BYTES) return { ok: false, reason: "file-too-large" }
  return { ok: true, bytes }
}

export function decodeWithEncoding(bytes: Uint8Array, encoding: NovelImportEncoding): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export interface DecodedSource {
  text: string
  encoding: NovelImportEncoding
}

/** 打分候选含 UTF-16 双端序：中文正文无零字节特征，靠常见汉字占比区分端序与伪解码。 */
const SCORE_CANDIDATES: NovelImportEncoding[] = ["utf-8", "gb18030", "big5", "utf-16le", "utf-16be"]
/** 低于该分数视为无法可靠识别 */
const SCORE_THRESHOLD = 0.4

/** 常见汉字 U+4E00–U+9FFF 占比为主分；ASCII 字母数字小额奖励；控制字符重罚。 */
function scoreText(text: string): number {
  if (text.length === 0) return 0
  let cjk = 0
  let ascii = 0
  let control = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code >= 0x4e00 && code <= 0x9fff) cjk++
    else if ((code >= 0x20 && code < 0x7f) || code >= 0xa0) ascii++
    else control++
  }
  const total = text.length
  return (cjk / total) * 2 + Math.min(ascii / total, 0.3) * 0.5 - (control / total) * 4
}

export function detectAndDecode(bytes: Uint8Array): DecodedSource | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = decodeWithEncoding(bytes, "utf-8")
    if (text !== null) return { text, encoding: "utf-8" }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = decodeWithEncoding(bytes, "utf-16le")
    if (text !== null) return { text, encoding: "utf-16le" }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = decodeWithEncoding(bytes, "utf-16be")
    if (text !== null) return { text, encoding: "utf-16be" }
  }
  let best: DecodedSource | null = null
  let bestScore = 0
  for (const encoding of SCORE_CANDIDATES) {
    const text = decodeWithEncoding(bytes, encoding)
    if (text === null) continue
    const score = scoreText(text)
    if (score > bestScore) {
      bestScore = score
      best = { text, encoding }
    }
  }
  if (best === null || bestScore < SCORE_THRESHOLD) return null
  return best
}
