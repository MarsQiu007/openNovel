/**
 * 工具改进日志的跨进程锁包装 — 区分「锁不可用」与「回调内部错误」。
 *
 * FileDomain.withLock 的超时/损坏抛错与回调自身抛错混在同一个 reject 通道里；
 * 不区分会把回调 bug 误报成 lock-failed，或把锁超时当成数据错误上抛阻断写作。
 * 统一在这里包装：回调错误原样重抛，锁获取失败折叠为 { ok: false } 由调用方
 * 决定非阻断行为（不写、不绕过锁直接落盘）。
 */
import type { FileDomain } from "../v2/effect/file.js"

export class LockCallbackError extends Error {
  constructor(readonly inner: unknown) {
    super("tool-insight lock callback failed")
  }
}

export type LockOutcome<T> = { ok: true; value: T } | { ok: false; reason: "lock-failed" }

/** 在指定跨进程锁内执行回调；回调错误原样重抛，锁不可用返回 lock-failed */
export async function runExclusive<T>(
  file: Pick<FileDomain, "withLock">,
  input: { dir: string; key: string; timeoutMs?: number },
  callback: () => Promise<T>,
): Promise<LockOutcome<T>> {
  try {
    const value = await file.withLock(input, async () => {
      try {
        return await callback()
      } catch (inner) {
        throw new LockCallbackError(inner)
      }
    })
    return { ok: true, value }
  } catch (error) {
    if (error instanceof LockCallbackError) throw error.inner
    return { ok: false, reason: "lock-failed" }
  }
}
