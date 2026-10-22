import { readFile } from "fs/promises"
import { join } from "path"

/**
 * clientV2 灵魂端点的最小结构类型（替代 import PluginInput：index.ts 引用 DOM 类型
 * HeadersInit，被 core 等无 DOM lib 的宿主程序跨包引入时会报 TS2304）。
 */
type PluginClient = {
  v2: {
    soul: {
      global(): Promise<{ data?: { content?: string } }>
    }
  }
}

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

/**
 * 直读全局灵魂文件（V2 路径）：与 server soul handler 同一文件
 * `<config>/soul.md` 纯文本。读取失败（未设置等）返回空串——灵魂缺失不阻断会话。
 */
export async function readGlobalSoulFile(configDir: string): Promise<string> {
  return (await readFile(join(configDir, "soul.md"), "utf8").catch(() => undefined)) ?? ""
}
