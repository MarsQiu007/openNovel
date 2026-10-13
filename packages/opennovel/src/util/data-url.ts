export function decodeDataUrl(url: string) {
  const idx = url.indexOf(",")
  if (idx === -1) return ""

  const head = url.slice(0, idx)
  const body = url.slice(idx + 1)
  if (head.includes(";base64")) return Buffer.from(body, "base64").toString("utf8")
  // 百分号编码可能畸形（内容来自 prompt 附件），解码失败按空内容处理而不是抛 URIError
  try {
    return decodeURIComponent(body)
  } catch {
    return ""
  }
}
