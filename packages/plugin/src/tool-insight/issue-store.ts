/**
 * 问题文档、索引、案例与运行记录的锁内编排。
 *
 * 锁分工（全部为跨进程真实 Flock，键按日志根哈希派生）：
 * - document 锁：问题文档读改写 + 索引重建 + 案例文档原子替换。确定性摄取（ingest）
 *   在锁内重读文档，按证据 ID 与发生实例 ID 去重后原子替换，多进程并发不丢次数。
 * - organize:<fingerprint> 锁：覆盖一次后台整理及其最终文档合并；取得锁后先重读
 *   pending ID，已被其他进程整理则跳过。整理落盘再进入 document 锁（嵌套顺序恒为
 *   organize → document，与 ingest 无反向嵌套，不会死锁）。
 * - run:<fingerprint> 锁：复测运行记录沿用 evidence 的「尾部检查—隔离—截断—追加」。
 *
 * 所有失败非阻断：锁不可用不写也不绕过；损坏文档保留原样并报告 corrupt-doc；
 * 磁盘写失败由 novel-store 降级为警告并返回 io-failed。
 */
import { readdirSync, readFileSync } from "fs"
import {
  readToolInsightJsonl,
  replaceToolInsightFile,
  toolInsightCasePath,
  toolInsightIssuePath,
  toolInsightRunPath,
  type ToolInsightPaths,
} from "@opennovel-ai/novel-store"
import { redactSummary, type ToolInsightEvidenceKind } from "./evidence.js"
import { toolInsightLockKey, appendJsonlUnderLock, type AppendJsonlResult } from "./evidence-store.js"
import { runExclusive } from "./locks.js"
import {
  createIssueMeta,
  parseIssueDoc,
  renderEvidenceLine,
  renderFactsSection,
  renderIssueDoc,
  renderToolInsightIndex,
  type ParsedIssueDoc,
  type ToolInsightFingerprintInput,
  type ToolInsightIndexEntry,
  type ToolInsightIssueMeta,
  type IssueSections,
} from "./issue-doc.js"
import type { FileDomain } from "../v2/effect/file.js"

function warnStore(stage: string, detail: string, err?: unknown) {
  console.warn(`[tool-insight] ${stage}: ${detail}`, err ?? "")
}

export type IssueMetaRead = { error: "corrupt" | "missing" } | { error?: undefined; meta: ToolInsightIssueMeta }

/** 读取问题文档 frontmatter（补充反馈入口用：取既有发生实例列表） */
export function readIssueMeta(paths: ToolInsightPaths, fingerprint: string): IssueMetaRead {
  const parsed = readIssueDoc(toolInsightIssuePath(paths, fingerprint))
  if (parsed.error === "missing") return { error: "missing" }
  if (parsed.error) return { error: "corrupt" }
  return { meta: parsed.meta }
}

function readIssueDoc(filePath: string): ParsedIssueDoc | { error: "missing" } {
  let text: string
  try {
    text = readFileSync(filePath, "utf-8")
  } catch {
    return { error: "missing" }
  }
  return parseIssueDoc(text)
}

/** 索引从全部问题文档 frontmatter 确定性重建；必须在 document 锁内调用 */
function rebuildIndexLocked(paths: ToolInsightPaths): boolean {
  let files: string[]
  try {
    files = readdirSync(paths.issuesDir)
  } catch {
    files = []
  }
  const metas: ToolInsightIndexEntry[] = []
  for (const name of files) {
    if (!name.endsWith(".md")) continue
    const parsed = readIssueDoc(`${paths.issuesDir}/${name}`)
    if (parsed.error) {
      warnStore("index", `跳过无法解析的问题文档 ${name}`)
      continue
    }
    metas.push(parsed.meta)
  }
  return replaceToolInsightFile(paths.index, renderToolInsightIndex(metas))
}

