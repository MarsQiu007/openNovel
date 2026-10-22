/**
 * 项目配置工具辅助（check_project_config / update_project_config）。
 *
 * 从 novel-writer.ts 原样搬入，V1/V2 双入口窗口期共用同一份实现。
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "fs"
import { dirname, join } from "path"

const PROVIDER_MODEL_PATTERN = /^[\w.-]+\/[\w.-]+$/

/** opennovel.json 中允许 agent 读取/修改的字段（白名单） */
const OPENNOVEL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "model", label: "默认模型" },
  { key: "small_model", label: "小模型" },
  { key: "default_agent", label: "默认 agent" },
  { key: "username", label: "用户名" },
  { key: "share", label: "分享策略" },
  { key: "autoupdate", label: "自动更新" },
  { key: "logLevel", label: "日志级别" },
]

/** .novel/config.json 中允许 agent 读取/修改的字段 */
const NOVEL_CONFIG_FIELDS: Array<{ key: string; label: string }> = [
  { key: "name", label: "项目名称" },
  { key: "created_at", label: "创建时间" },
  { key: "version", label: "版本" },
  { key: "writing_mode", label: "写作模式" },
  { key: "setup_mode", label: "初始化模式" },
  { key: "technique_injection", label: "技法注入" },
]

type FieldSpec = {
  parseJson: boolean
  validate: (value: unknown) => string | null
}

/** 校验函数：返回 null 表示通过，返回字符串表示错误原因 */
const OPENNOVEL_FIELD_SPECS: Record<string, FieldSpec> = {
  model: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && PROVIDER_MODEL_PATTERN.test(v)
        ? null
        : "必须是 'provider/model' 格式（如 anthropic/claude-sonnet-4-5）",
  },
  small_model: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && PROVIDER_MODEL_PATTERN.test(v)
        ? null
        : "必须是 'provider/model' 格式",
  },
  default_agent: {
    parseJson: false,
    validate: (v) => (typeof v === "string" && v.length > 0 ? null : "必须是非空字符串"),
  },
  username: {
    parseJson: false,
    validate: (v) => (typeof v === "string" ? null : "必须是字符串"),
  },
  share: {
    parseJson: true,
    validate: (v) =>
      v === "manual" || v === "auto" || v === "disabled" ? null : "必须是 manual / auto / disabled 之一",
  },
  autoupdate: {
    parseJson: true,
    validate: (v) =>
      typeof v === "boolean" || v === "notify" ? null : "必须是 true / false / \"notify\" 之一",
  },
  logLevel: {
    parseJson: true,
    validate: (v) =>
      v === "DEBUG" || v === "INFO" || v === "WARN" || v === "ERROR"
        ? null
        : "必须是 DEBUG / INFO / WARN / ERROR 之一",
  },
}

const NOVEL_CONFIG_FIELD_SPECS: Record<string, FieldSpec> = {
  name: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && v.length > 0 && v.length <= 100 ? null : "必须是 1-100 字符的字符串",
  },
  version: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && /^\d+\.\d+\.\d+/.test(v) ? null : "必须是语义化版本字符串（如 1.0.0）",
  },
  writing_mode: {
    parseJson: true,
    validate: (v) => (v === "auto" || v === "review" ? null : "必须是 auto（自动）/ review（审核）之一"),
  },
  setup_mode: {
    parseJson: true,
    validate: (v) =>
      v === "interactive" || v === "auto" ? null : "必须是 interactive（确认）/ auto（自动）之一",
  },
  technique_injection: {
    parseJson: true,
    validate: (v) => (typeof v === "boolean" ? null : "必须是 boolean（true 开启注入 / false 保持 shadow mode）"),
  },
}

type ProjectConfigSpec = {
  resolvePath: (projectDir: string) => string
  fields: Record<string, FieldSpec>
}

