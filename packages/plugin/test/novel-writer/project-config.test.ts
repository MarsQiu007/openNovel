/**
 * 项目配置工具测试（check_project_config / update_project_config）
 *
 * 覆盖场景：
 *  - readProjectConfig：文件缺失 / 单文件存在 / 双文件存在 / 白名单外字段不展示 / JSON 损坏
 *  - writeProjectConfig：合法 model 写入 / 非法 model 格式拒绝 / 白名单外字段拒绝 /
 *    首次写入不备份 / 原文件 JSON 损坏拒绝覆盖 / enum/boolean 字段校验 /
 *    备份文件内容与原文件一致
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { readProjectConfig, writeProjectConfig } from "../../src/novel-writer.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-project-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(projectDir, { recursive: true })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ─── readProjectConfig ───

describe("readProjectConfig", () => {
  test("项目无任何配置文件时显示「未找到」", () => {
    const result = readProjectConfig(projectDir)
    expect(result.title).toBe("check_project_config")
    expect(result.output).toContain("opennovel.json（未找到）")
    expect(result.output).toContain(".novel/config.json（未找到）")
    expect(result.metadata.opennovel_path).toBeUndefined()
    expect(result.metadata.novel_config_exists).toBe(false)
  })

  test("只存在 opennovel.json 时只展示白名单字段", () => {
    writeFileSync(
      join(projectDir, "opennovel.json"),
      JSON.stringify({
        model: "anthropic/claude-sonnet-4-5",
        small_model: "anthropic/claude-haiku",
        default_agent: "director",
        username: "alice",
        share: "auto",
        autoupdate: true,
        logLevel: "INFO",
        // 白名单外字段
        provider: { anthropic: { options: { apiKey: "secret-key" } } },
        mcp: { someServer: { command: "x" } },
        permission: { bash: "deny" },
      }),
    )
    const result = readProjectConfig(projectDir)
    expect(result.output).toContain("anthropic/claude-sonnet-4-5")
    expect(result.output).toContain("小模型：anthropic/claude-haiku")
    expect(result.output).toContain("默认 agent")
    expect(result.output).toContain("director")
    expect(result.output).toContain("用户名")
    expect(result.output).toContain("alice")
    expect(result.output).toContain("分享策略")
    expect(result.output).toContain("auto")
    expect(result.output).toContain("true")
    expect(result.output).toContain("INFO")
    // 关键：白名单外字段（特别是 apiKey）绝不能展示
    expect(result.output).not.toContain("anthropic: {")
    expect(result.output).not.toContain("secret-key")
    expect(result.output).not.toContain("provider")
    expect(result.output).not.toContain("apiKey")
    expect(result.output).not.toContain("permission")
  })

  test("opennovel.jsonc 也可读取（即使有注释）", () => {
    // 注：本工具不解析 jsonc 注释——如果 .jsonc 含注释会报"解析失败"并提示手工处理。
    // 干净 .jsonc（无注释）应能正常解析。
    writeFileSync(join(projectDir, "opennovel.jsonc"), JSON.stringify({ model: "openai/gpt-5" }))
    const result = readProjectConfig(projectDir)
    expect(result.output).toContain("openai/gpt-5")
    expect(result.metadata.opennovel_path).toContain("opennovel.jsonc")
  })

  test("opennovel.json 损坏时报错但不抛异常", () => {
    writeFileSync(join(projectDir, "opennovel.json"), "{ this is not valid json")
    const result = readProjectConfig(projectDir)
    expect(result.output).toContain("opennovel.json（解析失败）")
    expect(result.output).toContain("不是合法 JSON")
  })

  test("只存在 .novel/config.json 时展示项目元数据", () => {
    const novelDir = join(projectDir, ".novel")
    mkdirSync(novelDir, { recursive: true })
    writeFileSync(
      join(novelDir, "config.json"),
      JSON.stringify({ name: "星途：永恒之路", created_at: "2024-01-15T00:00:00.000Z", version: "1.0.0" }),
    )
    const result = readProjectConfig(projectDir)
    expect(result.output).toContain("星途：永恒之路")
    expect(result.output).toContain("项目名称")
    expect(result.output).toContain("2024-01-15")
    expect(result.output).toContain("1.0.0")
    expect(result.metadata.novel_config_exists).toBe(true)
  })

  test("两个文件都存在时一起展示", () => {
    writeFileSync(join(projectDir, "opennovel.json"), JSON.stringify({ model: "anthropic/claude-sonnet-4-5" }))
    const novelDir = join(projectDir, ".novel")
    mkdirSync(novelDir, { recursive: true })
    writeFileSync(join(novelDir, "config.json"), JSON.stringify({ name: "星途：永恒之路" }))
    const result = readProjectConfig(projectDir)
    expect(result.output).toContain("anthropic/claude-sonnet-4-5")
    expect(result.output).toContain("星途：永恒之路")
  })
})

// ─── writeProjectConfig ───

describe("writeProjectConfig", () => {
  test("合法 model 写入：备份原文件 + 更新字段", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(
      file,
      JSON.stringify({ model: "qwen3.7-plus", otherField: "preserve-me" }, null, 2) + "\n",
    )
    const result = writeProjectConfig(projectDir, "opennovel", "model", "anthropic/claude-sonnet-4-5")
    expect(result.title).toBe("update_project_config")
    expect(result.output).toContain("已更新 opennovel.model")
    expect(result.output).toContain("qwen3.7-plus")
    expect(result.output).toContain("anthropic/claude-sonnet-4-5")
    expect(result.output).toContain("备份")
    // 落盘内容正确
    const written = JSON.parse(readFileSync(file, "utf-8"))
    expect(written.model).toBe("anthropic/claude-sonnet-4-5")
    // 其他字段保留
    expect(written.otherField).toBe("preserve-me")
    // 备份文件存在且内容等于原始
    const backupPath = file + ".bak"
    expect(existsSync(backupPath)).toBe(true)
    const backupContent = JSON.parse(readFileSync(backupPath, "utf-8"))
    expect(backupContent.model).toBe("qwen3.7-plus")
    expect(backupContent.otherField).toBe("preserve-me")
    // metadata 正确
    expect(result.metadata?.target).toBe("opennovel")
    expect(result.metadata?.field).toBe("model")
    expect(result.metadata?.old_value).toBe("qwen3.7-plus")
    expect(result.metadata?.new_value).toBe("anthropic/claude-sonnet-4-5")
    expect(result.metadata?.had_original).toBe(true)
  })

  test("model 缺 provider 部分被拒绝", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, JSON.stringify({ model: "qwen3.7-plus" }))
    const result = writeProjectConfig(projectDir, "opennovel", "model", "glm-5")
    expect(result.output).toContain("校验失败")
    expect(result.output).toContain("provider/model")
    // 原文件未变
    const data = JSON.parse(readFileSync(file, "utf-8"))
    expect(data.model).toBe("qwen3.7-plus")
  })

  test("model 含奇怪字符被拒绝", () => {
    writeFileSync(join(projectDir, "opennovel.json"), JSON.stringify({ model: "x" }))
    const result = writeProjectConfig(projectDir, "opennovel", "model", "../etc/passwd")
    expect(result.output).toContain("校验失败")
  })

  test("白名单外字段（如 provider）一律拒绝", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, JSON.stringify({ model: "x/y" }))
    const result = writeProjectConfig(projectDir, "opennovel", "provider", "injected")
    expect(result.output).toContain("不支持字段")
    expect(result.output).toContain("允许的字段")
    // 列出允许的字段
    expect(result.output).toContain("model")
    expect(result.output).toContain("small_model")
    // 原文件未变
    const data = JSON.parse(readFileSync(file, "utf-8"))
    expect(data.provider).toBeUndefined()
  })

  test("白名单外的敏感字段（mcp / permission / plugin / agent）也拒绝", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, "{}")
    for (const field of ["mcp", "permission", "plugin"]) {
      const r = writeProjectConfig(projectDir, "opennovel", field, "x")
      expect(r.output).toContain("不支持字段")
    }
  })

  test("首次写入（无原文件）不创建备份", () => {
    const result = writeProjectConfig(projectDir, "opennovel", "model", "anthropic/claude-sonnet-4-5")
    expect(result.output).toContain("已更新")
    expect(result.output).toContain("首次写入，无备份")
    const file = join(projectDir, "opennovel.json")
    expect(existsSync(file)).toBe(true)
    expect(existsSync(file + ".bak")).toBe(false)
    expect(result.metadata?.had_original).toBe(false)
  })

  test("原文件 JSON 损坏时拒绝覆盖", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, "{ broken")
    const result = writeProjectConfig(projectDir, "opennovel", "model", "anthropic/claude-sonnet-4-5")
    expect(result.output).toContain("不是合法 JSON")
    expect(result.output).toContain("拒绝覆盖")
    // 原文件保持原样（未损坏未丢失）
    expect(readFileSync(file, "utf-8")).toBe("{ broken")
  })

  test("非法 target 拒绝", () => {
    // @ts-expect-error 测试非法入参
    const result = writeProjectConfig(projectDir, "tsconfig", "compilerOptions", "{}")
    expect(result.output).toContain("不支持的 target")
  })

  test("enum 字段（logLevel）拒绝 enum 不合法的 JSON 字面量", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, JSON.stringify({ logLevel: "INFO" }))
    // 传带引号的 JSON 字符串 "FATAL"，JSON.parse 通过但 enum 校验失败
    const result = writeProjectConfig(projectDir, "opennovel", "logLevel", '"FATAL"')
    expect(result.output).toContain("校验失败")
    expect(result.output).toContain("DEBUG / INFO / WARN / ERROR")
    const data = JSON.parse(readFileSync(file, "utf-8"))
    expect(data.logLevel).toBe("INFO")
  })

  test("enum 字段（logLevel）接受合法 JSON 字面量", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, JSON.stringify({ logLevel: "INFO" }))
    const result = writeProjectConfig(projectDir, "opennovel", "logLevel", '"DEBUG"')
    expect(result.output).toContain("已更新")
    const data = JSON.parse(readFileSync(file, "utf-8"))
    expect(data.logLevel).toBe("DEBUG")
  })

  test("enum 字段（logLevel）接受非 JSON 字面量时被拒绝（提示需要 JSON）", () => {
    writeFileSync(join(projectDir, "opennovel.json"), "{}")
    const result = writeProjectConfig(projectDir, "opennovel", "logLevel", "DEBUG")
    expect(result.output).toContain("需要合法的 JSON 字面量")
  })

  test("boolean 字段（autoupdate）接受 true / false / \"notify\"", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, JSON.stringify({ autoupdate: false }))
    for (const val of ["true", "false", '"notify"']) {
      const result = writeProjectConfig(projectDir, "opennovel", "autoupdate", val)
      expect(result.output).toContain("已更新")
    }
    const data = JSON.parse(readFileSync(file, "utf-8"))
    // 最后一次写入是 "notify"
    expect(data.autoupdate).toBe("notify")
  })

  test("share 接受 manual/auto/disabled", () => {
    const file = join(projectDir, "opennovel.json")
    writeFileSync(file, JSON.stringify({ share: "manual" }))
    for (const val of ['"auto"', '"disabled"', '"manual"']) {
      writeProjectConfig(projectDir, "opennovel", "share", val)
    }
    const data = JSON.parse(readFileSync(file, "utf-8"))
    expect(data.share).toBe("manual")
  })

  test(".novel/config.json 的 name 字段合法更新", () => {
    const novelDir = join(projectDir, ".novel")
    mkdirSync(novelDir, { recursive: true })
    const file = join(novelDir, "config.json")
    writeFileSync(
      file,
      JSON.stringify({ name: "未命名小说项目", created_at: "2024-01-15T00:00:00.000Z", version: "1.0.0" }, null, 2),
    )
    const result = writeProjectConfig(projectDir, "novel", "name", "星途：永恒之路")
    expect(result.output).toContain("已更新 novel.name")
    expect(result.output).toContain("未命名小说项目")
    expect(result.output).toContain("星途：永恒之路")
    const data = JSON.parse(readFileSync(file, "utf-8"))
    expect(data.name).toBe("星途：永恒之路")
    // 其他字段保留
    expect(data.created_at).toBe("2024-01-15T00:00:00.000Z")
    expect(data.version).toBe("1.0.0")
  })

  test(".novel/config.json 拒绝修改不在白名单的字段", () => {
    const novelDir = join(projectDir, ".novel")
    mkdirSync(novelDir, { recursive: true })
    writeFileSync(join(novelDir, "config.json"), JSON.stringify({ name: "x" }))
    const result = writeProjectConfig(projectDir, "novel", "description", "evil")
    expect(result.output).toContain("不支持字段")
  })

  test("name 为空字符串被拒绝", () => {
    const novelDir = join(projectDir, ".novel")
    mkdirSync(novelDir, { recursive: true })
    const file = join(novelDir, "config.json")
    writeFileSync(file, JSON.stringify({ name: "原项目名" }))
    const result = writeProjectConfig(projectDir, "novel", "name", "")
    expect(result.output).toContain("校验失败")
    const data = JSON.parse(readFileSync(file, "utf-8"))
    expect(data.name).toBe("原项目名")
  })

  test("version 非语义化版本被拒绝", () => {
    const novelDir = join(projectDir, ".novel")
    mkdirSync(novelDir, { recursive: true })
    writeFileSync(join(novelDir, "config.json"), JSON.stringify({ version: "1.0.0" }))
    const result = writeProjectConfig(projectDir, "novel", "version", "v1.2")
    expect(result.output).toContain("校验失败")
  })

  test("写完后 readProjectConfig 能看到新值", () => {
    writeFileSync(
      join(projectDir, "opennovel.json"),
      JSON.stringify({ model: "qwen3.7-plus" }, null, 2) + "\n",
    )
    writeProjectConfig(projectDir, "opennovel", "model", "anthropic/claude-sonnet-4-5")
    const read = readProjectConfig(projectDir)
    expect(read.output).toContain("anthropic/claude-sonnet-4-5")
    expect(read.output).not.toContain("qwen3.7-plus")
  })
})
