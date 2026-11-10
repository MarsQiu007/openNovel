/**
 * 复测运行记录层（任务 5.5）：`runs/<fingerprint>.jsonl` 的多次顺序运行、
 * 多次通过判定、崩溃对账与安全清理。
 *
 * 记录追加式（不重写历史行）：每次运行在创建临时目录前先写 started，run 锁
 * 覆盖本次执行、逐项确定性核验与终态追加——活动运行全程持锁，另一进程的启动
 * 对账拿不到锁自然不会误标。启动对账在 run 锁内把无终态的 started 标为
 * interrupted/未验证（追加对账记录引用原 run_id），不自动重跑。
 *
 * 多次通过判定只统计同案例摘要（case_digest）批次的自动执行记录：全部实际
 * 通过才判 passed，结果不一致判 unstable（未稳定解决）；人工留痕（manual）
 * 只展示不计自动通过。安全清理只接受 realpath 位于本任务临时根之下的目录，
 * 拒绝符号链接逃逸与原项目路径。
 */
import { realpathSync, rmSync } from "fs"
import { isAbsolute, relative } from "path"
import type { ToolInsightPaths } from "@opennovel-ai/novel-store"
import { createUlid, isRecord } from "./evidence.js"
import { toolInsightLockKey, type AppendJsonlResult } from "./evidence-store.js"
import { appendRunRecords, appendRunRecordsLocked, readRunRecords } from "./issue-store.js"
import { runExclusive, type LockOutcome } from "./locks.js"
import type { FileDomain } from "../v2/effect/file.js"

/** 运行记录状态：started 之外全部为终态或对账标记 */
export type ToolInsightRunStatus =
  | "started"
  /** 执行完成且逐项确定性核验通过 */
  | "passed"
  /** 执行完成但核验失败（工具轨迹失败或最终本地状态不符） */
  | "failed"
  /** 用户或宿主取消；未执行或未完成 */
  | "cancelled"
  /** 宿主授权校验失败；未执行 */
  | "authorization_invalid"
  /** 发车前预检失败；未创建临时目录 */
  | "preflight_failed"
  /** 崩溃对账标记：引用的 started 记录无终态，结果按未验证处理 */
  | "interrupted"

export type ToolInsightRunVerified = "verified_success" | "verified_failure" | "unverified"

export interface ToolInsightRunRecord {
  run_id: string
  case_digest: string
  model: { providerID?: string; modelID?: string }
  fix_version: string
  status: ToolInsightRunStatus
  verified: ToolInsightRunVerified
  /** interrupted 对账记录指向被标记的 started run_id；其余记录无此字段 */
  target_run_id?: string
  /** 人工结果留痕：只展示，不计自动通过 */
  manual?: boolean
  /** 脱敏后的结果说明（不含正文、完整参数与绝对路径） */
  detail: string
  ts: number
}

const NOT_EXECUTED_STATUSES: readonly ToolInsightRunStatus[] = ["cancelled", "authorization_invalid", "preflight_failed"]

function isRunStatus(value: unknown): value is ToolInsightRunStatus {
  return (
    value === "started" ||
    value === "passed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "authorization_invalid" ||
    value === "preflight_failed" ||
    value === "interrupted"
  )
}

function isRunVerified(value: unknown): value is ToolInsightRunVerified {
  return value === "verified_success" || value === "verified_failure" || value === "unverified"
}

function parseRecord(value: unknown): ToolInsightRunRecord | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.run_id !== "string" || typeof value.case_digest !== "string" || typeof value.fix_version !== "string") return undefined
  if (!isRunStatus(value.status) || !isRunVerified(value.verified)) return undefined
  if (typeof value.detail !== "string" || typeof value.ts !== "number") return undefined
  if (!isRecord(value.model)) return undefined
  if (value.model.providerID !== undefined && typeof value.model.providerID !== "string") return undefined
  if (value.model.modelID !== undefined && typeof value.model.modelID !== "string") return undefined
  if (value.target_run_id !== undefined && typeof value.target_run_id !== "string") return undefined
  if (value.manual !== undefined && typeof value.manual !== "boolean") return undefined
  return {
    run_id: value.run_id,
    case_digest: value.case_digest,
    model: { providerID: value.model.providerID, modelID: value.model.modelID },
    fix_version: value.fix_version,
    status: value.status,
    verified: value.verified,
    target_run_id: value.target_run_id,
    manual: value.manual,
    detail: value.detail,
    ts: value.ts,
  }
}

/** 读取某指纹全部运行记录（坏行跳过） */
export function loadRunRecords(paths: ToolInsightPaths, fingerprint: string): ToolInsightRunRecord[] {
  return readRunRecords(paths, fingerprint)
    .entries.map(parseRecord)
    .filter((record): record is ToolInsightRunRecord => record !== undefined)
}

// ─── 多次通过判定 ───

export type ToolInsightRunVerdict = "none" | "passed" | "failed" | "unstable" | "incomplete"

