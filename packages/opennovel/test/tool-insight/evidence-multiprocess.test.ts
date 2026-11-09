/**
 * 真实多进程证据写入测试：多个 bun 子进程经宿主 FileDomain（Promise 版 Flock）
 * 并发执行「尾部检查—损坏尾部隔离—截断—追加」。覆盖并发追加不丢行、损坏尾部
 * 只隔离一次、完好历史不丢失、中部损坏停止追加、锁不可用不绕过写入。
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Flock } from "@opennovel-ai/core/util/flock"
import { readToolInsightJsonl, toolInsightPaths } from "@opennovel-ai/novel-store"
import { toolInsightLockKey } from "@opennovel-ai/plugin/tool-insight/evidence-store"

const workerPath = join(import.meta.dir, "fixture", "evidence-worker.ts")

type WorkerSummary = { workerID: string; appended: number; outcomes: Record<string, number> }

async function runWorker(task: Record<string, unknown>): Promise<WorkerSummary> {
  const proc = Bun.spawn([process.execPath, workerPath, JSON.stringify(task)], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(`worker failed (${exitCode}): ${stderr}`)
  const lines = stdout.trim().split("\n")
  return JSON.parse(lines[lines.length - 1]!) as WorkerSummary
}

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "tool-insight-mp-"))
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

describe("多进程证据写入（真实 Flock 跨进程）", () => {
  test(
    "并发追加不丢行且逐行可解析",
    async () => {
      const root = fixtureRoot()
      try {
        const workers = await Promise.all(
          ["w1", "w2", "w3"].map((workerID) => runWorker({ logRoot: root, workerID, batches: 5, recordsPerBatch: 4 })),
        )
        expect(workers.map((worker) => worker.appended)).toEqual([5, 5, 5])
        const read = readToolInsightJsonl(toolInsightPaths(root).evidence)
        expect(read.entries).toHaveLength(60)
        expect(read.corruptLines).toBe(0)
        expect(read.tailIncomplete).toBe(false)
      } finally {
        cleanup(root)
      }
    },
    60_000,
  )

  test(
    "损坏尾部只隔离一次，完好历史与并发追加都不丢",
    async () => {
      const root = fixtureRoot()
      try {
        const paths = toolInsightPaths(root)
        writeFileSync(paths.evidence, '{"id":"history-1"}\n{"id":"torn"')
        await Promise.all([
          runWorker({ logRoot: root, workerID: "w1", batches: 3, recordsPerBatch: 2 }),
          runWorker({ logRoot: root, workerID: "w2", batches: 3, recordsPerBatch: 2 }),
        ])
        const read = readToolInsightJsonl(paths.evidence)
        expect(read.entries).toHaveLength(13)
        expect((read.entries[0] as { id: string }).id).toBe("history-1")
        expect(read.corruptLines).toBe(0)
        expect(read.tailIncomplete).toBe(false)
        expect(readdirSync(paths.recoveryDir)).toHaveLength(1)
      } finally {
        cleanup(root)
      }
    },
    60_000,
  )

  test(
    "中部损坏停止追加且文件保持原样",
    async () => {
      const root = fixtureRoot()
      try {
        const paths = toolInsightPaths(root)
        const broken = '{"id":"history-1"}\n{{{broken-middle\n{"id":"after"}\n'
        writeFileSync(paths.evidence, broken)
        const worker = await runWorker({ logRoot: root, workerID: "w1", batches: 1, recordsPerBatch: 2 })
        expect(worker.appended).toBe(0)
        expect(worker.outcomes["corrupt-middle"]).toBe(1)
        expect(readFileSync(paths.evidence, "utf-8")).toBe(broken)
      } finally {
        cleanup(root)
      }
    },
    60_000,
  )

  test(
    "锁不可用时不绕过写入，锁释放后恢复",
    async () => {
      const root = fixtureRoot()
      try {
        const paths = toolInsightPaths(root)
        const key = toolInsightLockKey(root, "evidence")
        const lease = await Flock.acquire(key, { dir: paths.locksDir })
        try {
          const worker = await runWorker({ logRoot: root, workerID: "w1", batches: 1, recordsPerBatch: 1, timeoutMs: 200 })
          expect(worker.appended).toBe(0)
          expect(worker.outcomes["lock-failed"]).toBe(1)
          expect(readToolInsightJsonl(paths.evidence).entries).toHaveLength(0)
        } finally {
          await lease.release()
        }
        const after = await runWorker({ logRoot: root, workerID: "w2", batches: 1, recordsPerBatch: 1 })
        expect(after.appended).toBe(1)
        expect(readToolInsightJsonl(paths.evidence).entries).toHaveLength(1)
      } finally {
        cleanup(root)
      }
    },
    60_000,
  )
})
