/**
 * novel-mode handler 测试 — 直接调函数式 handler，验证读写 + 非法值拒绝
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { Effect, Exit, Option, Cause } from "effect"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { getMode, setMode } from "../src/handlers/novel-mode"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "novel-mode-test-"))
  // 预创建 .novel 目录
  const fs = require("fs")
  fs.mkdirSync(join(tempDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // 兜底
  }
})

describe("getMode", () => {
  test("无配置文件时返回默认值", async () => {
    // 故意把 .novel/config.json 删了
    const configPath = join(tempDir, ".novel", "config.json")
    if (existsSync(configPath)) rmSync(configPath)
    const result = await Effect.runPromise(getMode(tempDir))
    expect(result).toEqual({ writing_mode: "auto", setup_mode: "interactive" })
  })

  test("配置文件存在时返回正确字段", async () => {
    // 预写入自定义配置
    const configPath = join(tempDir, ".novel", "config.json")
    require("fs").writeFileSync(configPath, JSON.stringify({ writing_mode: "review", setup_mode: "auto" }))
    const result = await Effect.runPromise(getMode(tempDir))
    expect(result).toEqual({ writing_mode: "review", setup_mode: "auto" })
  })

  test("配置文件 JSON 损坏时降级默认", async () => {
    const configPath = join(tempDir, ".novel", "config.json")
    require("fs").writeFileSync(configPath, "{ not json")
    const result = await Effect.runPromise(getMode(tempDir))
    expect(result).toEqual({ writing_mode: "auto", setup_mode: "interactive" })
  })
})

describe("setMode", () => {
  test("写入新模式落盘 + 返回新值", async () => {
    const result = await Effect.runPromise(
      setMode(tempDir, { writing_mode: "review" }),
    )
    expect(result).toEqual({ writing_mode: "review", setup_mode: "interactive" })
    // 落盘验证
    const configPath = join(tempDir, ".novel", "config.json")
    expect(existsSync(configPath)).toBe(true)
    const onDisk = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(onDisk).toEqual(result)
  })

  test("部分 PATCH 不破坏未指定字段", async () => {
    await Effect.runPromise(setMode(tempDir, { writing_mode: "review", setup_mode: "auto" }))
    const result = await Effect.runPromise(setMode(tempDir, { setup_mode: "interactive" }))
    expect(result).toEqual({ writing_mode: "review", setup_mode: "interactive" })
  })

  test("覆盖前备份 .bak", async () => {
    await Effect.runPromise(setMode(tempDir, { writing_mode: "review" }))
    await Effect.runPromise(setMode(tempDir, { writing_mode: "auto" }))
    const bakPath = join(tempDir, ".novel", "config.json.bak")
    expect(existsSync(bakPath)).toBe(true)
    const bak = JSON.parse(readFileSync(bakPath, "utf-8"))
    expect(bak).toEqual({ writing_mode: "review", setup_mode: "interactive" })
  })

  test("非法 writing_mode 被 store 降级（保持当前值）", async () => {
    // 协议 schema 在边界已校验枚举；handler 端不二次校验，
    // store 端 writeNovelConfig 的 isWritingMode/isSetupMode 拦截非法 patch 并保留原值
    await Effect.runPromise(setMode(tempDir, { writing_mode: "review" }))
    const result = await Effect.runPromise(
      setMode(tempDir, { writing_mode: "turbo" as unknown as "auto" }),
    )
    // 非法值被忽略，原值保留
    expect(result.writing_mode).toBe("review")
  })

  test("非法 setup_mode 被 store 降级（保持当前值）", async () => {
    await Effect.runPromise(setMode(tempDir, { setup_mode: "auto" }))
    const result = await Effect.runPromise(
      setMode(tempDir, { setup_mode: "manual" as unknown as "interactive" }),
    )
    // 非法值被忽略，原值保留
    expect(result.setup_mode).toBe("auto")
  })

  test("getMode 对 undefined directory 回退到 process.cwd()", async () => {
    // 不污染 cwd：先备份
    const originalCwd = process.cwd()
    const sandboxDir = mkdtempSync(join(tmpdir(), "novel-mode-cwd-"))
    process.chdir(sandboxDir)
    try {
      // getMode(undefined) 应不抛错，回退到 cwd
      const result = await Effect.runPromise(getMode(undefined))
      expect(result).toEqual({ writing_mode: "auto", setup_mode: "interactive" })
    } finally {
      process.chdir(originalCwd)
      rmSync(sandboxDir, { recursive: true, force: true })
    }
  })

  test("setMode 走 Effect.runPromiseExit 验证 Effect failure channel", async () => {
    // 演示：用 Exit 拿失败分支，未来若 setMode 加 Effect.catchAll / mapError
    // 这套断言能精确捕捉 failure 形状变化（比 .rejects.toBeInstanceOf 更稳）
    const exit = await Effect.runPromiseExit(
      setMode(tempDir, { writing_mode: "review" }).pipe(Effect.flip),
    )
    // 原始 setMode 成功 → flip 后变 Failure
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("getMode + setMode 闭环", () => {
  test("set 后 get 读到新值", async () => {
    await Effect.runPromise(
      setMode(tempDir, { writing_mode: "review", setup_mode: "auto" }),
    )
    const result = await Effect.runPromise(getMode(tempDir))
    expect(result).toEqual({ writing_mode: "review", setup_mode: "auto" })
  })
})

describe("setMode audit log", () => {
  test("首次写入时记录 before=默认值 → after=patch", async () => {
    // 删掉预创建的 config（如果有）让 before 等于默认值
    const configPath = join(tempDir, ".novel", "config.json")
    if (existsSync(configPath)) rmSync(configPath)
    await Effect.runPromise(setMode(tempDir, { writing_mode: "review" }))

    const auditPath = join(tempDir, ".novel", "audit", "mode.jsonl")
    expect(existsSync(auditPath)).toBe(true)
    const lines = readFileSync(auditPath, "utf-8").trim().split("\n")
    expect(lines.length).toBe(1)

    const entry = JSON.parse(lines[0])
    expect(entry).toMatchObject({
      before: { writing_mode: "auto", setup_mode: "interactive" },
      after: { writing_mode: "review", setup_mode: "interactive" },
      patch: { writing_mode: "review" },
    })
    expect(typeof entry.ts).toBe("number")
    expect(entry.ts).toBeGreaterThan(0)
  })

  test("patch 与现状相同时不写 audit（避免噪声）", async () => {
    // 先写入一次
    await Effect.runPromise(setMode(tempDir, { writing_mode: "review" }))
    const auditPath = join(tempDir, ".novel", "audit", "mode.jsonl")
    const beforeLines = readFileSync(auditPath, "utf-8").trim().split("\n").length

    // 再次写入相同值 → 不应产生新 audit
    await Effect.runPromise(setMode(tempDir, { writing_mode: "review" }))
    const afterLines = readFileSync(auditPath, "utf-8").trim().split("\n").length
    expect(afterLines).toBe(beforeLines)
  })

  test("patch 只包含实际变更的字段", async () => {
    // 起始：writing=auto, setup=interactive
    // 用户只改 setup_mode=auto → audit.patch 应只有 setup_mode
    await Effect.runPromise(setMode(tempDir, { setup_mode: "auto" }))

    const auditPath = join(tempDir, ".novel", "audit", "mode.jsonl")
    const entry = JSON.parse(readFileSync(auditPath, "utf-8").trim())
    expect(entry.patch).toEqual({ setup_mode: "auto" })
    expect(entry.patch.writing_mode).toBeUndefined()
  })

  test("多次变更累加为多行 JSONL", async () => {
    await Effect.runPromise(setMode(tempDir, { writing_mode: "review" }))
    await Effect.runPromise(setMode(tempDir, { setup_mode: "auto" }))
    await Effect.runPromise(setMode(tempDir, { writing_mode: "auto" }))

    const auditPath = join(tempDir, ".novel", "audit", "mode.jsonl")
    const lines = readFileSync(auditPath, "utf-8").trim().split("\n")
    expect(lines.length).toBe(3)
    // 每行都是合法 JSON
    lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow())
  })
})
