export const deepLinkEvent = "opennovel:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("opennovel://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

type OpenNovelWindow = Window & {
  __OPENNOVEL__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenNovelWindow) => {
  const pending = target.__OPENNOVEL__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENNOVEL__) target.__OPENNOVEL__.deepLinks = []
  return pending
}
