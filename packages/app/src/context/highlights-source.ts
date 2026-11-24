// 版本亮点数据源（changelog-fetch-fallback）：远端优先，远端 404/网络失败/格式非法时回退内置快照。
const CHANGELOG_SOURCES = ["https://opennovel.ai/changelog.json", "/changelog-snapshot.json"]

export async function fetchChangelogJson(
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<unknown | undefined> {
  for (const url of CHANGELOG_SOURCES) {
    try {
      const response = await fetcher(url, { signal, headers: { Accept: "application/json" } })
      if (!response.ok) continue
      return await response.json()
    } catch {
      // 中止或单个数据源失败：继续尝试下一个数据源；全部失败由调用方静默跳过
    }
  }
  return undefined
}