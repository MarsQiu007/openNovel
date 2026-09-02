/**
 * 技法注入开关（technique_injection）测试
 *
 * 覆盖：读取助手四种输入（true / false / 缺失 / 字符串 "false"）、
 * update_project_config 写入与校验、check_project_config 展示。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { readTechniqueInjection, writeProjectConfig, readProjectConfig } from "../../src/novel-writer.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `technique-injection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

function writeConfig(data: unknown): void {
  writeFileSync(join(projectDir, ".novel", "config.json"), JSON.stringify(data))
}

describe("readTechniqueInjection", () => {
  test("配置缺失返回 false", () => {
    expect(readTechniqueInjection(projectDir)).toBe(false)
  })

  test("true 返回 true", () => {
    writeConfig({ name: "书", technique_injection: true })
    expect(readTechniqueInjection(projectDir)).toBe(true)
  })

  test("false 返回 false", () => {
    writeConfig({ technique_injection: false })
    expect(readTechniqueInjection(projectDir)).toBe(false)
  })

  test("字符串 \"false\" 严格拒绝（不真值判断）", () => {
    writeConfig({ technique_injection: "false" })
    expect(readTechniqueInjection(projectDir)).toBe(false)
  })

  test("JSON 损坏返回 false 不抛异常", () => {
    writeFileSync(join(projectDir, ".novel", "config.json"), "{ broken")
    expect(readTechniqueInjection(projectDir)).toBe(false)
  })
})

describe("writeProjectConfig 支持 technique_injection", () => {
  test("写入 true 成功且读取助手读到 true", () => {
    writeConfig({ name: "书" })
    const result = writeProjectConfig(projectDir, "novel", "technique_injection", "true")
    expect(result.output).toContain("已更新")
    expect(result.metadata?.new_value).toBe(true)
    expect(readTechniqueInjection(projectDir)).toBe(true)
    // 原字段保留
    const data = JSON.parse(readFileSync(join(projectDir, ".novel", "config.json"), "utf-8"))
    expect(data.name).toBe("书")
    expect(existsSync(join(projectDir, ".novel", "config.json.bak"))).toBe(true)
  })

  test("非 boolean 字面量被拒绝", () => {
    // 合法 JSON 但不是 boolean → 走到校验层被拒
    const result = writeProjectConfig(projectDir, "novel", "technique_injection", '"yes"')
    expect(result.output).toContain("校验失败")
    expect(result.output).toContain("boolean")
  })
})

describe("readProjectConfig 展示 technique_injection", () => {
  test("白名单展示技法注入字段", () => {
    writeConfig({ technique_injection: true })
    const result = readProjectConfig(projectDir)
    expect(result.output).toContain("技法注入：true")
  })
})