export interface IngestIssueInput {
  fingerprint: string
  evidenceID: string
  occurrenceID: string
  evidenceKind: ToolInsightEvidenceKind
  /** 证据发生的墙钟时间（epoch ms）；只用于时间展示与 last_seen 比较，不参与指纹 */
  occurredAt: number
  /** 建档用的稳定事实（仅首次创建时消费） */
  facts: ToolInsightFingerprintInput
  affectedVersion?: string
  /** 指纹演变前的历史指纹：新文档记别名，旧文档保持原样 */
  aliasOf?: string
}

export type IngestIssueResult =
  | { documented: true; created: boolean; newOccurrence: boolean }
  | { documented: false; reason: "duplicate-evidence" | "lock-failed" | "corrupt-doc" | "io-failed" }

/**
 * 确定性摄取：document 锁内读改写问题文档并重建索引。
 * 出现次数只按发生实例 ID 去重；证据按证据 ID 去重，同一发生实例的多条证据只计一次。
 */
export async function ingestEvidenceIssue(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: IngestIssueInput,
  options?: { timeoutMs?: number },
): Promise<IngestIssueResult> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "document"), timeoutMs: options?.timeoutMs },
    async () => {
      const filePath = toolInsightIssuePath(paths, input.fingerprint)
      const parsed = readIssueDoc(filePath)
      if (parsed.error === "corrupt") return { documented: false, reason: "corrupt-doc" } as const
      const existing = parsed.error ? undefined : parsed
      if (existing && existing.meta.evidence_ids.includes(input.evidenceID)) {
        return { documented: false, reason: "duplicate-evidence" } as const
      }

      const now = new Date()
      const meta: ToolInsightIssueMeta =
        existing?.meta ?? createIssueMeta({ fingerprint: input.fingerprint, facts: input.facts, aliasOf: input.aliasOf, now })
      const created = !existing

      const newOccurrence = !meta.occurrence_ids.includes(input.occurrenceID)
      if (newOccurrence) meta.occurrence_ids.push(input.occurrenceID)
      meta.occurrence_count = meta.occurrence_ids.length
      meta.evidence_ids.push(input.evidenceID)
      if (!meta.pending_evidence_ids.includes(input.evidenceID) && !meta.organized_evidence_ids.includes(input.evidenceID)) {
        meta.pending_evidence_ids.push(input.evidenceID)
      }
      if (input.affectedVersion && !meta.affected_versions.includes(input.affectedVersion)) {
        meta.affected_versions.push(input.affectedVersion)
      }
      const occurredISO = new Date(input.occurredAt).toISOString()
      if (occurredISO > meta.last_seen_at) meta.last_seen_at = occurredISO
      meta.updated_at = now.toISOString()

      const sections: IssueSections = existing ? { ...existing.sections } : {}
      const previousEvidence = (sections["客观证据"] ?? "").split("\n").filter((line) => line.startsWith("- "))
      const line = renderEvidenceLine({
        evidenceID: input.evidenceID,
        occurredAt: input.occurredAt,
        kind: input.evidenceKind,
        occurrenceID: input.occurrenceID,
      })
      sections["客观证据"] = [...previousEvidence, line].join("\n")
      sections["事实"] = renderFactsSection(meta)

      if (!replaceToolInsightFile(filePath, renderIssueDoc(meta, sections))) {
        return { documented: false, reason: "io-failed" } as const
      }
      rebuildIndexLocked(paths)
      return { documented: true, created, newOccurrence } as const
    },
  )
  return outcome.ok ? outcome.value : { documented: false, reason: "lock-failed" }
}

/** 模型整理成功后提交的三个指定段落内容；结构校验由调用方（整理编排层）负责 */
export interface OrganizedSections {
  hypotheses: string
  suggestions: string
  acceptance: string
}

export type OrganizeResult =
  | { applied: true; organized: string[] }
  | { applied: false; reason: "nothing-pending" | "lock-failed" | "corrupt-doc" | "io-failed" }

/**
 * 一次后台整理及其最终文档合并：organize 锁内先读 pending 并执行 work（模型请求），
 * 再进 document 锁重读文档、把本批证据 ID 原子移入 organized、替换三个模型段落并
 * 重建索引。并发下另一进程已把 pending 清空时返回 nothing-pending，不重复整理。
 */
