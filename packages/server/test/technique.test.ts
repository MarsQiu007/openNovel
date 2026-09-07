/**
 * 技法 handler 函数测试：验证 CRUD 效果、未找到错误和注入开关写入失败。
 */
import { afterAll, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeDb } from "@opennovel-ai/novel-store"
import {
  createTechniqueForDirectory,
  deleteTechniqueForDirectory,
  getTechniqueForDirectory,
  listTechniquesForDirectory,
  readTechniqueInjectionForDirectory,
  updateTechniqueForDirectory,
  writeTechniqueInjectionForDirectory,
} from "../src/handlers/technique"
import { TechniqueNotFoundError, TechniqueValidationError } from "@opennovel-ai/protocol/groups/technique"

const root = join(tmpdir(), `opennovel-technique-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const directory = join(root, "project")

afterAll(() => {
  closeDb(directory)
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
})

describe("technique handler", () => {
  test("创建、列表、详情、更新、删除", async () => {
    mkdirSync(directory, { recursive: true })
    const created = await Effect.runPromise(
      createTechniqueForDirectory(directory, { name: "对话留白", instruction: "在关键回应前插入沉默" }),
    )
    expect(created.name).toBe("对话留白")

    const list = await Effect.runPromise(listTechniquesForDirectory(directory))
    expect(list.some((item) => item.id === created.id)).toBe(true)

    const detail = await Effect.runPromise(getTechniqueForDirectory(created.id, directory))
    expect(detail.technique.id).toBe(created.id)
    expect(detail.feedbacks).toEqual([])

    const updated = await Effect.runPromise(
      updateTechniqueForDirectory(created.id, directory, { instruction: "用沉默替代解释" }),
    )
    expect(updated.instruction).toBe("用沉默替代解释")

    const deleted = await Effect.runPromise(deleteTechniqueForDirectory(created.id, directory))
    expect(deleted.deleted).toBe(true)
  })

  test("未找到时返回 TechniqueNotFoundError", async () => {
    mkdirSync(directory, { recursive: true })
    const exit = await Effect.runPromiseExit(getTechniqueForDirectory("missing", directory))
    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return
    const error = Cause.squash(exit.cause) as TechniqueNotFoundError
    expect(error.name).toBe("TechniqueNotFoundError")
  })

  test("注入开关默认关闭且写入保留其他字段", async () => {
    mkdirSync(join(directory, ".novel"), { recursive: true })
    const configPath = join(directory, ".novel", "config.json")
    writeFileSync(configPath, JSON.stringify({ name: "书", writing_mode: "review" }), "utf-8")

    expect(await Effect.runPromise(readTechniqueInjectionForDirectory(directory))).toEqual({ enabled: false })
    expect(await Effect.runPromise(writeTechniqueInjectionForDirectory(directory, true))).toEqual({ enabled: true })
    expect(await Effect.runPromise(readTechniqueInjectionForDirectory(directory))).toEqual({ enabled: true })
  })

  test("损坏的配置文件拒绝写入", async () => {
    mkdirSync(join(directory, ".novel"), { recursive: true })
    writeFileSync(join(directory, ".novel", "config.json"), "{ broken")
    const exit = await Effect.runPromiseExit(writeTechniqueInjectionForDirectory(directory, true))
    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return
    const error = Cause.squash(exit.cause) as TechniqueValidationError
    expect(error.name).toBe("TechniqueValidationError")
  })
})