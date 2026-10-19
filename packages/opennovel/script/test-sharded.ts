import { readdir } from "node:fs/promises"
import { join } from "node:path"

// bun test 单进程在 Windows 下跑全量约 220 个测试文件会触发 runner 内部忙等死循环
// （CPU 满载、无输出、--timeout 不生效，同 oven-sh/bun#32251 的累计性特征）；
// 55 文件/片 × 4 片 × 多轮实证稳定。本脚本把套件按文件数均分为 4 片串行跑，
// 每片独立 bun test 进程 + watchdog：超时强杀重试一次，再超时判失败。
// 任一片测试失败即整体非零退出，保持与原 bun test 一致的契约。
// 注意：Windows 下 Bun.spawn 的 proc.killed 对「用例失败的非零退出」误报 true，
// 超时判定必须以下方的自管 watchdog 标志为准。

const shardCount = 4
const shardTimeoutMs = 420_000
const root = join(import.meta.dir, "..")

const collect = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return collect(path)
      return entry.name.endsWith(".test.ts") ? [path] : []
    }),
  )
  return nested.flat()
}

const runShard = async (files: string[], attempt: number): Promise<number> => {
  const startedAt = Date.now()
  const proc = Bun.spawn({
    cmd: ["bun", "test", "--timeout", "90000", "--only-failures", ...files],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, shardTimeoutMs)
  const exitCode = await proc.exited
  clearTimeout(timer)
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
  if (timedOut && attempt === 0) {
    console.log(`[test-sharded] 片超时（${elapsed}s），重试一次`)
    return runShard(files, 1)
  }
  console.log(`[test-sharded] 片结束 exit=${exitCode} 用时=${elapsed}s 文件数=${files.length}`)
  return timedOut ? 1 : (exitCode ?? 1)
}

const files = (await collect(join(root, "test"))).sort()
const perShard = Math.ceil(files.length / shardCount)
const shards = Array.from({ length: shardCount }, (_, i) => files.slice(i * perShard, (i + 1) * perShard)).filter(
  (shard) => shard.length > 0,
)

console.log(`[test-sharded] ${files.length} 个测试文件分 ${shards.length} 片串行`)
const results: number[] = []
for (const shard of shards) {
  results.push(await runShard(shard, 0))
  if (results.at(-1) !== 0) break
}
const failed = results.filter((code) => code !== 0).length
console.log(`[test-sharded] 完成：${shards.length - failed}/${shards.length} 片通过`)
process.exit(failed > 0 ? 1 : 0)
