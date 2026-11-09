/**
 * 内部会话统一过滤辅助（任务 2.2）。
 *
 * 新旧所有事件处理器在任何计数、Map 更新或报告触发之前，必须先用 isInternalEvent
 * 排除带 purpose 信封的事件；SessionRef 链读取用 isInternalSession 同语义排除。
 * 早发与晚消费的尾部事件同样携带 purpose（进程级注册表 tombstone 到进程退出），
 * 因此信封过滤天然覆盖两个方向的边界。
 */

export interface InternalEventMark {
  readonly purpose?: "tool-insight"
}

export interface InternalSessionMark {
  readonly purpose?: "tool-insight"
}

export const isInternalEvent = (event: InternalEventMark): boolean => event.purpose !== undefined

export const isInternalSession = (session: InternalSessionMark): boolean => session.purpose !== undefined
