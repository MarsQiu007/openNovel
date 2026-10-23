type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [{ path: "/experimental/workspace", action: "local" }]

export function isLocalWorkspaceRoute(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

export function workspaceProxyURL(target: string | URL, requestURL: URL) {
  const proxyURL = new URL(target)
  proxyURL.pathname = `${proxyURL.pathname.replace(/\/$/, "")}${requestURL.pathname}`
  proxyURL.search = requestURL.search
  proxyURL.hash = requestURL.hash
  proxyURL.searchParams.delete("workspace")
  return proxyURL
}
