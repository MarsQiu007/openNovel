/**
 * 项目级写作模式 / 初始化模式读写 — 跨包共享
 *
 * 持久化到项目根 `.novel/config.json`，与 `name` / `created_at` / `version` 同源。
 * 设计目标：plugin system.transform 注入（每次会话轮次都读）、server handler getMode/setMode、
 * CLI initNovelProject 写入默认值，三处共用一份 read/write 实现。
 *
 * 错误策略：
 * - 读取时若文件不存在 / 解析失败 / 字段缺失 / IO 错误，全部降级为默认值，不抛错
 * - 写入时先备份 .bak（备份失败打 stderr 但不阻塞）；写文件用 openSync + writeSync + fsyncSync + closeSync
 *   强制刷盘（虽然非事务原子，但断电时不会留下半截 JSON）
 * - 读取时剥 BOM 头（Windows PowerShell / VSCode "Save with BOM" 可能写入）
 */
import { existsSync, readFileSync, openSync, writeSync, fsyncSync, closeSync, copyFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { WritingMode as WritingModeSchema, SetupMode as SetupModeSchema } from "@opennovel-ai/schema/novel-mode"

// ─── 类型 ───

/** 写作模式：auto = 全自动写完直接推进；review = 每章写完置 pending_review 等审批 */
export type WritingMode = "auto" | "review"

/** 初始化模式：interactive = 先与用户讨论并呈现方案，确认后才落库；auto = 直接落库 */
export type SetupMode = "interactive" | "auto"

/** 完整模式配置 */
export interface NovelModeConfig {
  writing_mode: WritingMode
  setup_mode: SetupMode
}

// ─── 常量 ───

/**
 * 字面量集合从 schema 包导出 — 单一来源
 * 未来加 "hybrid" 等新值时改 schema 即可，store 与 handler 自动跟随
 */
const WRITING_MODES: readonly WritingMode[] = WritingModeSchema.literals as readonly WritingMode[]
const SETUP_MODES: readonly SetupMode[] = SetupModeSchema.literals as readonly SetupMode[]

/** 默认值：用户拍板 — writing 默认 auto（说"审核"时才审），setup 默认 interactive（初始化必确认） */
export const DEFAULT_NOVEL_MODE_CONFIG: NovelModeConfig = {
  writing_mode: "auto",
  setup_mode: "interactive",
}

/** 配置文件相对项目根的路径（与 .novel/novel.db 平级） */
const NOVEL_CONFIG_FILE = join(".novel", "config.json")

// ─── 路径解析 ───

/** 解析项目级 config.json 绝对路径 */
export function getNovelConfigPath(projectDir: string): string {
  return join(projectDir, NOVEL_CONFIG_FILE)
}

// ─── 校验 ───

function isWritingMode(v: unknown): v is WritingMode {
  return typeof v === "string" && (WRITING_MODES as readonly string[]).includes(v)
}

function isSetupMode(v: unknown): v is SetupMode {
  return typeof v === "string" && (SETUP_MODES as readonly string[]).includes(v)
}

// ─── 读取（永不抛错） ───

/**
 * 读取项目模式配置。文件不存在 / 解析失败 / 字段缺失 / IO 错误时返回默认值。
 * @param projectDir 项目根目录（绝对路径或可解析的相对路径）
 */
export function readNovelConfig(projectDir: string): NovelModeConfig {
  const path = getNovelConfigPath(projectDir)
  if (!existsSync(path)) {
    return { ...DEFAULT_NOVEL_MODE_CONFIG }
  }

  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch (err) {
    // IO 错（EACCES/EIO 等）— 降级默认并告警，不抛错
    warnIO("readNovelConfig.readFile", path, err)
    return { ...DEFAULT_NOVEL_MODE_CONFIG }
  }

  // 剥 BOM 头（Windows PowerShell / VSCode Save with BOM）
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_NOVEL_MODE_CONFIG }
  }

  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_NOVEL_MODE_CONFIG }
  }

  const obj = parsed as Record<string, unknown>
  return {
    writing_mode: isWritingMode(obj.writing_mode) ? obj.writing_mode : DEFAULT_NOVEL_MODE_CONFIG.writing_mode,
    setup_mode: isSetupMode(obj.setup_mode) ? obj.setup_mode : DEFAULT_NOVEL_MODE_CONFIG.setup_mode,
  }
}

// ─── 写入（带 .bak 备份 + fsync） ───

/**
 * 写入项目模式配置。先备份当前文件为 .bak（若存在），再原子覆盖（openSync + writeSync + fsyncSync + closeSync）。
 * 任何 IO 错都降级为 warn + 返回 fallback 配置（写入失败时返回 fallback，不抛错）。
 * @returns 写入后生效的完整配置
 */
export function writeNovelConfig(
  projectDir: string,
  patch: Partial<NovelModeConfig>,
): NovelModeConfig {
  const current = readNovelConfig(projectDir)
  const next: NovelModeConfig = {
    writing_mode: isWritingMode(patch.writing_mode) ? patch.writing_mode : current.writing_mode,
    setup_mode: isSetupMode(patch.setup_mode) ? patch.setup_mode : current.setup_mode,
  }

  // 升级兼容：旧配置文件含非法值时静默降级为默认值（保留用户原意可能性低，但已在读路径处理过）
  // 这里再降级一次以防读路径已修复后 patch 仍带非法值
  if (patch.writing_mode !== undefined && !isWritingMode(patch.writing_mode)) {
    warnDowngrade("writing_mode", patch.writing_mode, current.writing_mode)
  }
  if (patch.setup_mode !== undefined && !isSetupMode(patch.setup_mode)) {
    warnDowngrade("setup_mode", patch.setup_mode, current.setup_mode)
  }

  const path = getNovelConfigPath(projectDir)
  if (existsSync(path)) {
    try {
      copyFileSync(path, `${path}.bak`)
    } catch (err) {
      // 备份失败不阻塞写入但要告警——用户失去回滚窗口
      warnIO("writeNovelConfig.backup", `${path}.bak`, err)
    }
  }

  // 写前确保目录存在
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch (err) {
    warnIO("writeNovelConfig.mkdir", dirname(path), err)
    return next
  }

  // openSync + writeSync + fsyncSync + closeSync 强制刷盘
  // 避免 writeFileSync 写入后 OS 缓存未刷盘 → 断电截断 JSON → 静默丢失 HITL 模式
  const payload = JSON.stringify(next, null, 2) + "\n"
  let fd: number | null = null
  try {
    fd = openSync(path, "w")
    writeSync(fd, payload, 0, "utf-8")
    fsyncSync(fd)
  } catch (err) {
    warnIO("writeNovelConfig.write", path, err)
    return next
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 关闭错忽略
      }
    }
  }
  return next
}

// ─── 工具 ───

function warnIO(op: string, path: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  // 用 console.warn 写入 stderr — 不会让 LLM 看到但能进入用户日志
  console.warn(`[novel-mode] ${op} failed for ${path}: ${msg}`)
}

/** 非法值降级告警 — 让用户知道 .novel/config.json 字段被自动修正 */
function warnDowngrade(field: string, received: unknown, fallback: string): void {
  console.warn(
    `[novel-mode] ${field} 收到非法值 ${JSON.stringify(received)}，已回退为默认值 ${fallback}。` +
      `请检查 .novel/config.json 是否被外部工具破坏。`,
  )
}
