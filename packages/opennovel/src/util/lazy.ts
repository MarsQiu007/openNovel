export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let state: "idle" | "loading" | "loaded" = "idle"

  const result = (): T => {
    if (state === "loaded") return value as T
    // 重入说明工厂内部又取了这个懒值：不拦住的话 fn() 会被执行多次并缓存不同结果
    if (state === "loading") throw new Error("Lazy value initialized recursively")
    state = "loading"
    try {
      value = fn()
      state = "loaded"
      return value as T
    } catch (cause) {
      // 抛错时不缓存毒化的 undefined，允许后续调用重试（与 core 版同口径）
      state = "idle"
      value = undefined
      throw cause
    }
  }

  result.reset = () => {
    state = "idle"
    value = undefined
  }

  result.loaded = () => state === "loaded"

  return result
}