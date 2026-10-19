import { test, expect, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdirSync, mkdtempSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { getDb, getDbPath, NovelTable, CharacterTable, WorldEntryTable } from "@opennovel-ai/novel-store"
import {
  settingImagesList,
  settingImagesUpload,
  settingImagesRead,
  settingImagesUpdateNote,
  settingImagesReorder,
  settingImagesDelete,
} from "../src/handlers/novel"
import {
  SettingImageNotFoundError,
  SettingImageValidationError,
} from "@opennovel-ai/protocol/groups/novel"

let tempDir: string
let novelId: string
let characterId: string
let entryId: string

const PNG_DATA_URL = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]).toString("base64")}`

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "novel-setting-images-test-"))
  const db = getDb(tempDir)
  const now = Date.now()
  novelId = crypto.randomUUID()
  db.insert(NovelTable)
    .values({ id: novelId, title: "测试书", genre: "玄幻", synopsis: "", created_at: now, updated_at: now, status: "draft" })
    .run()
  characterId = crypto.randomUUID()
  db.insert(CharacterTable)
    .values({ id: characterId, novel_id: novelId, name: "主角", role: "support", status: "active", created_at: now })
    .run()
  entryId = crypto.randomUUID()
  db.insert(WorldEntryTable)
    .values({ id: entryId, novel_id: novelId, category: "地理", title: "北境", content: "", created_at: now })
    .run()
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下连接释放可能稍有延迟，尽力清理
  }
})

/** Effect 4 Cause 的失败原因在 reasons 数组（failures 仅 toJSON 暴露），取首个 Fail 的 error。 */
function firstFailureError(exit: { readonly _tag: string; readonly cause?: unknown }): unknown {
  if (exit._tag !== "Failure") return undefined
  const reasons = (exit.cause as { reasons?: ReadonlyArray<{ _tag: string; error?: unknown }> }).reasons
  return reasons?.[0]?.error
}

function imageFilePath(imageId: string) {
  return join(getDbPath(tempDir), "..", "images", novelId, `${imageId}.png`)
}

test("上传→列表→读取→说明→重排→删除 全链路", async () => {
  const uploaded = await Effect.runPromise(
    settingImagesUpload(novelId, tempDir, { ownerType: "character", ownerId: characterId, filename: "a.png", dataUrl: PNG_DATA_URL }),
  )
  expect(uploaded.ownerType).toBe("character")
  expect(uploaded.sortOrder).toBe(0)
  expect(existsSync(imageFilePath(uploaded.id))).toBe(true)

  const listed = await Effect.runPromise(settingImagesList(novelId, tempDir, "character", characterId))
  expect(listed.images.map((row) => row.id)).toEqual([uploaded.id])

  const content = await Effect.runPromise(settingImagesRead(novelId, tempDir, uploaded.id))
  expect(content.dataUrl.startsWith("data:image/png;base64,")).toBe(true)

  const noted = await Effect.runPromise(settingImagesUpdateNote(novelId, tempDir, uploaded.id, { note: "立绘" }))
  expect(noted.note).toBe("立绘")

  const second = await Effect.runPromise(
    settingImagesUpload(novelId, tempDir, { ownerType: "character", ownerId: characterId, dataUrl: PNG_DATA_URL }),
  )
  const reordered = await Effect.runPromise(
    settingImagesReorder(novelId, tempDir, {
      ownerType: "character",
      ownerId: characterId,
      orderedIds: [second.id, uploaded.id],
    }),
  )
  expect(reordered.images.map((row) => row.id)).toEqual([second.id, uploaded.id])

  const removed = await Effect.runPromise(settingImagesDelete(novelId, tempDir, uploaded.id))
  expect(removed.deleted).toBe(true)
  expect(existsSync(imageFilePath(uploaded.id))).toBe(false)
  const after = await Effect.runPromise(settingImagesList(novelId, tempDir, "character", characterId))
  expect(after.images.map((row) => row.id)).toEqual([second.id])
})

test("owner 不存在映射为 SettingImageNotFoundError", async () => {
  const failure = await Effect.runPromiseExit(
    settingImagesUpload(novelId, tempDir, { ownerType: "character", ownerId: "missing", dataUrl: PNG_DATA_URL }),
  )
  expect(failure._tag).toBe("Failure")
  if (failure._tag === "Failure") {
    expect(firstFailureError(failure)).toBeInstanceOf(SettingImageNotFoundError)
  }
})

test("校验失败映射为 SettingImageValidationError", async () => {
  const failure = await Effect.runPromiseExit(
    settingImagesUpload(novelId, tempDir, { ownerType: "character", ownerId: characterId, dataUrl: "not-a-data-url" }),
  )
  expect(failure._tag).toBe("Failure")
  if (failure._tag === "Failure") {
    expect(firstFailureError(failure)).toBeInstanceOf(SettingImageValidationError)
  }
})

test("跨小说读取与删除拒绝", async () => {
  const uploaded = await Effect.runPromise(
    settingImagesUpload(novelId, tempDir, { ownerType: "world_entry", ownerId: entryId, dataUrl: PNG_DATA_URL }),
  )
  const otherNovel = crypto.randomUUID()
  const db = getDb(tempDir)
  const now = Date.now()
  db.insert(NovelTable)
    .values({ id: otherNovel, title: "另一本", genre: "都市", synopsis: "", created_at: now, updated_at: now, status: "draft" })
    .run()

  const readFailure = await Effect.runPromiseExit(settingImagesRead(otherNovel, tempDir, uploaded.id))
  expect(readFailure._tag).toBe("Failure")
  if (readFailure._tag === "Failure") {
    expect(firstFailureError(readFailure)).toBeInstanceOf(SettingImageNotFoundError)
  }
  const deleteFailure = await Effect.runPromiseExit(settingImagesDelete(otherNovel, tempDir, uploaded.id))
  expect(deleteFailure._tag).toBe("Failure")
  if (deleteFailure._tag === "Failure") {
    expect(firstFailureError(deleteFailure)).toBeInstanceOf(SettingImageNotFoundError)
  }
})

test("重排 id 集不合映射为 SettingImageValidationError", async () => {
  const uploaded = await Effect.runPromise(
    settingImagesUpload(novelId, tempDir, { ownerType: "character", ownerId: characterId, dataUrl: PNG_DATA_URL }),
  )
  const failure = await Effect.runPromiseExit(
    settingImagesReorder(novelId, tempDir, { ownerType: "character", ownerId: characterId, orderedIds: [] }),
  )
  expect(failure._tag).toBe("Failure")
  if (failure._tag === "Failure") {
    expect(firstFailureError(failure)).toBeInstanceOf(SettingImageValidationError)
  }
  const listed = await Effect.runPromise(settingImagesList(novelId, tempDir, "character", characterId))
  expect(listed.images.map((row) => row.id)).toEqual([uploaded.id])
})
