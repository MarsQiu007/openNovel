/**
 * 证据/运行 JSONL 的锁内写入序列 — 「尾部检查 — 损坏尾部隔离 — 截断 — 追加」。
 *
 * evidence 锁覆盖整个序列，避免两个进程同时修复或追加同一文件；runs 复用同一纪律，
 * 但持有独立的 run:<fingerprint> 锁。evidence 追加不与整理（organize）、文档（document）
 * 或复测（run）共用一把锁，不会被模型请求阻塞。锁文件放在日志根的 locks/ 目录
 * （跨进程真实 Flock），键按日志根哈希派生。中部损坏时保持原文件并停止追加——
 * 跨过坏行写入会让历史永久不可读。
 */
import {
  appendToolInsightJsonl,
  readToolInsightJsonl,
  repairToolInsightTail,
  type ToolInsightPaths,
} from "@opennovel-ai/novel-store"
import { createHash } from "node:crypto"
import { runExclusive } from "./locks.js"
import type { FileDomain } from "../v2/effect/file.js"

/** 锁键：tool-insight:<日志根哈希>:<用途>[:<作用域>]，跨日志根互不干扰 */
export function toolInsightLockKey(logRoot: string, purpose: string, scope?: string): string {
  const root = createHash("sha256").update(logRoot).digest("hex").slice(0, 12)
  return ["tool-insight", root, purpose, scope].filter(Boolean).join(":")
}

export type AppendJsonlResult =
  | { appended: true }
  | { appended: false; reason: "duplicate" }
  | { appended: false; reason: "corrupt-middle"; corruptLines: number }
  | { appended: false; reason: "repair-failed" }
  | { appended: false; reason: "lock-failed" }

/** 兼容别名：证据追加与运行记录追加共用同一结果形状 */
export type AppendEvidenceResult = AppendJsonlResult

/** 记录稳定去重键的窄读取：JSONL 层不认识各业务记录形状 */
function recordDedupeKey(record: unknown, key: string): string | undefined {
  if (typeof record !== "object" || record === null) return undefined
  const value = Reflect.get(record, key)
  return typeof value === "string" && value !== "" ? `${key}:${value}` : undefined
}

/**
 * 锁内追加序列本体：调用方必须已持有该文件的对应锁。提供稳定 ID 时先做存储层
 * 去重；相同 ID 不修复尾部也不重写既有行，等待下一次无重复追加自然恢复。
 */
export function appendJsonlLocked(
  paths: ToolInsightPaths,
  input: { filePath: string; records: readonly unknown[]; dedupe?: boolean; dedupeKeys?: readonly string[] },
): AppendJsonlResult {
  const state = readToolInsightJsonl(input.filePath)
  if (state.corruptLines > 0) return { appended: false, reason: "corrupt-middle", corruptLines: state.corruptLines }
  if (input.dedupe === true) {
    const dedupeKeys = input.dedupeKeys ?? ["id"]
    const incomingKeys = input.records
      .flatMap((record) => dedupeKeys.map((key) => recordDedupeKey(record, key)))
      .filter((key): key is string => key !== undefined)
    const existingKeys = new Set(
      state.entries
        .flatMap((record) => dedupeKeys.map((key) => recordDedupeKey(record, key)))
        .filter((key): key is string => key !== undefined),
    )
    if (incomingKeys.some((key) => existingKeys.has(key))) return { appended: false, reason: "duplicate" }
  }
  if (state.tailIncomplete && !repairToolInsightTail(paths, input.filePath)) {
    return { appended: false, reason: "repair-failed" }
  }
  appendToolInsightJsonl(input.filePath, input.records)
  return { appended: true }
}

/**
 * 在指定锁内对单个 JSONL 文件执行「尾部检查—隔离—截断—追加」。锁不可用（超时/
 * 损坏）时不写且不绕过；中部损坏不写；撕裂尾部先隔离再截断后追加。追加本身的
 * IO 失败由 novel-store 降级为警告，不改变本次返回值（文件层责任在 novel-store）。
 */
export async function appendJsonlUnderLock(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  input: { key: string; filePath: string; records: readonly unknown[]; dedupe?: boolean; dedupeKeys?: readonly string[]; timeoutMs?: number },
): Promise<AppendJsonlResult> {
  const outcome = await runExclusive(file, { dir: paths.locksDir, key: input.key, timeoutMs: input.timeoutMs }, async () =>
    appendJsonlLocked(paths, input),
  )
  return outcome.ok ? outcome.value : { appended: false, reason: "lock-failed" }
}

/** 在 evidence 锁内追加已脱敏证据记录；传入 dedupe 后按稳定 ID 跳过重复 */
export async function appendEvidenceUnderLock(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  records: readonly unknown[],
  options?: { dedupe?: boolean; timeoutMs?: number },
): Promise<AppendEvidenceResult> {
  return appendJsonlUnderLock(file, paths, {
    key: toolInsightLockKey(paths.root, "evidence"),
    filePath: paths.evidence,
    records,
    dedupe: options?.dedupe,
    timeoutMs: options?.timeoutMs,
  })
}

/** 在 signals 锁内追加负反馈信号；相同信号 ID 或同一提示发生实例都直接跳过 */
export async function appendSignalUnderLock(
  file: Pick<FileDomain, "withLock">,
  paths: ToolInsightPaths,
  records: readonly unknown[],
  options?: { timeoutMs?: number },
): Promise<AppendEvidenceResult> {
  return appendJsonlUnderLock(file, paths, {
    key: toolInsightLockKey(paths.root, "signals"),
    filePath: paths.signals,
    records,
    dedupe: true,
    dedupeKeys: ["id", "occurrenceID"],
    timeoutMs: options?.timeoutMs,
  })
}
