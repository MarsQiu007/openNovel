/**
 * 无工具后台归因整理队列（任务 4.1）与启动崩溃恢复（任务 4.2）。
 *
 * 队列纪律：同指纹合并（保序 Map，先到的 parentID 优先），串行泵逐个发车；
 * 运行中同指纹的新证据在完成后由泵再派生一次整理。每次发车前重新过开关门：
 * 开关关闭或目录变化后旧队列静默丢弃，不隐式换目录发车。
 *
 * 归因会话经宿主 startBackground（organize 模式）发车，不带任何工具：模型只
 * 返回结构化 JSON 文本，由本模块普通代码校验并经 organizeUnderLock 写回指定
 * 段落。prompt 只携带问题文档全文、本批脱敏证据（剥离片段本体与授权）与已
 * 授权正文片段（grants 按 organize 用途与指纹匹配，无授权即不出现）。无已配
 * 置模型或模型不可用时宿主在 create 前失败关闭，pending 保留并落失败状态，
 * 不隐式改用其他模型；取消静默保留 pending。
 *
 * 启动对账（recoverOnce，每实例至多一次）：证据锁内修复撕裂尾部后取快照，
 * 中部损坏停止一切等待人工处理；凡证据 ID 不在任何问题文档 pending∪organized
 * 并集内的，按证据的归属键重新确定性摄取（孤儿）或补回 pending（引用但状态
 * 不一致），随后重建索引并把仍有 pending 的指纹入队（无父会话，走显式目录的
 * 顶层归因会话）。写入全部走既有锁与幂等入口，多进程并发对账安全。
 */
import { readFileSync, readdirSync } from "fs"
import {
  readToolInsightJsonl,
  repairToolInsightTail,
  toolInsightIssuePath,
  type ToolInsightPaths,
} from "@opennovel-ai/novel-store"
import {
  modelVisibleContent,
  type ToolInsightContentException,
  type ToolInsightContentGrant,
  type ToolInsightEvidence,
} from "./evidence.js"
import { toolInsightLockKey } from "./evidence-store.js"
import { openToolInsightGate } from "./gate.js"
import { parseIssueDoc, type ToolInsightFingerprintInput } from "./issue-doc.js"
import {
  ingestEvidenceIssue,
  listPendingFingerprints,
  organizeUnderLock,
  readIssueMeta,
  recordOrganizeFailure,
  requeueEvidence,
  rebuildIssueIndex,
} from "./issue-store.js"
import { runExclusive } from "./locks.js"
import type { PluginContext } from "../v2/effect/context.js"
import type { SessionDomain } from "../v2/effect/session.js"

const ORGANIZE_AGENT = "insight-organizer"

const OUTPUT_HINT = `只输出一个 JSON 对象（不要代码围栏，不要其他文本）：
{"hypotheses": "原因假设（简体中文，1-3 条，标注推测性质）", "suggestions": "改进建议", "acceptance": "验收标准"}`

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isEvidenceRecord = (entry: unknown): entry is ToolInsightEvidence => {
  if (typeof entry !== "object" || entry === null) return false
  const shape = entry as Record<string, unknown>
  return typeof shape.id === "string" && typeof shape.fields === "object" && shape.fields !== null
}

/** 证据行进入模型 prompt 前剥离片段本体与授权：未授权片段对模型不可见 */
const evidenceForPrompt = (record: ToolInsightEvidence) => {
  const fields = { ...record.fields }
  delete fields.text
  delete fields.grants
  return { ...record, fields }
}

/** 从 content_exception 证据重建片段形状（grants 随证据持久化，重启后仍可核验） */
const exceptionFromEvidence = (record: ToolInsightEvidence): ToolInsightContentException | undefined => {
  const fields = record.fields
  if (typeof fields.text !== "string" || !Array.isArray(fields.grants)) return undefined
  return {
    kind: "content_exception",
    id: typeof fields.exceptionID === "string" ? fields.exceptionID : record.id,
    ts: record.ts,
    length: typeof fields.length === "number" ? fields.length : fields.text.length,
    retainedAt: typeof fields.retainedAt === "number" ? fields.retainedAt : record.ts,
    shareWarning: true,
    grants: fields.grants as ToolInsightContentGrant[],
    text: fields.text,
  }
}

/** 孤儿摄取的建档事实：按证据的 issue 三元组重建；旧格式证据无归属键返回 undefined */
const issueFactsOf = (record: ToolInsightEvidence): ToolInsightFingerprintInput | undefined => {
  const issue = record.fields.issue
  if (typeof issue !== "object" || issue === null) return undefined
  const shape = issue as Record<string, unknown>
  if (typeof shape.tool !== "string" || typeof shape.scenario !== "string" || typeof shape.errorCategory !== "string") {
    return undefined
  }
  return { tool: shape.tool, scenario: shape.scenario, errorCategory: shape.errorCategory }
}