export interface ToolInsightRunSummary {
  /** 判定只统计同摘要批次 */
  case_digest: string
  autoPassed: number
  autoFailed: number
  /** 取消/授权失效/预检失败等未执行次数 */
  notExecuted: number
  interrupted: number
  manualCount: number
  verdict: ToolInsightRunVerdict
}

/**
 * 多次通过判定：只统计同摘要批次的自动执行记录（manual 不计）。
 * - 有 interrupted（崩溃未恢复）→ incomplete
 * - 无自动执行记录 → none
 * - 全部 passed → passed；全部 failed → failed；两者并存 → unstable（未稳定解决）
 */
export function summarizeRuns(records: readonly ToolInsightRunRecord[], digest: string): ToolInsightRunSummary {
  const batch = records.filter((record) => record.case_digest === digest)
  const markedRunIDs = new Set(batch.filter((record) => record.status === "interrupted").map((record) => record.target_run_id))
  const autoRuns = batch.filter(
    (record) => !record.manual && (record.status === "passed" || record.status === "failed") && !markedRunIDs.has(record.run_id),
  )
  const interrupted = batch.filter((record) => record.status === "interrupted").length
  const autoPassed = autoRuns.filter((record) => record.status === "passed").length
  const autoFailed = autoRuns.length - autoPassed
  const verdict: ToolInsightRunVerdict =
    interrupted > 0
      ? "incomplete"
      : autoRuns.length === 0
        ? "none"
        : autoFailed === 0
          ? "passed"
          : autoPassed === 0
            ? "failed"
            : "unstable"
  return {
    case_digest: digest,
    autoPassed,
    autoFailed,
    notExecuted: batch.filter((record) => NOT_EXECUTED_STATUSES.includes(record.status)).length,
    interrupted,
    manualCount: batch.filter((record) => record.manual).length,
    verdict,
  }
}

// ─── 记录追加 ───

interface RunRecordBase {
  fingerprint: string
  case_digest: string
  model: { providerID?: string; modelID?: string }
  fix_version: string
  timeoutMs?: number
}

/** started 记录：必须在创建临时目录之前、run 锁内落盘（崩溃后对账可标 interrupted） */
export async function appendRunStarted(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: RunRecordBase,
): Promise<{ result: AppendJsonlResult; runID: string }> {
  const record: ToolInsightRunRecord = {
    run_id: `run_${createUlid()}`,
    case_digest: input.case_digest,
    model: input.model,
    fix_version: input.fix_version,
    status: "started",
    verified: "unverified",
    detail: "复测运行开始",
    ts: Date.now(),
  }
  const result = await appendRunRecords(file, paths, { fingerprint: input.fingerprint, records: [record], timeoutMs: input.timeoutMs })
  return { result, runID: record.run_id }
}

/**
 * 运行编排锁内（run 锁覆盖整个运行时）的 started 落盘；调用方必须已持 run 锁。
 * 返回 runID 供终态追加引用。
 */
export function appendRunStartedLocked(paths: ToolInsightPaths, input: RunRecordBase): { result: AppendJsonlResult; runID: string } {
  const record: ToolInsightRunRecord = {
    run_id: `run_${createUlid()}`,
    case_digest: input.case_digest,
    model: input.model,
    fix_version: input.fix_version,
    status: "started",
    verified: "unverified",
    detail: "复测运行开始",
    ts: Date.now(),
  }
  return { result: appendRunRecordsLocked(paths, { fingerprint: input.fingerprint, records: [record] }), runID: record.run_id }
}

/** 终态追加：与 started 同 run_id；未执行状态（取消/授权失效/预检失败）强制未验证。须在 run 锁内调用 */
export function appendRunFinishedLocked(
  paths: ToolInsightPaths,
  input: RunRecordBase & { runID: string; status: ToolInsightRunStatus; verified: ToolInsightRunVerified; detail: string },
): AppendJsonlResult {
  const verified: ToolInsightRunVerified = NOT_EXECUTED_STATUSES.includes(input.status) ? "unverified" : input.verified
  const record: ToolInsightRunRecord = {
    run_id: input.runID,
    case_digest: input.case_digest,
    model: input.model,
    fix_version: input.fix_version,
    status: input.status,
    verified,
    detail: input.detail,
    ts: Date.now(),
  }
  return appendRunRecordsLocked(paths, { fingerprint: input.fingerprint, records: [record] })
}

/** 人工结果留痕：manual 记录只展示，不计自动通过 */
export function appendManualRunResult(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: RunRecordBase & { passed: boolean; detail: string },
) {
  const record: ToolInsightRunRecord = {
    run_id: `run_${createUlid()}`,
    case_digest: input.case_digest,
    model: input.model,
    fix_version: input.fix_version,
    status: input.passed ? "passed" : "failed",
    verified: "unverified",
    manual: true,
    detail: input.detail,
    ts: Date.now(),
  }
  return appendRunRecords(file, paths, { fingerprint: input.fingerprint, records: [record], timeoutMs: input.timeoutMs })
}

