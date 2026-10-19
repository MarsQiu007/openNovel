import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import {
  CharacterTable,
  NovelTable,
  SettingImageTable,
  WorldEntryTable,
  deleteCharacter,
  deleteSettingImage,
  deleteWorldEntry,
  getDb,
  getDbPath,
  listSettingImages,
  readSettingImage,
  reorderSettingImages,
  SettingImageStoreError,
  updateSettingImageNote,
  uploadSettingImage,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `setting-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下连接释放可能稍有延迟，尽力清理
  }
})

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

function pngDataUrl(payloadBytes = 64) {
  const buffer = Buffer.concat([PNG_MAGIC, Buffer.alloc(payloadBytes, 7)])
  return `data:image/png;base64,${buffer.toString("base64")}`
}

function jpegDataUrl() {
  return `data:image/jpeg;base64,${Buffer.concat([JPEG_MAGIC, Buffer.alloc(32, 3)]).toString("base64")}`
}

function imagesDirFor(novelId: string) {
  return join(getDbPath(projectDir), "..", "images", novelId)
}

function imageFilePath(novelId: string, imageId: string, ext = "png") {
  return join(imagesDirFor(novelId), `${imageId}.${ext}`)
}

async function seedNovel(novelId = "novel-1") {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  return novelId
}

async function seedCharacter(novelId: string, characterId = "char-1") {
  const db = getDb(projectDir)
  await db
    .insert(CharacterTable)
    .values({ id: characterId, novel_id: novelId, name: "主角", role: "support", status: "active", created_at: 1 })
    .run()
  return characterId
}

async function seedWorldEntry(novelId: string, entryId = "world-1") {
  const db = getDb(projectDir)
  await db
    .insert(WorldEntryTable)
    .values({ id: entryId, novel_id: novelId, category: "地理", title: "北境", content: "", created_at: 1 })
    .run()
  return entryId
}

async function uploadFor(novelId: string, ownerId: string, ownerType: "world_entry" | "character" = "character") {
  return uploadSettingImage(novelId, { ownerType, ownerId, filename: "a.png", dataUrl: pngDataUrl() }, projectDir)
}

test("上传落行落文件，元数据完整", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const image = await uploadFor(novelId, characterId)
  expect(image.owner_type).toBe("character")
  expect(image.owner_id).toBe(characterId)
  expect(image.mime).toBe("image/png")
  expect(image.sort_order).toBe(0)
  expect(image.bytes).toBeGreaterThan(0)
  expect(image.filename).toBe("a.png")
  expect(existsSync(imageFilePath(novelId, image.id))).toBe(true)
  const onDisk = readFileSync(imageFilePath(novelId, image.id))
  expect(onDisk[0]).toBe(0x89)
})

test("新图排在既有图片末尾，列表稳定排序", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const first = await uploadFor(novelId, characterId)
  const second = await uploadFor(novelId, characterId)
  expect(second.sort_order).toBe(first.sort_order + 1)
  const listed = await listSettingImages(novelId, "character", characterId, projectDir)
  expect(listed.map((row) => row.id)).toEqual([first.id, second.id])
})

test("owner 不存在拒绝", async () => {
  const novelId = await seedNovel()
  await expect(
    uploadSettingImage(novelId, { ownerType: "character", ownerId: "missing", dataUrl: pngDataUrl() }, projectDir),
  ).rejects.toThrow("归属实体不存在")
})

test("非白名单 MIME 拒绝且不落文件", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`
  await expect(
    uploadSettingImage(novelId, { ownerType: "character", ownerId: characterId, dataUrl: svg }, projectDir),
  ).rejects.toThrow("不支持的图片类型")
})

test("魔数与声明 MIME 不符拒绝", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const fake = `data:image/png;base64,${Buffer.from("plain text, not an image").toString("base64")}`
  await expect(
    uploadSettingImage(novelId, { ownerType: "character", ownerId: characterId, dataUrl: fake }, projectDir),
  ).rejects.toThrow("与声明的 MIME 不符")
})

test("data URL 格式非法拒绝", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  await expect(
    uploadSettingImage(novelId, { ownerType: "character", ownerId: characterId, dataUrl: "not-a-data-url" }, projectDir),
  ).rejects.toThrow("data URL 格式不合法")
})

test("解码后超上限拒绝", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const oversized = `data:image/png;base64,${Buffer.concat([PNG_MAGIC, Buffer.alloc(5 * 1024 * 1024 + 1)]).toString("base64")}`
  await expect(
    uploadSettingImage(novelId, { ownerType: "character", ownerId: characterId, dataUrl: oversized }, projectDir),
  ).rejects.toThrow("超过上限")
})

test("每 owner 张数上限拒绝", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  for (let i = 0; i < 20; i++) await uploadFor(novelId, characterId)
  await expect(uploadFor(novelId, characterId)).rejects.toThrow("最多")
})