/** organize 锁内构造归因 prompt：问题文档全文 + 本批证据 JSONL + 授权片段 + 输出格式 */
const buildOrganizePrompt = (paths: ToolInsightPaths, fingerprint: string, pendingIDs: readonly string[]): string => {
  let skeleton: string
  try {
    skeleton = readFileSync(toolInsightIssuePath(paths, fingerprint), "utf-8")
  } catch {
    skeleton = `（问题文档读取失败：${fingerprint}）`
  }
  const pending = new Set(pendingIDs)
  const batch = readToolInsightJsonl(paths.evidence).entries.filter(isEvidenceRecord).filter((record) => pending.has(record.id))
  const evidenceLines = batch.map((record) => JSON.stringify(evidenceForPrompt(record)))
  const authorized = batch
    .filter((record) => record.kind === "content_exception")
    .flatMap((record) => {
      const exception = exceptionFromEvidence(record)
      const text =
        exception === undefined
          ? undefined
          : modelVisibleContent(exception, { purpose: "organize", subjectDigest: fingerprint })
      return text === undefined ? [] : [`- [${record.id}] ${text}`]
    })
  const parts = [
    "# 问题骨架",
    "",
    skeleton,
    "",
    "# 本批脱敏证据（JSONL，每行一条）",
    "",
    evidenceLines.length > 0 ? evidenceLines.join("\n") : "（本批无证据行）",
  ]
  if (authorized.length > 0) {
    parts.push("", "# 已授权正文片段（用户显式授权用于归因）", "", ...authorized)
  }
  parts.push("", "# 输出格式", "", OUTPUT_HINT)
  return parts.join("\n")
}

/** 模型输出校验：三段均为非空字符串才算有效；容忍一层代码围栏 */
const parseOrganizerOutput = (text: string): { hypotheses: string; suggestions: string; acceptance: string } | undefined => {
  const stripped = text.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const shape = parsed as Record<string, unknown>
  const read = (key: string) => {
    const value = shape[key]
    return typeof value === "string" && value.trim().length > 0 ? value : undefined
  }
  const hypotheses = read("hypotheses")
  const suggestions = read("suggestions")
  const acceptance = read("acceptance")
  if (hypotheses === undefined || suggestions === undefined || acceptance === undefined) return undefined
  return { hypotheses, suggestions, acceptance }
}

/** 整理发车/产出的业务失败信号：cancelled 静默保留 pending，failure 落失败状态 */
class OrganizeSignal extends Error {
  constructor(
    readonly kind: "cancelled" | "failure",
    reason: string,
  ) {
    super(reason)
  }
}

export interface ToolInsightOrganizer {
  /** 证据落盘后的整理信号：同指纹合并，串行发车；sessionID 作为父会话等其落定 */
  enqueue: (fingerprint: string, sessionID?: string) => void
  /** 启动对账：每实例至多一次；未启用/中部损坏/锁不可用时跳过 */
  recoverOnce: () => Promise<void>
}

