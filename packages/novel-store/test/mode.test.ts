/**
 * mode.ts 测试 — 覆盖：默认值、读不存在文件、写 + 读回、.bak 备份、非法值降级、跨域互不污染
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import {
  readNovelConfig,
  writeNovelConfig,
  getNovelConfigPath,
  DEFAULT_NOVEL_MODE_CONFIG,
  type WritingMode,
  type SetupMode,
} from "../src/index.js"

let projectDir: string
const configPath = () => getNovelConfigPath(projectDir)

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-mode-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 兜底
  }
})

describe("getNovelConfigPath", () => {
  test("拼接 .novel/config.json 路径", () => {
    expect(getNovelConfigPath("/tmp/foo")).toBe("/tmp/foo/.novel/config.json")
  })
})

describe("readNovelConfig — 默认值降级", () => {
  test("文件不存在时返回默认配置", () => {
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("JSON 损坏时返回默认配置", () => {
    writeFileSync(configPath(), "{ this is not json", "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("非对象 JSON 时返回默认配置", () => {
    writeFileSync(configPath(), "null", "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)

    writeFileSync(configPath(), '"a string"', "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("writing_mode 非法值降级默认", () => {
    writeFileSync(configPath(), JSON.stringify({ writing_mode: "fast", setup_mode: "auto" }), "utf-8")
    expect(readNovelConfig(projectDir)).toEqual({ writing_mode: "auto", setup_mode: "auto" })
  })

  test("setup_mode 非法值降级默认", () => {
    writeFileSync(configPath(), JSON.stringify({ writing_mode: "review", setup_mode: "manual" }), "utf-8")
    expect(readNovelConfig(projectDir)).toEqual({ writing_mode: "review", setup_mode: "interactive" })
  })

  test("字段缺失时逐字段降级", () => {
    writeFileSync(configPath(), JSON.stringify({ name: "项目名", version: 1 }), "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("默认值常量符合用户拍板决策", () => {
    // 用户拍板：writing 默认 auto（说"审核"时才审），setup 默认 interactive（必确认）
    expect(DEFAULT_NOVEL_MODE_CONFIG.writing_mode).toBe("auto")
    expect(DEFAULT_NOVEL_MODE_CONFIG.setup_mode).toBe("interactive")
  })
})

describe("writeNovelConfig — 写入与备份", () => {
  test("首次写入创建文件并落盘", () => {
    const result = writeNovelConfig(projectDir, { writing_mode: "review" })
    expect(result).toEqual({ writing_mode: "review", setup_mode: "interactive" })
    expect(existsSync(configPath())).toBe(true)
    const onDisk = JSON.parse(readFileSync(configPath(), "utf-8"))
    expect(onDisk).toEqual(result)
  })

  test("覆盖前先备份为 .bak", () => {
    writeNovelConfig(projectDir, { writing_mode: "review", setup_mode: "auto" })
    writeNovelConfig(projectDir, { writing_mode: "auto" })
    const bakPath = `${configPath()}.bak`
    expect(existsSync(bakPath)).toBe(true)
    const bak = JSON.parse(readFileSync(bakPath, "utf-8"))
    expect(bak).toEqual({ writing_mode: "review", setup_mode: "auto" })
    // 当前文件已被新值覆盖
    expect(readNovelConfig(projectDir).writing_mode).toBe("auto")
  })

  test("部分 patch 不破坏未指定字段", () => {
    writeNovelConfig(projectDir, { writing_mode: "review", setup_mode: "auto" })
    const result = writeNovelConfig(projectDir, { writing_mode: "auto" })
    expect(result).toEqual({ writing_mode: "auto", setup_mode: "auto" })
  })

  test("非法 patch 值被拒绝并保持原值", () => {
    writeNovelConfig(projectDir, { writing_mode: "review", setup_mode: "auto" })
    // 非法值在 writeNovelConfig 内被 isWritingMode/isSetupMode 拦截
    const result = writeNovelConfig(projectDir, {
      writing_mode: "turbo" as unknown as WritingMode,
      setup_mode: "manual" as unknown as SetupMode,
    })
    expect(result).toEqual({ writing_mode: "review", setup_mode: "auto" })
  })

  test("空 patch 相当于幂等写回", () => {
    writeNovelConfig(projectDir, { writing_mode: "review", setup_mode: "auto" })
    const result = writeNovelConfig(projectDir, {})
    expect(result).toEqual({ writing_mode: "review", setup_mode: "auto" })
  })
})

describe("read/write 互不污染", () => {
  test("不同 projectDir 互不干扰", () => {
    const dirA = join(projectDir, "A")
    const dirB = join(projectDir, "B")
    mkdirSync(join(dirA, ".novel"), { recursive: true })
    mkdirSync(join(dirB, ".novel"), { recursive: true })

    writeNovelConfig(dirA, { writing_mode: "review" })
    expect(readNovelConfig(dirB).writing_mode).toBe("auto")
    expect(readNovelConfig(dirA).writing_mode).toBe("review")
  })
})

describe("鲁棒性 — 边界文件形态", () => {
  test("文件为空字符串时降级默认", () => {
    writeFileSync(configPath(), "", "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("文件仅 BOM 头时降级默认（Windows PowerShell / VSCode）", () => {
    writeFileSync(configPath(), "﻿", "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("BOM 头 + 合法 JSON 时正常解析", () => {
    writeFileSync(configPath(), "﻿" + JSON.stringify({ writing_mode: "review" }), "utf-8")
    expect(readNovelConfig(projectDir).writing_mode).toBe("review")
  })

  test("JSON 是数组时降级默认", () => {
    writeFileSync(configPath(), JSON.stringify([1, 2, 3]), "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("JSON 是数字时降级默认", () => {
    writeFileSync(configPath(), "42", "utf-8")
    expect(readNovelConfig(projectDir)).toEqual(DEFAULT_NOVEL_MODE_CONFIG)
  })

  test("中文 / Emoji 路径可正常读写", () => {
    const cnDir = join(tmpdir(), `小说-项目-${Date.now()}`)
    mkdirSync(join(cnDir, ".novel"), { recursive: true })
    writeNovelConfig(cnDir, { writing_mode: "review" })
    expect(readNovelConfig(cnDir).writing_mode).toBe("review")
    rmSync(cnDir, { recursive: true, force: true })
  })

  test("路径含空格可正常读写", () => {
    const spDir = join(tmpdir(), `my novel project ${Date.now()}`)
    mkdirSync(join(spDir, ".novel"), { recursive: true })
    writeNovelConfig(spDir, { setup_mode: "auto" })
    expect(readNovelConfig(spDir).setup_mode).toBe("auto")
    rmSync(spDir, { recursive: true, force: true })
  })
})
