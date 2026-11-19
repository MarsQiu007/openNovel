export * as SessionPurpose from "./session-purpose"

/**
 * 后台会话 purpose 注册表 — 进程级、跨 Location 可见。
 *
 * 宿主在 create 之前登记 id → purpose；条目即使会话结束也不删除（tombstone 保留到
 * 进程退出），堵住「早发事件」和「晚消费事件」之间的递归采集窗口：任何时刻查询都能
 * 得到该会话是否内部会话的确定答案。公开 SessionEvent Schema 不受影响，标记只在
 * 宿主信封与 SessionRef 上回填。
 */

export type Purpose = "tool-insight"

const registry = new Map<string, Purpose>()
const locationRegistry = new Map<string, Purpose>()

export const register = (id: string, purpose: Purpose): void => {
  registry.set(id, purpose)
}

export const lookup = (id: string): Purpose | undefined => registry.get(id)

/** 隔离目录级标记：临时 Location 中的插件装载早于 Session create，必须按目录识别内部用途 */
export const registerLocation = (directory: string, purpose: Purpose): void => {
  locationRegistry.set(directory, purpose)
}

export const lookupLocation = (directory: string): Purpose | undefined => locationRegistry.get(directory)
