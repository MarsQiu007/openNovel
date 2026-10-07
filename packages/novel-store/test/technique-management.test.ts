import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  bookHasAdultTechniques,
  closeDb,
  createTechnique,
  deleteTechnique,
  getTechnique,
  listTechniques,
  readContentNatureOverride,
  readTechniqueInjection,
  updateTechnique,
  writeContentNatureOverride,
  writeTechniqueInjection,
} from "../src/index"

let root = ""
let directory = ""

afterAll(() => {
  closeDb(directory)
  // Windows 下数据库句柄可能延迟释放，尽力清理临时目录
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
  }
})

describe("技法库管理", () => {
  beforeAll(() => {
    root = join(tmpdir(), `technique-management-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    directory = join(root, "project")
  })

  test("创建、更新和删除技法", async () => {
    mkdirSync(directory, { recursive: true })
    const created = await createTechnique(
      {
        name: "  对话节奏  ",
        instruction: "让对话保留沉默和打断",
        sceneTypes: ["dialogue"],
        level: "dialogue",
      },
      directory,
    )

    expect(created.name).toBe("对话节奏")
    expect(created.confidence).toBe(0.5)
    expect(created.status).toBe("unverified")
    expect(created.sceneTypes).toEqual(["dialogue"])

    const updated = await updateTechnique(created.id, { name: "对话留白", status: "verified" }, directory)
    expect(updated?.name).toBe("对话留白")
    expect(updated?.status).toBe("verified")

    const detail = await getTechnique(created.id, directory)
    expect(detail?.technique.id).toBe(created.id)
    expect(detail?.feedbacks).toEqual([])

    const list = await listTechniques(directory)
    expect(list.some((item) => item.id === created.id)).toBe(true)

    expect(await deleteTechnique(created.id, directory)).toBe(true)
    expect(await getTechnique(created.id, directory)).toBeNull()
    expect(await deleteTechnique(created.id, directory)).toBe(false)
  })

  test("注入开关读写保留既有配置字段", () => {
    mkdirSync(directory, { recursive: true })
    const configPath = join(directory, ".novel", "config.json")
    mkdirSync(join(directory, ".novel"), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ name: "书", writing_mode: "review" }), "utf-8")

    expect(readTechniqueInjection(directory)).toBe(true)
    expect(writeTechniqueInjection(directory, true)).toEqual({ enabled: true })
    expect(readTechniqueInjection(directory)).toBe(true)
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect(config.name).toBe("书")
    expect(config.writing_mode).toBe("review")
    expect(config.technique_injection).toBe(true)
    expect(existsSync(`${configPath}.bak`)).toBe(true)
  })

  test("书级内容性质覆盖读写、清除与非法值容忍", () => {
    const configPath = join(directory, ".novel", "config.json")
    expect(readContentNatureOverride(directory)).toBeUndefined()
    expect(writeContentNatureOverride(directory, "adult")).toEqual({ contentNatureOverride: "adult" })
    expect(readContentNatureOverride(directory)).toBe("adult")
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect(config.technique_injection).toBe(true)

    expect(writeContentNatureOverride(directory, null)).toEqual({ contentNatureOverride: null })
    expect(readContentNatureOverride(directory)).toBeUndefined()
    const cleared = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect("content_nature_override" in cleared).toBe(false)

    writeFileSync(configPath, JSON.stringify({ content_nature_override: "nsfw" }), "utf-8")
    expect(readContentNatureOverride(directory)).toBeUndefined()
    writeFileSync(configPath, JSON.stringify({ technique_injection: true }), "utf-8")
  })

  test("bookHasAdultTechniques 被动信号即时反映", async () => {
    expect(await bookHasAdultTechniques(directory)).toBe(false)
    const adult = await createTechnique(
      {
        name: "特定场景节奏",
        instruction: "特定场景中用呼吸与停顿控制张力",
        sceneTypes: ["description"],
        level: "description",
        scope: "adult",
      },
      directory,
    )
    expect(await bookHasAdultTechniques(directory)).toBe(true)
    await updateTechnique(adult.id, { scope: "general" }, directory)
    expect(await bookHasAdultTechniques(directory)).toBe(false)
    await deleteTechnique(adult.id, directory)
  })
})