const PROJECT_CONFIG_SPECS: Record<string, ProjectConfigSpec> = {
  opennovel: {
    resolvePath: (projectDir) => {
      const found = findOpennovelConfig(projectDir)
      return found ?? join(projectDir, "opennovel.json")
    },
    fields: OPENNOVEL_FIELD_SPECS,
  },
  novel: {
    resolvePath: (projectDir) => join(projectDir, ".novel", "config.json"),
    fields: NOVEL_CONFIG_FIELD_SPECS,
  },
}

/**
 * 查找 opennovel 配置文件。查找顺序：
 * 1. 项目根目录 opennovel.jsonc / opennovel.json
 * 2. 项目根目录 .opennovel/opennovel.jsonc / .opennovel/opennovel.json
 * 3. 全局用户目录 ~/.config/opennovel/opennovel.jsonc / ~/.config/opennovel/opennovel.json
 *
 * 工具不读 .jsonc 注释（plugin 包不依赖 jsonc-parser），如果 .jsonc 含注释
 * 解析会失败，工具会报告并拒绝写入——让用户手工去掉注释或转纯 .json。
 */
function findOpennovelConfig(projectDir: string): string | undefined {
  const candidates: string[] = []
  // 项目根目录
  candidates.push(join(projectDir, "opennovel.jsonc"))
  candidates.push(join(projectDir, "opennovel.json"))
  // 项目级 .opennovel 子目录（openNovel 官方标准路径）
  candidates.push(join(projectDir, ".opennovel", "opennovel.jsonc"))
  candidates.push(join(projectDir, ".opennovel", "opennovel.json"))
  // 全局用户目录
  const home = process.env["HOME"] || process.env["USERPROFILE"]
  if (home) {
    candidates.push(join(home, ".config", "opennovel", "opennovel.jsonc"))
    candidates.push(join(home, ".config", "opennovel", "opennovel.json"))
  }
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return undefined
}

