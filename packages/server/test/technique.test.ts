/**
 * 技法 handler 函数测试：验证 CRUD 效果、双源路由、跨库迁移、未找到错误和注入开关语义。
 */
import { afterAll, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const root = join(tmpdir(), `opennovel-technique-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const directory = join(root, "project")
// 隔离全局通用技法库，避免测试污染真实数据；env 在首次 getGlobalDb() 调用前赋值即可。
process.env.OPENNOVEL_TECHNIQUE_DB = join(root, "global", "techniques.db")

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
    expect(created.library).toBe("book")

    const list = await Effect.runPromise(listTechniquesForDirectory(directory))
    expect(list.some((item) => item.id === created.id && item.library === "book")).toBe(true)

    const detail = await Effect.runPromise(getTechniqueForDirectory(created.id, directory))
    expect(detail.technique.id).toBe(created.id)
    expect(detail.technique.library).toBe("book")
    expect(detail.feedbacks).toEqual([])

    const updated = await Effect.runPromise(
      updateTechniqueForDirectory(created.id, directory, { instruction: "用沉默替代解释" }),
    )
    expect(updated.instruction).toBe("用沉默替代解释")
    // scope 未变（adult→book 库），不发生迁移
    expect(updated.library).toBe("book")

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

  test("list all 合并双库并带来源标记", async () => {
    mkdirSync(directory, { recursive: true })
    const bookItem = await Effect.runPromise(
      createTechniqueForDirectory(directory, { name: "本书技法", instruction: "书内用法", scope: "adult" }),
    )
    const globalItem = await Effect.runPromise(
      createTechniqueForDirectory(directory, {
        name: "通用技法",
        instruction: "跨书用法",
        scope: "general",
        targetLibrary: "global",
      }),
    )
    expect(bookItem.library).toBe("book")
    expect(globalItem.library).toBe("global")

    const all = await Effect.runPromise(listTechniquesForDirectory(directory, "all"))
    expect(all.find((item) => item.id === bookItem.id)?.library).toBe("book")
    expect(all.find((item) => item.id === globalItem.id)?.library).toBe("global")
    // 合并后统一按置信度、更新时间降序
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]
      const cur = all[i]
      const ordered = prev.confidence > cur.confidence ||
        (prev.confidence === cur.confidence && prev.updatedAt >= cur.updatedAt)
      expect(ordered).toBe(true)
    }

    // 缺省 list 只回本书库（兼容现状）
    const bookOnly = await Effect.runPromise(listTechniquesForDirectory(directory))
    expect(bookOnly.some((item) => item.id === globalItem.id)).toBe(false)
  })

  test("全局库拒绝受限技法", async () => {
    mkdirSync(directory, { recursive: true })
    const exit = await Effect.runPromiseExit(
      createTechniqueForDirectory(directory, {
        name: "受限技法",
        instruction: "受限内容",
        scope: "adult",
        targetLibrary: "global",
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return
    const error = Cause.squash(exit.cause) as TechniqueValidationError
    expect(error.name).toBe("TechniqueValidationError")
  })

  test("更新 scope 触发跨库迁移且反馈随迁", async () => {
    mkdirSync(directory, { recursive: true })
    const created = await Effect.runPromise(
      createTechniqueForDirectory(directory, { name: "迁移技法", instruction: "初始", scope: "adult" }),
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

    // adult → general：本书库迁全局库，id 不变
    const migrated = await Effect.runPromise(updateTechniqueForDirectory(created.id, directory, { scope: "general" }))
    expect(migrated.library).toBe("global")
    expect(migrated.scope).toBe("general")
    expect(migrated.id).toBe(created.id)

    const globalDetail = await Effect.runPromise(getTechniqueForDirectory(created.id, directory))
    expect(globalDetail.technique.library).toBe("global")
    expect(globalDetail.feedbacks).toHaveLength(1)

    const bookDetailExit = await Effect.runPromiseExit(getTechniqueForDirectory(created.id, directory, "book"))
    expect(Exit.isFailure(bookDetailExit)).toBe(true)

    // general → adult：迁回本书库，反馈随迁
    const migratedBack = await Effect.runPromise(updateTechniqueForDirectory(created.id, directory, { scope: "adult" }))
    expect(migratedBack.library).toBe("book")
    const bookDetail = await Effect.runPromise(getTechniqueForDirectory(created.id, directory))
    expect(bookDetail.technique.library).toBe("book")
    expect(bookDetail.feedbacks).toHaveLength(1)
  })

  test("双库回退定位后删除", async () => {
    mkdirSync(directory, { recursive: true })
    const globalItem = await Effect.runPromise(
      createTechniqueForDirectory(directory, {
        name: "待删",
        instruction: "x",
        scope: "general",
        targetLibrary: "global",
      }),
    )
    const deleted = await Effect.runPromise(deleteTechniqueForDirectory(globalItem.id, directory))
    expect(deleted.deleted).toBe(true)
    const all = await Effect.runPromise(listTechniquesForDirectory(directory, "all"))
    expect(all.some((item) => item.id === globalItem.id)).toBe(false)
  })

  test("注入开关缺省开启且写入保留其他字段", async () => {
    const configDir = join(root, "config-only")
    mkdirSync(join(configDir, ".novel"), { recursive: true })
    const configPath = join(configDir, ".novel", "config.json")
    writeFileSync(configPath, JSON.stringify({ name: "书", writing_mode: "review" }), "utf-8")

    // 配置缺 technique_injection 字段时按开启处理（缺省注入）
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

  test("单行坏数据不拖垮列表（单库与 all 两分支）", async () => {
    mkdirSync(directory, { recursive: true })
    const good = await Effect.runPromise(
      createTechniqueForDirectory(directory, { name: "合法技法", instruction: "在关键回应前插入沉默", scope: "adult" }),
    )
    // 直写坏行：证据缺必填 sourceTitle（模拟绕过协议校验的历史脏数据）
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

    for (const lib of ["book", "all"] as const) {
      const list = await Effect.runPromise(listTechniquesForDirectory(directory, lib))
      expect(list.some((item) => item.id === good.id)).toBe(true)
      expect(list.some((item) => item.id === "tech-bad-row")).toBe(false)
    }
  })
})
