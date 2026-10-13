export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  return (): T => {
    if (loaded) return value as T
    // 先求值再置位：fn 抛错时不缓存毒化的 undefined，允许后续调用重试
    value = fn()
    loaded = true
    return value as T
  }
}
