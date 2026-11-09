/**
 * 多进程问题摄取测试：两个 bun 子进程经真实 Flock document 锁并发摄取同一指纹。
 * 覆盖并发更新不丢次数、同一证据跨进程不重复计数、索引确定性收敛。
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { toolInsightIssuePath, toolInsightPaths } from "@opennovel-ai/novel-store"
import { issueFingerprint, parseIssueDoc } from "@opennovel-ai/plugin/tool-insight/issue-doc"

const workerPath = join(import.meta.dir, "fixture", "issue-worker.ts")

type WorkerSummary = { workerID: string; fingerprint: string; documented: number; duplicates: number }

const FACTS = { tool: "update_chapter", scenario: "chapter_revise", errorCategory: "validation_error" }

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
  return mkdtempSync(join(tmpdir(), "tool-insight-issue-mp-"))
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

async function bothWorkers(root: string, prefixA: string, prefixB: string) {
  return Promise.all([
    runWorker({ logRoot: root, workerID: "w1", prefix: prefixA, count: 5, facts: FACTS }),
    runWorker({ logRoot: root, workerID: "w2", prefix: prefixB, count: 5, facts: FACTS }),
  ])
}

describe("多进程问题摄取（真实 Flock document 锁）", () => {
  test(
    "并发摄取不同发生实例：次数不丢，索引收敛",
    async () => {
      const root = fixtureRoot()
      try {
        const workers = await bothWorkers(root, "wa", "wb")
        expect(workers.map((worker) => worker.documented)).toEqual([5, 5])
        const paths = toolInsightPaths(root)
        const fingerprint = issueFingerprint(FACTS)
        const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(paths, fingerprint), "utf-8"))
        expect(parsed.error).toBeUndefined()
        if (parsed.error) return
        expect(parsed.meta.occurrence_count).toBe(10)
        expect(parsed.meta.evidence_ids).toHaveLength(10)
        expect(parsed.meta.pending_evidence_ids).toHaveLength(10)
        const index = readFileSync(paths.index, "utf-8")
        expect(index).toContain(fingerprint)
        expect(index).toContain("| 10 |")
      } finally {
        cleanup(root)
      }
    },
    60_000,
  )

  test(
    "并发摄取相同证据 ID：跨进程去重不重复计数",
    async () => {
      const root = fixtureRoot()
      try {
        const workers = await bothWorkers(root, "shared", "shared")
        // 两个进程摄取同一批 ID：合计采用 5 条，其余按证据 ID 幂等跳过
        expect(workers.reduce((sum, worker) => sum + worker.documented, 0)).toBe(5)
        const paths = toolInsightPaths(root)
        const fingerprint = issueFingerprint(FACTS)
        const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(paths, fingerprint), "utf-8"))
        expect(parsed.error).toBeUndefined()
        if (parsed.error) return
        expect(parsed.meta.occurrence_count).toBe(5)
        expect(parsed.meta.evidence_ids).toHaveLength(5)
      } finally {
        cleanup(root)
      }
    },
    60_000,
  )
})
