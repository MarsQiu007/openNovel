/**
 * 工具改进日志（tool-insight）本地文件底座 — 路径解析与 JSONL 追加/读取辅助。
 *
 * 目录布局由设计固定（<log-root> 由插件侧 resolveToolInsightRoot 解析）：
 *   evidence.jsonl  issues/<fingerprint>.md  index.md
 *   runs/<fingerprint>.jsonl  cases/<fingerprint>.md  recovery/  locks/
 *
 * 落盘纪律同 evaluate-metric.ts：O_APPEND + writeSync + fsyncSync + closeSync，
 * 失败只 warn 不抛——日志读写失败不得阻断写作。读取端区分「尾部不完整」（追加中
 * 断导致最后一行残缺，可修复）与「中部损坏」（跨过它追加会让历史永久不可读，必须
 * 停止追加），修复动作本身由插件在 evidence 锁内调用本模块的隔离与截断辅助完成。
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync, writeSync } from "fs"
import { dirname, join } from "path"

export interface ToolInsightPaths {
  root: string
  /** 客观证据 JSONL（追加写） */
  evidence: string
  issuesDir: string
  index: string
  runsDir: string
  casesDir: string
  /** 尾部隔离保存目录（不作为分享材料） */
  recoveryDir: string
  /** 运行期跨进程锁目录（不作为分享材料） */
  locksDir: string
}

export function toolInsightPaths(logRoot: string): ToolInsightPaths {
  return {
    root: logRoot,
    evidence: join(logRoot, "evidence.jsonl"),
    issuesDir: join(logRoot, "issues"),
    index: join(logRoot, "index.md"),
    runsDir: join(logRoot, "runs"),
    casesDir: join(logRoot, "cases"),
    recoveryDir: join(logRoot, "recovery"),
    locksDir: join(logRoot, "locks"),
  }
}

export function toolInsightIssuePath(paths: ToolInsightPaths, fingerprint: string): string {
  return join(paths.issuesDir, `${fingerprint}.md`)
}

export function toolInsightRunPath(paths: ToolInsightPaths, fingerprint: string): string {
  return join(paths.runsDir, `${fingerprint}.jsonl`)
}

export function toolInsightCasePath(paths: ToolInsightPaths, fingerprint: string): string {
  return join(paths.casesDir, `${fingerprint}.md`)
}

function warnIO(stage: string, path: string, err: unknown) {
  console.warn(`[tool-insight] ${stage} failed for ${path}:`, err)
}

/**
 * 追加多条 JSONL 记录（单次 open/fsync 落盘；records 为空不触碰文件系统）。
 * 调用方负责已脱敏——本模块不做字段过滤。IO 失败只 warn，不改变调用方控制流。
 */
export function appendToolInsightJsonl(filePath: string, records: readonly unknown[]): void {
  if (records.length === 0) return
  try {
    mkdirSync(dirname(filePath), { recursive: true })
  } catch (err) {
    warnIO("append.mkdir", filePath, err)
    return
  }

  const line = records.map((record) => JSON.stringify(record) + "\n").join("")
  let fd: number | null = null
  try {
    fd = openSync(filePath, "a")
    // Buffer 显式传 length：避免部分 fs 实现对 string writeSync 的尾字节丢失
    const buf = Buffer.from(line, "utf-8")
    writeSync(fd, buf, 0, buf.length)
    fsyncSync(fd)
  } catch (err) {
    warnIO("append.write", filePath, err)
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 关闭错忽略
      }
    }
  }
}

export interface ToolInsightJsonlRead {
  /** 逐行 JSON.parse 成功的记录（坏行跳过不进列表） */
  entries: unknown[]
  /** 除末行外的坏行数（中部损坏信号） */
  corruptLines: number
  /** 最后一行存在但解析失败：上次追加中断留下的撕裂尾部，可隔离修复 */
  tailIncomplete: boolean
  fileSize: number
}

/**
 * 容忍坏行的整文件读取。文件不存在视为空日志（合法初始状态）。
 * 区分中部损坏与尾部撕裂：`tailIncomplete` 只在「文件非空且仅最后一行坏」时为真。
 */
export function readToolInsightJsonl(filePath: string): ToolInsightJsonlRead {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch {
    return { entries: [], corruptLines: 0, tailIncomplete: false, fileSize: 0 }
  }
  const lines = raw.split("\n")
  const entries: unknown[] = []
  let corruptLines = 0
  let tailIncomplete = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    const isLast = index === lines.length - 1
    try {
      entries.push(JSON.parse(line))
    } catch {
      // 最后一行坏 = 撕裂尾部（可隔离修复）；非最后一行坏 = 中部损坏（必须停止追加）
      if (isLast) tailIncomplete = true
      else corruptLines++
    }
  }
  let fileSize = 0
  try {
    fileSize = statSync(filePath).size
  } catch {
    // 文件在读取与 stat 之间被删除：按空日志处理
  }
  return { entries, corruptLines, tailIncomplete, fileSize }
}

/**
 * 原子替换写：同目录临时文件 + rename 覆盖，崩溃后保留旧文档。
 * Markdown 问题文档、索引与案例文档的更新都走这里；失败只 warn 并返回 false。
 */
export function replaceToolInsightFile(filePath: string, content: string): boolean {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(tmp, content, "utf-8")
    // 同目录 rename：Windows 上也可覆盖已存在的目标文件
    renameSync(tmp, filePath)
    return true
  } catch (err) {
    warnIO("replace", filePath, err)
    try {
      unlinkSync(tmp)
    } catch {
      // 临时文件清理失败忽略
    }
    return false
  }
}

/**
 * 把撕裂尾部字节复制到 recovery 目录后，将文件截断到最后一个完整换行。
 * 只应在 evidence 锁内、`tailIncomplete === true` 时调用；恢复成功返回 true。
 * 中部损坏（corruptLines > 0）不是本函数的职责，调用方必须停止追加而不是截断。
 */
export function repairToolInsightTail(paths: ToolInsightPaths, filePath: string): boolean {
  let raw: Buffer
  try {
    raw = readFileSync(filePath)
  } catch (err) {
    warnIO("repair.read", filePath, err)
    return false
  }
  const lastNewline = raw.lastIndexOf(0x0a)
  const torn = lastNewline === -1 ? raw : raw.subarray(lastNewline + 1)
  if (torn.length === 0) return true
  try {
    mkdirSync(paths.recoveryDir, { recursive: true })
    // 毫秒时间戳 + 文件名：多次撕裂互不覆盖
    const name = `${Date.now()}-${filePath.split(/[\\/]/).pop() ?? "evidence"}.torn`
    writeFileSync(join(paths.recoveryDir, name), torn)
  } catch (err) {
    warnIO("repair.isolate", paths.recoveryDir, err)
    return false
  }
  try {
    truncateSync(filePath, lastNewline === -1 ? 0 : lastNewline + 1)
    return true
  } catch (err) {
    warnIO("repair.truncate", filePath, err)
    return false
  }
}
