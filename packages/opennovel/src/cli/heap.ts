import path from "path"
import { writeHeapSnapshot } from "node:v8"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { Global } from "@opennovel-ai/core/global"
const MINUTE = 60_000
const LIMIT = 2 * 1024 * 1024 * 1024

let timer: Timer | undefined
let lock = false
let armed = true

export function start() {
  if (!Flag.OPENNOVEL_AUTO_HEAP_SNAPSHOT) return
  if (timer) return

  const run = async () => {
    if (lock) return

    const stat = process.memoryUsage()
    if (stat.rss <= LIMIT) {
      armed = true
      return
    }
    if (!armed) return

    lock = true
    armed = false
    const file = path.join(
      Global.Path.log,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    await Promise.resolve()
      .then(() => writeHeapSnapshot(file))
      .catch((error: unknown) => {
        // 快照仍是尽力而为，但权限/磁盘失败的原因需要可见
        const reason = error instanceof Error ? error.message : String(error)
        console.error(`Failed to write heap snapshot to ${file}: ${reason}`)
      })

    lock = false
  }

  timer = setInterval(() => {
    void run()
  }, MINUTE)
  timer.unref?.()
}

export * as Heap from "./heap"
