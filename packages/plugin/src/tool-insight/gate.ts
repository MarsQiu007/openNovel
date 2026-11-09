/**
 * 工具洞察运行时开关门：读全局三文件配置并解析日志根。
 *
 * 采集器与 tool_insight 工具共用同一条解析路径，保证两侧写同一个日志根：
 * 根目录的项目隔离哈希恒以项目目录为输入（跨重启稳定、两侧无需共享 created
 * 观察值）；证据条目内的 projectID 字段才使用真实观察值。
 * 文件缺失跳过；语法错误按未启用处理并给出非阻断警告（绝不使用过期快照）。
 */
import { readFileSync } from "fs"
import { join } from "path"
import { toolInsightPaths, type ToolInsightPaths } from "@opennovel-ai/novel-store"
import { resolveToolInsightRoot, resolveToolInsightSetting, type ToolInsightConfigFile } from "./settings.js"

export const TOOL_INSIGHT_CONFIG_FILES = ["config.json", "opennovel.json", "opennovel.jsonc"] as const

export function readToolInsightConfigFiles(configDir: string): ToolInsightConfigFile[] {
  return TOOL_INSIGHT_CONFIG_FILES.map((name) => {
    try {
      return { name, text: readFileSync(join(configDir, name), "utf-8") }
    } catch {
      return { name, text: undefined }
    }
  })
}

export interface ToolInsightGate {
  paths: ToolInsightPaths
  /** 真实项目标识（created 观察值）；未见 created 时为项目目录 */
  projectID: string
}

export function openToolInsightGate(input: {
  configDir: string
  projectDirectory: string
  projectID?: string
  /** 语法错误等非阻断警告的去重集合；不传则每次打印 */
  warnOnce?: (message: string) => void
}): ToolInsightGate | undefined {
  const { setting, warning } = resolveToolInsightSetting(readToolInsightConfigFiles(input.configDir))
  if (warning !== undefined) input.warnOnce?.(warning)
  if (!setting.enabled) return undefined
  const projectID = input.projectID ?? input.projectDirectory
  const paths = toolInsightPaths(resolveToolInsightRoot(setting, { projectDirectory: input.projectDirectory, projectID: input.projectDirectory }))
  return { paths, projectID }
}