export async function organizeUnderLock(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { fingerprint: string; timeoutMs?: number },
  work: (pendingEvidenceIDs: readonly string[]) => Promise<OrganizedSections>,
): Promise<OrganizeResult> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "organize", input.fingerprint), timeoutMs: input.timeoutMs },
    async () => {
      const filePath = toolInsightIssuePath(paths, input.fingerprint)
      const first = readIssueDoc(filePath)
      if (first.error === "corrupt") return { applied: false, reason: "corrupt-doc" } as const
      if (first.error) return { applied: false, reason: "nothing-pending" } as const
      const pending = first.meta.pending_evidence_ids
      if (pending.length === 0) return { applied: false, reason: "nothing-pending" } as const

      const sections = await work(pending)

      const inner = await runExclusive(
        file,
        { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "document"), timeoutMs: input.timeoutMs },
        async () => {
          const current = readIssueDoc(filePath)
          if (current.error === "corrupt") return { applied: false, reason: "corrupt-doc" } as const
          if (current.error) return { applied: false, reason: "nothing-pending" } as const
          const meta = current.meta
          // 锁内重读：已被其他进程移走的 ID 不再采用
          const organized = pending.filter((id) => meta.pending_evidence_ids.includes(id))
          if (organized.length === 0) return { applied: false, reason: "nothing-pending" } as const
          meta.pending_evidence_ids = meta.pending_evidence_ids.filter((id) => !organized.includes(id))
          for (const id of organized) {
            if (!meta.organized_evidence_ids.includes(id)) meta.organized_evidence_ids.push(id)
          }
          meta.organize_status = "organized"
          meta.organize_error = null
          meta.updated_at = new Date().toISOString()
          const next: IssueSections = {
            ...current.sections,
            原因假设: sections.hypotheses,
            改进建议: sections.suggestions,
            验收标准: sections.acceptance,
          }
          if (!replaceToolInsightFile(filePath, renderIssueDoc(meta, next))) {
            return { applied: false, reason: "io-failed" } as const
          }
          rebuildIndexLocked(paths)
          return { applied: true, organized } as const
        },
      )
      return inner.ok ? inner.value : ({ applied: false, reason: "lock-failed" } as const)
    },
  )
  return outcome.ok ? outcome.value : { applied: false, reason: "lock-failed" }
}

export type RequeueResult =
  | { queued: true }
  | { queued: false; reason: "lock-failed" | "corrupt-doc" | "missing" | "io-failed" }

/**
 * 启动对账用：已被文档 evidence_ids 引用、但既不在 pending 也不在 organized 的证据
 * （崩溃残留的状态不一致）在 document 锁内补回 pending。幂等：已在任一集合时不改。
 */
export async function requeueEvidence(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { fingerprint: string; evidenceID: string; timeoutMs?: number },
): Promise<RequeueResult> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "document"), timeoutMs: input.timeoutMs },
    async () => {
      const filePath = toolInsightIssuePath(paths, input.fingerprint)
      const parsed = readIssueDoc(filePath)
      if (parsed.error === "corrupt") return { queued: false, reason: "corrupt-doc" } as const
      if (parsed.error) return { queued: false, reason: "missing" } as const
      const meta = parsed.meta
      if (!meta.evidence_ids.includes(input.evidenceID)) return { queued: false, reason: "missing" } as const
      if (meta.pending_evidence_ids.includes(input.evidenceID) || meta.organized_evidence_ids.includes(input.evidenceID)) {
        return { queued: true } as const
      }
      meta.pending_evidence_ids.push(input.evidenceID)
      meta.updated_at = new Date().toISOString()
      const sections: IssueSections = { ...parsed.sections, 事实: renderFactsSection(meta) }
      if (!replaceToolInsightFile(filePath, renderIssueDoc(meta, sections))) {
        return { queued: false, reason: "io-failed" } as const
      }
      rebuildIndexLocked(paths)
      return { queued: true } as const
    },
  )
  return outcome.ok ? outcome.value : { queued: false, reason: "lock-failed" }
}

