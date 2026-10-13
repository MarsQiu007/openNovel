export const normalizeServerUrl = (input: string): string | undefined => {
  // 用户手输的服务地址属于未校验输入：解析失败返回 undefined，由调用方提示「URL 非法」
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return undefined
  }
  url.search = ""
  url.hash = ""

  const pathname = url.pathname.replace(/\/+$/, "")
  return pathname.length === 0 ? url.origin : `${url.origin}${pathname}`
}
