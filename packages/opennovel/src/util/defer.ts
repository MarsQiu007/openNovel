export function defer(fn: () => void | Promise<void>): AsyncDisposable & Disposable {
  return {
    [Symbol.dispose]() {
      // dispose 是 fire-and-forget：异步清理失败必须留痕，否则变成 unhandledRejection
      const result = fn()
      if (result instanceof Promise) result.catch((error) => console.error("defer cleanup failed", error))
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  }
}