export function createToolInsightOrganizer(input: {
  ctx: PluginContext
  /** 本插件实例的 Location 目录：开关门与目录变化判定（与 collector 一致） */
  projectDirectory: string
  session: Pick<SessionDomain, "startBackground">
}): ToolInsightOrganizer {
  const { ctx, projectDirectory, session } = input

  const openGate = () =>
    openToolInsightGate({
      configDir: ctx.paths.config,
      projectDirectory,
      projectID: projectDirectory,
      warnOnce: (message) => console.warn(`[tool-insight] ${message}`),
    })

  const queue = new Map<string, string | undefined>()
  const running = new Set<string>()
  let pumping = false

  const pump = () => {
    if (pumping) return
    const next = [...queue.entries()].find(([fingerprint]) => !running.has(fingerprint))
    if (next === undefined) return
    const [fingerprint, parentID] = next
    queue.delete(fingerprint)
    running.add(fingerprint)
    pumping = true
    void runOrganize(fingerprint, parentID)
      .catch((error) => console.warn(`[tool-insight] 整理队列异常（${fingerprint}）:`, error))
      .finally(() => {
        running.delete(fingerprint)
        pumping = false
        pump()
      })
  }

  const enqueue = (fingerprint: string, sessionID?: string) => {
    if (running.has(fingerprint) && queue.has(fingerprint)) return
    if (!queue.has(fingerprint)) queue.set(fingerprint, sessionID)
    pump()
  }

  const runOrganize = async (fingerprint: string, parentID: string | undefined) => {
    // 发车前重新过开关门：未启用或目录变化后静默丢弃
    const opened = openGate()
    if (opened === undefined) return
    const paths = opened.paths
    const meta = readIssueMeta(paths, fingerprint)
    if (meta.error !== undefined || meta.meta.pending_evidence_ids.length === 0) return
    try {
      const outcome = await organizeUnderLock(ctx.file, paths, { fingerprint }, async (pendingIDs) => {
        const prompt = buildOrganizePrompt(paths, fingerprint, pendingIDs)
        const handle = await session.startBackground({
          mode: "organize",
          agent: ORGANIZE_AGENT,
          prompt,
          expectedTools: [],
          ...(parentID === undefined ? { directory: projectDirectory } : { parentID }),
        })
        const done = await handle.done
        if (done.status === "cancelled") throw new OrganizeSignal("cancelled", "后台归因会话被取消")
        if (done.status !== "success") throw new OrganizeSignal("failure", done.reason)
        const sections = parseOrganizerOutput(done.text)
        if (sections === undefined) {
          throw new OrganizeSignal("failure", `归因输出不是有效的三段 JSON（输出长度 ${done.text.length}）`)
        }
        return sections
      })
      if (!outcome.applied && outcome.reason !== "nothing-pending") {
        await recordOrganizeFailure(ctx.file, paths, { fingerprint, message: `整理落盘未完成（${outcome.reason}）` })
      }
    } catch (error) {
      if (error instanceof OrganizeSignal) {
        if (error.kind === "failure") {
          await recordOrganizeFailure(ctx.file, paths, { fingerprint, message: error.message })
        }
        return
      }
      // startBackground 自身 reject：宿主 create 前失败关闭（无模型/模型不可用/agent 缺失等）
      await recordOrganizeFailure(ctx.file, paths, { fingerprint, message: describeError(error) })
    }
  }

  let recovered = false
  const recoverOnce = async () => {
    if (recovered) return
    recovered = true
    // 对账非阻断：任何意外异常只告警，绝不中断插件装载
    try {
      await reconcile()
    } catch (error) {
      console.warn("[tool-insight] 启动对账异常跳过:", error)
    }
  }

  const reconcile = async () => {
    const opened = openGate()
    if (opened === undefined) return
    const paths = opened.paths
    const file = ctx.file

    // 证据锁内：修复撕裂尾部并取干净快照；中部损坏停止一切，等待人工处理
    const snapshot = await runExclusive(
      file,
      { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "evidence") },
      async () => {
        const first = readToolInsightJsonl(paths.evidence)
        if (first.tailIncomplete) repairToolInsightTail(paths, paths.evidence)
        return readToolInsightJsonl(paths.evidence)
      },
    )
    if (!snapshot.ok) {
      console.warn("[tool-insight] 启动对账跳过：证据锁不可用")
      return
    }
    if (snapshot.value.corruptLines > 0) {
      console.warn(`[tool-insight] 启动对账跳过：证据文件中部损坏 ${snapshot.value.corruptLines} 行，等待人工处理`)
      return
    }
    const records = snapshot.value.entries.filter(isEvidenceRecord)

    // 引用集合：全部问题文档的 evidence_ids（pending 与 organized 都是子集）
    let docFiles: string[] = []
    try {
      docFiles = readdirSync(paths.issuesDir).filter((name) => name.endsWith(".md"))
    } catch {
      docFiles = []
    }
    const referenced = new Set<string>()
    for (const name of docFiles) {
      let text: string
      try {
        text = readFileSync(`${paths.issuesDir}/${name}`, "utf-8")
      } catch {
        continue
      }
      const parsed = parseIssueDoc(text)
      if (parsed.error) {
        console.warn(`[tool-insight] 启动对账跳过无法解析的问题文档 ${name}`)
        continue
      }
      for (const id of parsed.meta.evidence_ids) referenced.add(id)
    }

    // 孤儿证据：未被任何文档引用且带归属键 → 重新确定性摄取；无归属键只告警
    let reingested = 0
    let unattributed = 0
    for (const record of records) {
      if (referenced.has(record.id)) continue
      const fingerprint = record.fields.fingerprint
      const facts = issueFactsOf(record)
      if (typeof fingerprint !== "string" || facts === undefined) {
        unattributed++
        continue
      }
      const ingested = await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: record.id,
        occurrenceID: record.occurrenceID ?? record.id,
        evidenceKind: record.kind,
        occurredAt: record.ts,
        facts,
      })
      if (ingested.documented) reingested++
    }

    // 引用但不在 pending∪organized（崩溃残留的状态不一致）→ 补回 pending（幂等）
    let requeued = 0
    for (const record of records) {
      if (!referenced.has(record.id)) continue
      const fingerprint = record.fields.fingerprint
      if (typeof fingerprint !== "string") continue
      const result = await requeueEvidence(file, paths, { fingerprint, evidenceID: record.id })
      if (result.queued) requeued++
    }

    await rebuildIssueIndex(file, paths)

    // 仍有 pending 的指纹全部入队：无父会话，走显式目录的顶层归因会话
    for (const fingerprint of listPendingFingerprints(paths)) enqueue(fingerprint)
    if (reingested > 0 || requeued > 0 || unattributed > 0) {
      console.warn(
        `[tool-insight] 启动对账完成：孤儿摄取 ${reingested} 条，补回 pending ${requeued} 条，无归属键跳过 ${unattributed} 条`,
      )
    }
  }

  return { enqueue, recoverOnce }
}
