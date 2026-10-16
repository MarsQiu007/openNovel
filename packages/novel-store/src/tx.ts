/**
 * 统一事务入口 —— 全仓唯一的事务机制。
 *
 * 事务纪律（详见 novel-store/AGENTS.md 与本包双形态助手）：
 * - 业务代码禁止手写 BEGIN/COMMIT/ROLLBACK，一律经 withTransaction 走 ORM 同步回调事务；
 * - 组合点（编排多步写入的流程）负责开事务，事务体内调用写入助手的 *Tx 组合形态；
 * - 回调必须同步：异步续体不会落入本事务，返回 Promise 即抛错回滚；
 * - 驱动暴露「当前连接是否处于事务中」（bun:sqlite inTransaction / node:sqlite isTransaction，
 *   Node ≥ 24 才有后者）时先检测嵌套事务并给出可读错误，老运行时降级为不检测。
 */
import type { Db } from "./index.js"

/** 事务回调收到的会话对象类型（由各驱动 transaction 签名推导，双运行时结构一致）。 */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/**
 * 特性探测驱动「当前连接是否处于事务中」。
 *
 * bun:sqlite 的 Database 暴露 inTransaction，node:sqlite 的 DatabaseSync 暴露
 * isTransaction（Node v24.0.0 新增，v22.16.0 回溯）；两者皆无的运行时返回 undefined，
 * 调用方降级为不检测。
 */
export function detectInTransaction(client: unknown): boolean | undefined {
  if (client === null || typeof client !== "object") return undefined
  const probe = client as { inTransaction?: unknown; isTransaction?: unknown }
  if (typeof probe.inTransaction === "boolean") return probe.inTransaction
  if (typeof probe.isTransaction === "boolean") return probe.isTransaction
  return undefined
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  )
}

/**
 * 在单个数据库事务内执行同步回调，返回回调的返回值。
 *
 * 三种错误形态统一给出「回滚 + 可读错误」：
 * - 嵌套事务：驱动支持检测且当前连接已处于事务中时直接抛错（不经 ORM，避免依赖驱动各自的嵌套行为）；
 * - 异步回调：回调返回 thenable 即抛错，已发生的写入随事务回滚；
 * - 普通抛错：原样上抛，由 ORM 回滚。
 */
export function withTransaction<T>(db: Db, fn: (tx: Tx) => T): T {
  if (detectInTransaction(db.$client) === true) {
    throw new Error(
      "检测到嵌套事务：当前连接已处于事务中，请勿在事务内再次开启事务。多步写入组合请由最外层组合点统一开事务，内部改调写入助手的 *Tx 组合形态（首参接收事务对象）。",
    )
  }
  // 泛型 T 无法静态证明「非 Promise」，无法直接满足 drizzle 同步事务的条件签名；
  // 经 (tx) => unknown 缝隙委托，异步回调由下方运行时检查兜底（提交前抛错回滚）。
  const wrapped: (tx: Tx) => unknown = (tx) => {
    const result = fn(tx)
    if (isThenable(result)) {
      throw new Error(
        "withTransaction 回调必须是同步函数（不得返回 Promise）：事务内写入在驱动层同步执行，await 之后的续体不会落入本事务，放行会造成「看似有事务、实际无保护」的假象。",
      )
    }
    return result
  }
  return db.transaction(wrapped) as T
}