function formatConfigValue(value: unknown): string {
  if (value === undefined) return "（未设置）"
  if (value === null) return "null"
  if (typeof value === "string") return value.length > 80 ? value.slice(0, 80) + "…" : value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 读取项目配置（opennovel.json + .novel/config.json）白名单字段，组装展示文本。
 * 由 check_project_config 工具调用。文件不存在或 JSON 损坏时返回提示，不抛异常。
 */
export function readProjectConfig(projectDir: string): {
  title: string
  output: string
  metadata: {
    opennovel_path: string | undefined
    novel_config_path: string
    novel_config_exists: boolean
  }
} {
  const sections: string[] = []

  const opennovelPath = findOpennovelConfig(projectDir)
  if (opennovelPath) {
    try {
      const raw = readFileSync(opennovelPath, "utf-8")
      const data = JSON.parse(raw) as Record<string, unknown>
      sections.push(`## opennovel.json（${opennovelPath}）`)
      let shown = 0
      for (const field of OPENNOVEL_FIELDS) {
        if (field.key in data) {
          sections.push(`- ${field.label}：${formatConfigValue(data[field.key])}`)
          shown++
        }
      }
      if (shown === 0) sections.push("- （白名单字段均为空，使用默认值）")
    } catch (err) {
      sections.push(`## opennovel.json（解析失败）`)
      sections.push(
        `- ⚠ ${opennovelPath} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else {
    sections.push(`## opennovel.json（未找到）`)
    sections.push("- 项目根目录没有 opennovel.json / opennovel.jsonc")
  }

  const novelConfigPath = join(projectDir, ".novel", "config.json")
  sections.push("")
  if (existsSync(novelConfigPath)) {
    try {
      const raw = readFileSync(novelConfigPath, "utf-8")
      const data = JSON.parse(raw) as Record<string, unknown>
      sections.push(`## .novel/config.json（${novelConfigPath}）`)
      let shown = 0
      for (const field of NOVEL_CONFIG_FIELDS) {
        if (field.key in data) {
          sections.push(`- ${field.label}：${formatConfigValue(data[field.key])}`)
          shown++
        }
      }
      if (shown === 0) sections.push("- （白名单字段均为空）")
    } catch (err) {
      sections.push(`## .novel/config.json（解析失败）`)
      sections.push(
        `- ⚠ ${novelConfigPath} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else {
    sections.push(`## .novel/config.json（未找到）`)
    sections.push("- 项目未通过 initNovelProject 初始化")
  }

  return {
    title: "check_project_config",
    output: sections.join("\n"),
    metadata: {
      opennovel_path: opennovelPath,
      novel_config_path: novelConfigPath,
      novel_config_exists: existsSync(novelConfigPath),
    },
  }
}


/**
 * 更新项目配置白名单字段，写入前自动备份原文件。由 update_project_config 工具调用。
 * 拒绝写入白名单外的字段（防越权改 provider/mcp/permission 等敏感配置）。
 */
export function writeProjectConfig(
  projectDir: string,
  target: "opennovel" | "novel",
  field: string,
  rawValue: string,
): {
  title: string
  output: string
  metadata?: {
    target: string
    field: string
    old_value: unknown
    new_value: unknown
    file: string
    had_original: boolean
  }
} {
  const spec = PROJECT_CONFIG_SPECS[target]
  if (!spec) {
    return { title: "update_project_config", output: `不支持的 target：${target}` }
  }
  const fieldSpec = spec.fields[field]
  if (!fieldSpec) {
    const allowed = Object.keys(spec.fields).join("、")
    return {
      title: "update_project_config",
      output: `target=${target} 不支持字段 "${field}"。允许的字段：${allowed}`,
    }
  }

  let parsed: unknown
  if (fieldSpec.parseJson) {
    try {
      parsed = JSON.parse(rawValue)
    } catch {
      return {
        title: "update_project_config",
        output: `字段 ${field} 需要合法的 JSON 字面量：${rawValue}`,
      }
    }
  } else {
    parsed = rawValue
  }
  const validationError = fieldSpec.validate(parsed)
  if (validationError) {
    return { title: "update_project_config", output: `字段 ${field} 校验失败：${validationError}` }
  }

  const filePath = spec.resolvePath(projectDir)
  mkdirSync(dirname(filePath), { recursive: true })

  let data: Record<string, unknown> = {}
  let hadOriginal = false
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8")
      data = JSON.parse(raw) as Record<string, unknown>
      hadOriginal = true
    } catch (err) {
      return {
        title: "update_project_config",
        output: `${filePath} 不是合法 JSON，拒绝覆盖以防损坏：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  const oldValue = data[field]
  data[field] = parsed

  if (hadOriginal) {
    try {
      const backupPath = filePath + ".bak"
      // 备份走 fsync — 断电时不留半截 .bak
      const backupFd = openSync(backupPath, "w")
      try {
        writeSync(backupFd, readFileSync(filePath))
        fsyncSync(backupFd)
      } finally {
        closeSync(backupFd)
      }
    } catch (err) {
      return {
        title: "update_project_config",
        output: `备份原文件失败：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  try {
    // 主文件走 fsync — 断电时不留半截 JSON，避免 user 配的 model / writing_mode 静默丢失
    const fd = openSync(filePath, "w")
    try {
      writeSync(fd, JSON.stringify(data, null, 2) + "\n")
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    return {
      title: "update_project_config",
      output: `写入失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return {
    title: "update_project_config",
    output: [
      `已更新 ${target}.${field}`,
      `旧值：${formatConfigValue(oldValue)}`,
      `新值：${formatConfigValue(parsed)}`,
      `文件：${filePath}`,
      hadOriginal ? `备份：${filePath}.bak` : "（首次写入，无备份）",
    ].join("\n"),
    metadata: {
      target,
      field,
      old_value: oldValue,
      new_value: parsed,
      file: filePath,
      had_original: hadOriginal,
    },
  }
}
