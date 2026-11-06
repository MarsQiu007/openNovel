/**
 * 正文编辑器自动保存间隔。
 *
 * 持久化值可能来自旧版本或被手工修改，读取必须经 resolveAutoSaveInterval 校验回退。
 */

export const AUTO_SAVE_INTERVAL_OPTIONS = [30_000, 60_000, 300_000] as const

export const AUTO_SAVE_INTERVAL_DEFAULT = 60_000

export function resolveAutoSaveInterval(value: unknown): number {
  if (typeof value === "number" && (AUTO_SAVE_INTERVAL_OPTIONS as readonly number[]).includes(value)) return value
  return AUTO_SAVE_INTERVAL_DEFAULT
}
