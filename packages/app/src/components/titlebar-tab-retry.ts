import { isNovelNotFoundError } from "@/utils/server-errors"

// 确定性 NotFound 只需一次错误终态供自愈清理；网络或服务端错误仍保留默认重试。
export function shouldRetryNovelDetail(error: unknown) {
  return !isNovelNotFoundError(error)
}
