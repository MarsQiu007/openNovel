/**
 * 工具改进日志（toolInsight）全局设置的窄运行时解析器。
 *
 * Config.Service 与插件 options 都是装载时快照，而 toolInsight 要求「处理事件及后台
 * 下一步前读取当前值」，因此本模块提供纯函数：调用方按
 * `config.json → opennovel.json → opennovel.jsonc` 由低到高的顺序传入文件文本，
 * 只提取顶层 `toolInsight` 的 `enabled` 与 `directory` 两个字段。
 *
 * 失败关闭（fail-closed）：任一相关文件存在语法错误，或该字段类型非法，本次一律按
 * 未启用处理并给出非阻断警告，绝不使用过期快照兜底。`OPENNOVEL_CONFIG*` 与远程配置
 * 不会进入本解析器的输入，因此天然不提供该字段的覆盖。
 *
 * 本文件同时被插件运行时与 `packages/opennovel` 全局配置处理器复用，插件包不导入
 * 宿主包；路径解析与项目隔离哈希也在这里，保证两侧不会复制出两套优先级逻辑。
 */

import { createHash } from "node:crypto"
import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"

export interface ToolInsightSetting {
  enabled: boolean
  /** 缺省或空串表示使用项目内默认目录 */
  directory?: string
}

/** 调用方按合并优先级从低到高排列传入 */
export interface ToolInsightConfigFile {
  name: string
  /** 文件缺失时传 undefined，跳过该文件 */
  text: string | undefined
}

export interface ToolInsightResolution {
  setting: ToolInsightSetting
  /** 非阻断警告：文件语法错误或字段非法时给出原因，此时 setting 恒为未启用 */
  warning?: string
}

/** 项目内默认日志子目录，挂在既有自评价目录之下 */
export const TOOL_INSIGHT_DEFAULT_SUBPATH = path.join(".novel", "evaluate", "tool-insight")

/**
 * 解析全局三文件中的有效 toolInsight 设置。从未配置时有效值为 `{ enabled: false }`。
 * 键序、格式化与其他顶层键（含 plugin/plugins 数组、环境与远程来源）不影响结果。
 */
export function resolveToolInsightSetting(files: ToolInsightConfigFile[]): ToolInsightResolution {
  const warnings: string[] = []
  let setting: ToolInsightSetting = { enabled: false }
  let declared = false

  for (const file of files) {
    if (file.text === undefined || file.text.trim() === "") continue
    const problems: ParseError[] = []
    // 与宿主 ConfigParse.jsonc 一致：允许尾逗号，避免宿主可接受的文件被窄解析器误判语法错误
    const parsed = parse(file.text, problems, { allowTrailingComma: true }) as unknown
    if (problems.length > 0 || parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push(`${file.name} 无法解析为配置对象，toolInsight 本次按未启用处理`)
      declared = false
      break
    }
    const record = parsed as Record<string, unknown>
    if (!("toolInsight" in record)) continue
    const raw = record.toolInsight
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      warnings.push(`${file.name} 的 toolInsight 字段必须是对象，本次按未启用处理`)
      declared = false
      break
    }
    const fields = raw as Record<string, unknown>
    if (typeof fields.enabled !== "boolean") {
      warnings.push(`${file.name} 的 toolInsight.enabled 必须是布尔值，本次按未启用处理`)
      declared = false
      break
    }
    const rawDirectory = fields.directory
    if (rawDirectory !== undefined && typeof rawDirectory !== "string") {
      warnings.push(`${file.name} 的 toolInsight.directory 必须是字符串，本次按未启用处理`)
      declared = false
      break
    }
    // 高优先级文件的完整声明整体覆盖低优先级文件，不做字段级合并
    setting = { enabled: fields.enabled, directory: normalizeDirectory(rawDirectory) }
    declared = true
  }

  if (!declared) {
    return warnings.length > 0 ? { setting: { enabled: false }, warning: warnings.join("；") } : { setting }
  }
  return { setting }
}

function normalizeDirectory(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === "" || trimmed === undefined ? undefined : trimmed
}

export interface ToolInsightRootOptions {
  projectDirectory: string
  projectID: string
}

/**
 * 解析日志根目录：目录缺省或为空时使用项目内默认子目录；配置共享根目录时按
 * 项目稳定标识的不可逆短哈希隔离，不使用书名或完整路径。
 */
export function resolveToolInsightRoot(setting: ToolInsightSetting, options: ToolInsightRootOptions): string {
  const directory = setting.directory?.trim()
  if (!directory) {
    return path.join(options.projectDirectory, TOOL_INSIGHT_DEFAULT_SUBPATH)
  }
  return path.join(directory, toolInsightProjectSlug(options.projectID))
}

/** 项目稳定标识的短哈希：同一项目跨重启稳定，不同项目互不相同且不可逆推出原标识 */
export function toolInsightProjectSlug(projectID: string): string {
  return createHash("sha256").update(projectID).digest("hex").slice(0, 12)
}
