/**
 * 问题文档锁内编排测试（进程内 fake 锁）— 去重计数、归并、别名、pending/organized
 * 迁移、锁内重读、失败状态、运行记录与案例文档。
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { toolInsightCasePath, toolInsightIssuePath, toolInsightPaths, toolInsightRunPath } from "@opennovel-ai/novel-store"
import { issueFingerprint, parseIssueDoc, type ToolInsightIssueMeta } from "@opennovel-ai/plugin/tool-insight/issue-doc"
import {
  appendRunRecords,
  ingestEvidenceIssue,
  organizeUnderLock,
  parseCaseDoc,
  readRunRecords,
  recordOrganizeFailure,
  writeToolInsightCaseDoc,
  type IngestIssueInput,
} from "@opennovel-ai/plugin/tool-insight/issue-store"

const fakeLocks = new Map<string, Promise<unknown>>()

const file = {
  // 与 core 宿主 fake 同款：进程内按键串行化，保持「同键互斥、跨键并行」语义
  withLock: (input: { key: string }, callback: () => Promise<unknown>) => {
    const chain = fakeLocks.get(input.key) ?? Promise.resolve()
    const run = chain.then(callback, callback)
    fakeLocks.set(
      input.key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  },
}

const brokenFile = {
  withLock: () => Promise.reject(new Error("lock timed out")),
}

function newPaths() {
  const root = mkdtempSync(join(tmpdir(), "tool-insight-issue-"))
  const paths = toolInsightPaths(root)
  for (const dir of [paths.issuesDir, paths.runsDir, paths.casesDir, paths.recoveryDir, paths.locksDir]) {
    mkdirSync(dir, { recursive: true })
  }
  return { root, paths }
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

function facts(overrides: { tool?: string; scenario?: string; errorCategory?: string } = {}) {
  return { tool: "update_chapter", scenario: "chapter_revise", errorCategory: "validation_error", ...overrides }
}

let seq = 0

function ingestInput(overrides: Partial<IngestIssueInput> & { fingerprint?: string } = {}): IngestIssueInput {
  seq++
  const localFacts = overrides.facts ?? facts()
  return {
    fingerprint: overrides.fingerprint ?? issueFingerprint(localFacts),
    evidenceID: overrides.evidenceID ?? `evi_test${String(seq).padStart(12, "0")}`,
    occurrenceID: overrides.occurrenceID ?? `oci_test${String(seq).padStart(12, "0")}`,
    evidenceKind: overrides.evidenceKind ?? "tool_failed",
    occurredAt: overrides.occurredAt ?? Date.now(),
    facts: localFacts,
    affectedVersion: overrides.affectedVersion,
    aliasOf: overrides.aliasOf,
  }
}

function readMeta(paths: ReturnType<typeof toolInsightPaths>, fingerprint: string): ToolInsightIssueMeta {
  const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(paths, fingerprint), "utf-8"))
  if (parsed.error) throw new Error("expected parseable issue doc")
  return parsed.meta
}

describe("确定性摄取（document 锁）", () => {
  test("一次失败多条证据只计一次", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const first = await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, occurrenceID: "oci_same0000000001" }))
      expect(first).toEqual({ documented: true, created: true, newOccurrence: true })
      const second = await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, occurrenceID: "oci_same0000000001" }))
      expect(second).toEqual({ documented: true, created: false, newOccurrence: false })
      const third = await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, occurrenceID: "oci_same0000000001" }))
      expect(third).toEqual({ documented: true, created: false, newOccurrence: false })
      const meta = readMeta(paths, fp)
      expect(meta.occurrence_count).toBe(1)
      expect(meta.evidence_ids).toHaveLength(3)
      expect(meta.pending_evidence_ids).toHaveLength(3)
      expect(meta.first_seen_at).toBe(meta.created_at)
    } finally {
      cleanup(root)
    }
  })

  test("跨会话重复归并：不同发生实例累加次数，同一文档", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, occurrenceID: "oci_sessA000000001" }))
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, occurrenceID: "oci_sessB000000001" }))
      const meta = readMeta(paths, fp)
      expect(meta.occurrence_count).toBe(2)
      expect(meta.occurrence_ids).toEqual(["oci_sessA000000001", "oci_sessB000000001"])
      // 索引随摄取确定性重建
      const index = readFileSync(paths.index, "utf-8")
      expect(index).toContain(fp)
      expect(index).toContain("| 2 |")
    } finally {
      cleanup(root)
    }
  })

  test("不同操作场景不误并：各自建档", async () => {
    const { root, paths } = newPaths()
    try {
      const fpA = issueFingerprint(facts({ scenario: "chapter_revise" }))
      const fpB = issueFingerprint(facts({ scenario: "chapter_outline" }))
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fpA, facts: facts({ scenario: "chapter_revise" }) }))
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fpB, facts: facts({ scenario: "chapter_outline" }) }))
      expect(readMeta(paths, fpA).occurrence_count).toBe(1)
      expect(readMeta(paths, fpB).occurrence_count).toBe(1)
      expect(readMeta(paths, fpA).evidence_ids).not.toEqual(readMeta(paths, fpB).evidence_ids)
    } finally {
      cleanup(root)
    }
  })

  test("重复证据 ID 幂等：不重复计数、不重复登记", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const input = ingestInput({ fingerprint: fp })
      expect(await ingestEvidenceIssue(file, paths, input)).toMatchObject({ documented: true })
      const again = await ingestEvidenceIssue(file, paths, input)
      expect(again).toEqual({ documented: false, reason: "duplicate-evidence" })
      const meta = readMeta(paths, fp)
      expect(meta.occurrence_count).toBe(1)
      expect(meta.evidence_ids).toHaveLength(1)
    } finally {
      cleanup(root)
    }
  })

  test("分类变化保留别名：新指纹记旧指纹，旧文档原样保留", async () => {
    const { root, paths } = newPaths()
    try {
      const oldFacts = facts()
      const fpOld = issueFingerprint(oldFacts)
      const newFacts = facts({ errorCategory: "timeout" })
      const fpNew = issueFingerprint(newFacts)
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fpOld, facts: oldFacts }))
      const result = await ingestEvidenceIssue(
        file,
        paths,
        ingestInput({ fingerprint: fpNew, facts: newFacts, aliasOf: fpOld }),
      )
      expect(result).toMatchObject({ documented: true, created: true })
      expect(readMeta(paths, fpNew).aliases).toEqual([fpOld])
      // 旧文档不被静默重写
      expect(readMeta(paths, fpOld).evidence_ids).toHaveLength(1)
      const index = readFileSync(paths.index, "utf-8")
      expect(index).toContain(fpOld)
      expect(index).toContain(fpNew)
    } finally {
      cleanup(root)
    }
  })

  test("影响版本去重登记", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, affectedVersion: "0.1.5" }))
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, affectedVersion: "0.1.5" }))
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp, affectedVersion: "0.1.6" }))
      expect(readMeta(paths, fp).affected_versions).toEqual(["0.1.5", "0.1.6"])
    } finally {
      cleanup(root)
    }
  })
})

describe("后台整理（organize 锁 + document 锁）", () => {
  test("pending 迁移到 organized 并替换三个模型段落", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const e1 = ingestInput({ fingerprint: fp })
      const e2 = ingestInput({ fingerprint: fp })
      await ingestEvidenceIssue(file, paths, e1)
      await ingestEvidenceIssue(file, paths, e2)
      const applied = await organizeUnderLock(file, paths, { fingerprint: fp }, async () => ({
        hypotheses: "假设 A（推测）",
        suggestions: "建议 B",
        acceptance: "标准 C",
      }))
      expect(applied).toEqual({ applied: true, organized: [e1.evidenceID, e2.evidenceID] })
      const meta = readMeta(paths, fp)
      expect(meta.organize_status).toBe("organized")
      expect(meta.pending_evidence_ids).toEqual([])
      expect(meta.organized_evidence_ids).toEqual([e1.evidenceID, e2.evidenceID])
      expect(meta.evidence_ids).toHaveLength(2)
      const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(paths, fp), "utf-8"))
      if (parsed.error) throw new Error("expected parseable doc")
      expect(parsed.sections["原因假设"]).toBe("假设 A（推测）")
      expect(parsed.sections["改进建议"]).toBe("建议 B")
      expect(parsed.sections["验收标准"]).toBe("标准 C")
      // 事实与客观证据段落不被模型整理覆盖
      expect(parsed.sections["事实"]).toContain(`- 发生次数：${meta.occurrence_count}`)
      expect(parsed.sections["客观证据"]).toContain(e1.evidenceID)
      expect(readFileSync(paths.index, "utf-8")).toContain("organized")
      // 已无 pending：再次整理返回 nothing-pending
      const second = await organizeUnderLock(file, paths, { fingerprint: fp }, async () => ({
        hypotheses: "x",
        suggestions: "y",
        acceptance: "z",
      }))
      expect(second).toEqual({ applied: false, reason: "nothing-pending" })
    } finally {
      cleanup(root)
    }
  })

  test("整理期间新证据落盘：只采用首批，新证据保持 pending", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const e1 = ingestInput({ fingerprint: fp })
      await ingestEvidenceIssue(file, paths, e1)
      const applied = await organizeUnderLock(file, paths, { fingerprint: fp }, async (pending) => {
        expect(pending).toEqual([e1.evidenceID])
        // work 期间另一进程摄取了新证据（fake 锁跨键并行，document 锁可用）
        await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp }))
        return { hypotheses: "h", suggestions: "s", acceptance: "a" }
      })
      expect(applied).toEqual({ applied: true, organized: [e1.evidenceID] })
      const meta = readMeta(paths, fp)
      expect(meta.organized_evidence_ids).toEqual([e1.evidenceID])
      expect(meta.pending_evidence_ids).toHaveLength(1)
    } finally {
      cleanup(root)
    }
  })

  test("整理失败保留 pending 并记录失败状态", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp }))
      const result = await recordOrganizeFailure(file, paths, {
        fingerprint: fp,
        message: "model timeout after Authorization=sk-abc123",
      })
      expect(result).toEqual({ recorded: true })
      const meta = readMeta(paths, fp)
      expect(meta.organize_status).toBe("failed")
      expect(meta.organize_error).toContain("<redacted>")
      expect(meta.pending_evidence_ids).toHaveLength(1)
    } finally {
      cleanup(root)
    }
  })
})

describe("失败非阻断", () => {
  test("损坏文档：摄取与整理都停止且文件保持原样", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const broken = "这不是 frontmatter 文档\n随便写的正文"
      writeFileSync(toolInsightIssuePath(paths, fp), broken)
      const ingest = await ingestEvidenceIssue(file, paths, ingestInput({ fingerprint: fp }))
      expect(ingest).toEqual({ documented: false, reason: "corrupt-doc" })
      const organize = await organizeUnderLock(file, paths, { fingerprint: fp }, async () => ({
        hypotheses: "h",
        suggestions: "s",
        acceptance: "a",
      }))
      expect(organize).toEqual({ applied: false, reason: "corrupt-doc" })
      expect(readFileSync(toolInsightIssuePath(paths, fp), "utf-8")).toBe(broken)
    } finally {
      cleanup(root)
    }
  })

  test("锁不可用：不写入也不绕过", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const ingest = await ingestEvidenceIssue(brokenFile, paths, ingestInput({ fingerprint: fp }))
      expect(ingest).toEqual({ documented: false, reason: "lock-failed" })
      const organize = await organizeUnderLock(brokenFile, paths, { fingerprint: fp }, async () => ({
        hypotheses: "h",
        suggestions: "s",
        acceptance: "a",
      }))
      expect(organize).toEqual({ applied: false, reason: "lock-failed" })
      expect(() => readFileSync(toolInsightIssuePath(paths, fp))).toThrow()
      expect(readdirSync(paths.issuesDir).filter((name) => name.endsWith(".md"))).toHaveLength(0)
    } finally {
      cleanup(root)
    }
  })
})

describe("复测运行记录（run 锁）", () => {
  test("追加并读回；撕裂尾部先隔离修复", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      writeFileSync(toolInsightRunPath(paths, fp), '{"run":"torn"')
      const appended = await appendRunRecords(file, paths, {
        fingerprint: fp,
        records: [{ run: "r1", outcome: "passed" }],
      })
      expect(appended).toEqual({ appended: true })
      expect(readdirSync(paths.recoveryDir)).toHaveLength(1)
      const read = readRunRecords(paths, fp)
      expect(read.entries).toEqual([{ run: "r1", outcome: "passed" }])
      expect(read.corruptLines).toBe(0)
      expect(read.tailIncomplete).toBe(false)
    } finally {
      cleanup(root)
    }
  })

  test("中部损坏停止追加且文件保持原样", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const broken = '{"run":"a"}\n{{{broken\n{"run":"b"}\n'
      writeFileSync(toolInsightRunPath(paths, fp), broken)
      const appended = await appendRunRecords(file, paths, { fingerprint: fp, records: [{ run: "r1" }] })
      expect(appended).toEqual({ appended: false, reason: "corrupt-middle", corruptLines: 1 })
      expect(readFileSync(toolInsightRunPath(paths, fp), "utf-8")).toBe(broken)
    } finally {
      cleanup(root)
    }
  })
})

describe("复测案例文档（document 锁）", () => {
  test("渲染解析往返并声明禁止外部副作用", async () => {
    const { root, paths } = newPaths()
    try {
      const fp = issueFingerprint(facts())
      const meta = {
        format: 1,
        case_id: "case_test0000000001",
        fingerprint: fp,
        tool: "update_chapter",
        scenario: "chapter_revise",
        whitelist: ["update_chapter"],
        model: { providerID: "anthropic", modelID: "claude-haiku-5-5" },
        fix_version: "0.1.6",
        created_at: "2026-11-09T08:00:00.000Z",
      }
      const written = await writeToolInsightCaseDoc(file, paths, {
        meta,
        sections: { 说明: "修订未落库的最小复现", 夹具: "合成书籍一本、三章", 验收标准: "修订内容可从最终状态读回" },
      })
      expect(written).toEqual({ written: true })
      const text = readFileSync(toolInsightCasePath(paths, fp), "utf-8")
      const parsed = parseCaseDoc(text)
      expect(parsed.error).toBeUndefined()
      if (parsed.error) return
      expect(parsed.meta).toEqual(meta)
      expect(text).toContain("## 禁止外部副作用")
      expect(text).toContain("不得读写原书")
      expect(text).toContain("- `update_chapter`")
    } finally {
      cleanup(root)
    }
  })
})
