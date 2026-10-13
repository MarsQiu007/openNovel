export class AsyncQueueClosedError extends Error {
  constructor() {
    super("AsyncQueue is closed")
  }
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private rejecters: ((error: unknown) => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  next(): Promise<T> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!)
    if (this.closed) return Promise.reject(new AsyncQueueClosedError())
    return new Promise<T>((resolve, reject) => {
      this.resolvers.push(resolve)
      this.rejecters.push(reject)
    })
  }

  // 生产端停止时必须唤醒等待者并终止迭代器，否则消费端会永久挂在 next() 上
  close() {
    if (this.closed) return
    this.closed = true
    this.queue.length = 0
    const waiting = this.rejecters.splice(0)
    this.resolvers.splice(0)
    for (const reject of waiting) reject(new AsyncQueueClosedError())
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      try {
        yield await this.next()
      } catch (error) {
        if (this.closed) return
        throw error
      }
    }
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
