import type { PluginInput } from "../index.js"

type PluginClient = PluginInput["clientV2"]

/**
 * 合并规则（覆盖语义，严格二选一）：
 * 小说灵魂非空 → 只用小说的；否则全局非空 → 用全局；都空 → 不注入。
 * 空白字符串视为未设置。
 */
export function chooseSoul(novelSoul: string | null | undefined, globalSoul: string | null | undefined) {
  const novel = novelSoul?.trim()
  if (novel) return novel
  const global = globalSoul?.trim()
  return global ? global : undefined
}

// 全局灵魂 TTL 缓存：每次 LLM 请求都会触发注入，避免每请求一次本机 HTTP
const GLOBAL_SOUL_TTL = 5_000
let globalSoulCache: { value: string; at: number } | null = null

/**
 * 经 PluginInput.clientV2 调 server 端点读全局灵魂（plugin 无 core/xdg 依赖，
 * 不能自行解析全局 config 路径）。读取失败时 reject 由调用点捕获降级为空串——灵魂缺失不阻断会话。
 */
export async function fetchGlobalSoul(client: PluginClient): Promise<string> {
  const now = Date.now()
  if (globalSoulCache && now - globalSoulCache.at < GLOBAL_SOUL_TTL) return globalSoulCache.value
  const result = await client.v2.soul.global()
  const value = result.data?.content ?? ""
  globalSoulCache = { value, at: now }
  return value
}