test("不同 owner 的图片互不干扰，白名单内多格式可上传", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const entryId = await seedWorldEntry(novelId)
  const charImage = await uploadFor(novelId, characterId)
  const entryImage = await uploadSettingImage(
    novelId,
    { ownerType: "world_entry", ownerId: entryId, dataUrl: jpegDataUrl() },
    projectDir,
  )
  expect(entryImage.mime).toBe("image/jpeg")
  expect(entryImage.owner_type).toBe("world_entry")
  const charImages = await listSettingImages(novelId, "character", characterId, projectDir)
  expect(charImages.map((row) => row.id)).toEqual([charImage.id])
})

test("读取返回一致 MIME 的 dataUrl，跨小说访问拒绝", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const image = await uploadFor(novelId, characterId)
  const content = await readSettingImage(novelId, image.id, projectDir)
  expect(content.dataUrl.startsWith("data:image/png;base64,")).toBe(true)
  await seedNovel("novel-2")
  await expect(readSettingImage("novel-2", image.id, projectDir)).rejects.toThrow("图片不存在")
})

test("删除清理行与文件", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const image = await uploadFor(novelId, characterId)
  const filePath = imageFilePath(novelId, image.id)
  expect(existsSync(filePath)).toBe(true)
  await deleteSettingImage(novelId, image.id, projectDir)
  expect(existsSync(filePath)).toBe(false)
  const listed = await listSettingImages(novelId, "character", characterId, projectDir)
  expect(listed).toEqual([])
})

test("删除时文件已缺失仍成功", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const image = await uploadFor(novelId, characterId)
  unlinkSync(imageFilePath(novelId, image.id))
  await deleteSettingImage(novelId, image.id, projectDir)
  const listed = await listSettingImages(novelId, "character", characterId, projectDir)
  expect(listed).toEqual([])
})

test("说明编辑只动 note 字段", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const image = await uploadFor(novelId, characterId)
  const updated = await updateSettingImageNote(novelId, image.id, "主角立绘", projectDir)
  expect(updated.note).toBe("主角立绘")
  expect(updated.mime).toBe(image.mime)
  expect(updated.sort_order).toBe(image.sort_order)
  expect(updated.bytes).toBe(image.bytes)
})

test("重排持久化新顺序", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const [a, b, c] = [await uploadFor(novelId, characterId), await uploadFor(novelId, characterId), await uploadFor(novelId, characterId)]
  await reorderSettingImages(novelId, "character", characterId, [c.id, a.id, b.id], projectDir)
  const listed = await listSettingImages(novelId, "character", characterId, projectDir)
  expect(listed.map((row) => row.id)).toEqual([c.id, a.id, b.id])
})

test("重排 id 集不合拒绝且顺序不变", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const entryId = await seedWorldEntry(novelId)
  const [a, b] = [await uploadFor(novelId, characterId), await uploadFor(novelId, characterId)]
  const foreign = await uploadFor(novelId, entryId, "world_entry")
  await expect(
    reorderSettingImages(novelId, "character", characterId, [b.id], projectDir),
  ).rejects.toThrow("重排列表与当前图片集不一致")
  await expect(
    reorderSettingImages(novelId, "character", characterId, [a.id, b.id, foreign.id], projectDir),
  ).rejects.toThrow("重排列表与当前图片集不一致")
  const listed = await listSettingImages(novelId, "character", characterId, projectDir)
  expect(listed.map((row) => row.id)).toEqual([a.id, b.id])
})

test("删除世界观条目级联清理图片", async () => {
  const novelId = await seedNovel()
  const entryId = await seedWorldEntry(novelId)
  const a = await uploadFor(novelId, entryId, "world_entry")
  const b = await uploadFor(novelId, entryId, "world_entry")
  expect(existsSync(imageFilePath(novelId, a.id))).toBe(true)
  expect(existsSync(imageFilePath(novelId, b.id))).toBe(true)
  await deleteWorldEntry(entryId, projectDir)
  const db = getDb(projectDir)
  const rows = await db.select().from(SettingImageTable).all()
  expect(rows).toEqual([])
  expect(existsSync(imageFilePath(novelId, a.id))).toBe(false)
  expect(existsSync(imageFilePath(novelId, b.id))).toBe(false)
})

test("删除角色级联清理图片；文件缺失不阻断", async () => {
  const novelId = await seedNovel()
  const characterId = await seedCharacter(novelId)
  const image = await uploadFor(novelId, characterId)
  unlinkSync(imageFilePath(novelId, image.id))
  await deleteCharacter(characterId, projectDir)
  const db = getDb(projectDir)
  const rows = await db.select().from(SettingImageTable).all()
  expect(rows).toEqual([])
})

describe("setting-images schema 约束", () => {
  test("owner_type CHECK 拒绝非法归属类型", async () => {
    const novelId = await seedNovel()
    const db = getDb(projectDir)
    expect(() =>
      db
        .insert(SettingImageTable)
        .values({
          id: "img-bad",
          novel_id: novelId,
          owner_type: "plot_thread",
          owner_id: "whatever",
          mime: "image/png",
          bytes: 10,
          created_at: 1,
        })
        .run(),
    ).toThrow()
  })
})
