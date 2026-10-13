export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timeout: NodeJS.Timeout
  const settled = promise.finally(() => {
    clearTimeout(timeout)
  })
  // 超时取胜后原 promise 可能稍后才 reject，不预挂 handler 就是 unhandledRejection
  settled.catch(() => {})
  return Promise.race([
    settled,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(label ?? `Operation timed out after ${ms}ms`))
      }, ms)
    }),
  ])
}