export type ReorganizeRequestResult =
  | { queued: true }
  | { queued: false; reason: "lock-failed" | "corrupt-doc" | "missing" | "io-failed" }

/** 启动对账用：document 锁内从全部问题文档 frontmatter 确定性重建索引 */
export async function rebuildIssueIndex(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  options?: { timeoutMs?: number },
): Promise<{ rebuilt: boolean }> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "document"), timeoutMs: options?.timeoutMs },
    async () => rebuildIndexLocked(paths),
  )
  return { rebuilt: outcome.ok ? outcome.value : false }
}

/** 启动对账用：列出仍有待整理证据的指纹（不可读/损坏文档跳过） */
export function listPendingFingerprints(paths: ToolInsightPaths): string[] {
  let files: string[]
  try {
    files = readdirSync(paths.issuesDir)
  } catch {
    return []
  }
  return files
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => {
      const parsed = readIssueDoc(`${paths.issuesDir}/${name}`)
      if (parsed.error) return []
      return parsed.meta.pending_evidence_ids.length > 0 ? [parsed.meta.fingerprint] : []
    })
}
/**
 * 用户「重新整理」入口：document 锁内把该问题的全部证据放回 pending 并重置整理
 * 状态，由后台整理队列（任务 4.1）与启动补整理按既有流程重新生成三段内容。
 * 旧的假设段落保留到下一次整理成功时才被替换；证据与发生次数不变。
 */
export async function requestReorganize(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { fingerprint: string; timeoutMs?: number },
): Promise<ReorganizeRequestResult> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "document"), timeoutMs: input.timeoutMs },
    async () => {
      const filePath = toolInsightIssuePath(paths, input.fingerprint)
      const parsed = readIssueDoc(filePath)
      if (parsed.error === "corrupt") return { queued: false, reason: "corrupt-doc" } as const
      if (parsed.error) return { queued: false, reason: "missing" } as const
      const meta = parsed.meta
      meta.pending_evidence_ids = [...new Set(meta.evidence_ids)]
      meta.organized_evidence_ids = []
      meta.organize_status = "pending"
      meta.organize_error = null
      meta.updated_at = new Date().toISOString()
      const sections: IssueSections = { ...parsed.sections, 事实: renderFactsSection(meta) }
      if (!replaceToolInsightFile(filePath, renderIssueDoc(meta, sections))) {
        return { queued: false, reason: "io-failed" } as const
      }
      rebuildIndexLocked(paths)
      return { queued: true } as const
    },
  )
  return outcome.ok ? outcome.value : { queued: false, reason: "lock-failed" }
}

export type FailureRecordResult =
  | { recorded: true }
  | { recorded: false; reason: "lock-failed" | "corrupt-doc" | "missing" | "io-failed" }

/** 整理失败落状态：保留 pending 与事实段落，只标失败原因（脱敏截断），不阻断采集 */
export async function recordOrganizeFailure(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { fingerprint: string; message: string; timeoutMs?: number },
): Promise<FailureRecordResult> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "document"), timeoutMs: input.timeoutMs },
    async () => {
      const filePath = toolInsightIssuePath(paths, input.fingerprint)
      const parsed = readIssueDoc(filePath)
      if (parsed.error === "corrupt") return { recorded: false, reason: "corrupt-doc" } as const
      if (parsed.error) return { recorded: false, reason: "missing" } as const
      const meta = parsed.meta
      meta.organize_status = "failed"
      meta.organize_error = redactSummary(input.message, 200)
      meta.updated_at = new Date().toISOString()
      const sections: IssueSections = { ...parsed.sections, 事实: renderFactsSection(meta) }
      if (!replaceToolInsightFile(filePath, renderIssueDoc(meta, sections))) {
        return { recorded: false, reason: "io-failed" } as const
      }
      rebuildIndexLocked(paths)
      return { recorded: true } as const
    },
  )
  return outcome.ok ? outcome.value : { recorded: false, reason: "lock-failed" }
}