// ─── run 锁与崩溃对账 ───

/**
 * 在 run:<fingerprint> 锁内执行整个复测运行（执行、逐项核验、终态追加）。
 * 活动运行全程持锁：并发对账与并发复测同指纹时拿不到锁，不产生交错记录。
 */
export function runUnderRunLock<T>(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { fingerprint: string; timeoutMs?: number },
  work: () => Promise<T>,
): Promise<LockOutcome<T>> {
  return runExclusive(file, { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "run", input.fingerprint), timeoutMs: input.timeoutMs }, work)
}

/**
 * 启动崩溃对账：run 锁内把无终态的 started 标为 interrupted/未验证（追加对账
 * 记录引用原 run_id），不自动重跑。活动运行的进程持有 run 锁，此处拿锁失败
 * 返回 lock-failed，不会误标正在运行的记录。
 */
export async function reconcileRunRecords(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { fingerprint: string; timeoutMs?: number },
): Promise<{ marked: number } | { marked: 0; reason: "lock-failed" }> {
  const outcome = await runExclusive(
    file,
    { dir: paths.locksDir, key: toolInsightLockKey(paths.root, "run", input.fingerprint), timeoutMs: input.timeoutMs },
    async () => {
      const records = loadRunRecords(paths, input.fingerprint)
      const startedIDs = new Set(records.filter((record) => record.status === "started").map((record) => record.run_id))
      for (const record of records) {
        if (record.status === "started") continue
        startedIDs.delete(record.run_id)
        // interrupted 对账标记通过 target_run_id 引用被标记的 started，同样算已处理
        if (record.target_run_id !== undefined) startedIDs.delete(record.target_run_id)
      }
      const orphans = [...startedIDs]
      if (orphans.length === 0) return { marked: 0 } as const
      const now = Date.now()
      const marks: ToolInsightRunRecord[] = orphans.map((runID) => {
        const origin = records.find((record) => record.run_id === runID)
        return {
          run_id: `run_${createUlid(now)}`,
          case_digest: origin?.case_digest ?? "",
          model: origin?.model ?? {},
          fix_version: origin?.fix_version ?? "",
          status: "interrupted" as const,
          verified: "unverified" as const,
          target_run_id: runID,
          detail: "进程未完成运行：启动对账标记为中断，结果未验证，不自动重跑",
          ts: now,
        }
      })
      const appended = appendRunRecordsLocked(paths, { fingerprint: input.fingerprint, records: marks })
      return { marked: appended.appended ? marks.length : 0 } as const
    },
  )
  return outcome.ok ? outcome.value : { marked: 0, reason: "lock-failed" as const }
}

// ─── 安全清理 ───

export type SafeRemoveResult =
  | { removed: true }
  | { removed: false; reason: "is-root" | "outside-root" | "io" }

/**
 * 仅限本任务临时目录的安全清理：只接受 realpath 位于本任务临时根之下的目录。
 * 符号链接逃逸与原项目路径在 realpath 归一化后都落在根之外，一律拒绝。
 *
 * Windows 下 bun:sqlite 连接 close 后文件句柄要等 drizzle statement 对象被 GC 终结
 * 才真正释放（delete-pending 的 novel.db 会一直锁住父目录），因此删除失败时每轮
 * 强制同步 GC 并让出事件循环让终结器回调跑完再重试；约 4s 仍失败按 io 上报
 * （目录只含合成夹具，留残无害，由 warn 提示）。
 */
export async function safeRemoveTempDir(input: { root: string; target: string }): Promise<SafeRemoveResult> {
  let realRoot: string
  try {
    realRoot = realpathSync(input.root)
  } catch {
    return { removed: false, reason: "io" }
  }
  let realTarget: string
  try {
    realTarget = realpathSync(input.target)
  } catch {
    // 目标不存在：仅当声明路径仍在归一化根之下时才视为已清理；其余无法证明归属，拒绝
    const declaredRel = relative(realRoot, input.target)
    if (declaredRel === "" || declaredRel.startsWith("..") || isAbsolute(declaredRel)) return { removed: false, reason: "outside-root" }
    return { removed: true }
  }
  if (realTarget === realRoot) return { removed: false, reason: "is-root" }
  const rel = relative(realRoot, realTarget)
  if (rel.startsWith("..") || isAbsolute(rel)) return { removed: false, reason: "outside-root" }
  // rmSync 不跟随目录内符号链接（删除链接本身），目标已在根下由上方 realpath 校验
  const bun = typeof globalThis === "object" ? Reflect.get(globalThis, "Bun") : undefined
  const bunGC = typeof bun === "object" && bun !== null ? Reflect.get(bun, "gc") : undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      rmSync(input.target, { recursive: true, force: true })
      return { removed: true }
    } catch {
      if (typeof bunGC === "function") bunGC.call(bun, true)
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  return { removed: false, reason: "io" }
}
