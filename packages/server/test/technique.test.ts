/**
 * 技法 handler 函数测试：验证本书库 CRUD、未找到错误和注入开关语义。
 */
import { afterAll, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const root = join(tmpdir(), `opennovel-technique-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const directory = join(root, "project")

import { closeDb, getDb, TechniqueFeedbackTable, TechniqueTable } from "@opennovel-ai/novel-store"
import {
  createTechniqueForDirectory,
  deleteTechniqueForDirectory,
  getTechniqueForDirectory,
  listTechniquesForDirectory,
  readTechniqueConfigForDirectory,
  updateTechniqueForDirectory,
  writeTechniqueConfigForDirectory,
} from "../src/handlers/technique"
import { TechniqueNotFoundError, TechniqueValidationError } from "@opennovel-ai/protocol/groups/technique"

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
      createTechniqueForDirectory(directory, { name: "对话留白", instruction: "在关键回应前插入沉默", scope: "adult" }),
    )
    expect(created.name).toBe("对话留白")
    expect(created.scope).toBe("adult")

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

  test("更新内容性质时反馈保留在本书库", async () => {
    mkdirSync(directory, { recursive: true })
    const created = await Effect.runPromise(
      createTechniqueForDirectory(directory, { name: "可迁移技法", instruction: "观察反馈是否随技法保留", scope: "adult" }),
    )
    const feedbackId = `fb-${created.id}`
    getDb(directory).insert(TechniqueFeedbackTable).values({
      id: feedbackId,
      technique_id: created.id,
      chapter_id: "ch-1",
      score: 0.8,
      was_used: 1,
      comment: "好用",
      created_at: Date.now(),
    }).run()

    const updated = await Effect.runPromise(updateTechniqueForDirectory(created.id, directory, { scope: "general" }))
    expect(updated.scope).toBe("general")
    expect(updated.id).toBe(created.id)

    const detail = await Effect.runPromise(getTechniqueForDirectory(created.id, directory))
    expect(detail.feedbacks).toHaveLength(1)

    await Effect.runPromise(updateTechniqueForDirectory(created.id, directory, { scope: "adult" }))
    const bookDetail = await Effect.runPromise(getTechniqueForDirectory(created.id, directory))
    expect(bookDetail.technique.scope).toBe("adult")
    expect(bookDetail.feedbacks).toHaveLength(1)
  })

  test("注入开关缺省开启且写入保留其他字段", async () => {
    const configDir = join(root, "config-only")
    mkdirSync(join(configDir, ".novel"), { recursive: true })
    const configPath = join(configDir, ".novel", "config.json")
    writeFileSync(configPath, JSON.stringify({ name: "书", writing_mode: "review" }), "utf-8")

    expect(await Effect.runPromise(readTechniqueConfigForDirectory(configDir))).toEqual({ enabled: true })
    expect(await Effect.runPromise(writeTechniqueConfigForDirectory(configDir, { enabled: false }))).toEqual({
      enabled: false,
    })
    expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({
      name: "书",
      writing_mode: "review",
      technique_injection: false,
    })
    expect(await Effect.runPromise(writeTechniqueConfigForDirectory(configDir, { enabled: true }))).toEqual({
      enabled: true,
    })
  })

  test("损坏的配置文件拒绝写入", async () => {
    mkdirSync(join(directory, ".novel"), { recursive: true })
    writeFileSync(join(directory, ".novel", "config.json"), "{ broken")
    const exit = await Effect.runPromiseExit(writeTechniqueConfigForDirectory(directory, { enabled: true }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return
    const error = Cause.squash(exit.cause) as TechniqueValidationError
    expect(error.name).toBe("TechniqueValidationError")
  })

  test("单行坏数据不拖垮列表", async () => {
    mkdirSync(directory, { recursive: true })
    const good = await Effect.runPromise(
      createTechniqueForDirectory(directory, { name: "合法技法", instruction: "在关键回应前插入沉默", scope: "adult" }),
    )
    getDb(directory)
      .insert(TechniqueTable)
      .values({
        id: "tech-bad-row",
        name: "坏行技法",
        principle: "",
        instruction: "坏行指令示例文本",
        scene_types: JSON.stringify(["dialogue"]),
        level: "paragraph",
        evidence: JSON.stringify([{ sourceLocation: "第1章", excerpt: "片段", annotation: "批注" }]),
        common_misuse: "",
        confidence: 0.5,
        status: "unverified",
        scope: "adult",
        embedding: null,
        usage_count: 0,
        last_used_at: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .run()

    const list = await Effect.runPromise(listTechniquesForDirectory(directory))
    expect(list.some((item) => item.id === good.id)).toBe(true)
    expect(list.some((item) => item.id === "tech-bad-row")).toBe(false)
  })
})