/** 在 run:<fingerprint> 锁内追加复测运行记录（尾部撕裂先隔离修复，中部损坏停止追加） */
export async function appendRunRecords(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { fingerprint: string; records: readonly unknown[]; timeoutMs?: number },
): Promise<AppendJsonlResult> {
  return appendJsonlUnderLock(file, paths, {
    key: toolInsightLockKey(paths.root, "run", input.fingerprint),
    filePath: toolInsightRunPath(paths, input.fingerprint),
    records: input.records,
    timeoutMs: input.timeoutMs,
  })
}

/** 读取某指纹的全部运行记录（原样透传 novel-store 的容错读取） */
export function readRunRecords(paths: ToolInsightPaths, fingerprint: string) {
  return readToolInsightJsonl(toolInsightRunPath(paths, fingerprint))
}

// ---------- 复测案例文档（cases/<fingerprint>.md） ----------

export interface ToolInsightCaseMeta {
  format: number
  case_id: string
  fingerprint: string
  tool: string
  scenario: string
  /** 精确工具白名单（隔离执行时发车前逐项核对） */
  whitelist: string[]
  model: { providerID?: string; modelID?: string }
  fix_version: string
  created_at: string
}

/** 案例固定段落；「禁止外部副作用」由程序声明，不依赖模型自律 */
export interface ToolInsightCaseSections {
  说明: string
  夹具: string
  验收标准: string
}

export function renderCaseDoc(meta: ToolInsightCaseMeta, sections: ToolInsightCaseSections): string {
  const body = [
    "## 案例说明",
    "",
    sections.说明.trim(),
    "",
    "## 夹具",
    "",
    sections.夹具.trim(),
    "",
    "## 工具白名单",
    "",
    meta.whitelist.length > 0 ? meta.whitelist.map((tool) => `- \`${tool}\``).join("\n") : "未知",
    "",
    "## 验收标准",
    "",
    sections.验收标准.trim(),
    "",
    "## 模型与版本",
    "",
    `- 模型：${meta.model.providerID ?? "未知"} / ${meta.model.modelID ?? "未知"}`,
    `- 修复版本：${meta.fix_version || "未知"}`,
    "",
    "## 禁止外部副作用",
    "",
    "本案例仅在隔离临时项目中执行：不得读写原书、不得挂载原目录、不得调用外部服务或产生任何真实外部副作用。",
    "",
  ].join("\n")
  return `---\n${JSON.stringify(meta, null, 2)}\n---\n\n# 复测案例：${meta.fingerprint}\n\n${body}`
}

export type ParsedCaseDoc = { error: "corrupt" } | { error?: undefined; meta: ToolInsightCaseMeta; body: string }

export function parseCaseDoc(text: string): ParsedCaseDoc {
  if (!text.startsWith("---\n")) return { error: "corrupt" }
  const end = text.indexOf("\n---\n", 4)
  if (end === -1) return { error: "corrupt" }
  let meta: unknown
  try {
    meta = JSON.parse(text.slice(4, end))
  } catch {
    return { error: "corrupt" }
  }
  if (meta === null || typeof meta !== "object") return { error: "corrupt" }
  const record = meta as Record<string, unknown>
  if (typeof record.case_id !== "string" || typeof record.fingerprint !== "string" || !Array.isArray(record.whitelist)) {
    return { error: "corrupt" }
  }
  return { meta: meta as ToolInsightCaseMeta, body: text.slice(end + 5) }
}

/** 案例文档在 document 锁内原子替换，崩溃后保留旧案例 */
export async function writeToolInsightCaseDoc(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { meta: ToolInsightCaseMeta; sections: ToolInsightCaseSections; timeoutMs?: number },
): Promise<{ written: boolean; reason?: "lock-failed" | "io-failed" }> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "document"), timeoutMs: input.timeoutMs },
    async () => replaceToolInsightFile(toolInsightCasePath(paths, input.meta.fingerprint), renderCaseDoc(input.meta, input.sections)),
  )
  if (!outcome.ok) return { written: false, reason: "lock-failed" }
  return outcome.value ? { written: true } : { written: false, reason: "io-failed" }
}
