import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
import { ChapterTable, closeDb, getDb, NovelTable, VolumeTable } from "@opennovel-ai/novel-store"
import { exportNovel } from "../src/handlers/novel"

let testDir: string
let db: ReturnType<typeof getDb>
const novelId = "novel-export"

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "novel-export-"))
  process.env.OPENNOVEL_DB = join(testDir, "novel.db")
  db = getDb(testDir)

  db.insert(NovelTable)
    .values({
      id: novelId,
      title: "导出测试",
      genre: "玄幻",
      synopsis: "这是导出测试简介。",
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .run()

  db.insert(VolumeTable)
    .values({ id: "volume-1", novel_id: novelId, title: "第一卷", order: 1, created_at: Date.now() })
    .run()
  db.insert(VolumeTable)
    .values({ id: "volume-2", novel_id: novelId, title: "第二卷", order: 2, created_at: Date.now() })
    .run()

  const chapters = [
    { id: "chapter-1", volume_id: "volume-1", title: "第一章", content: "第一卷正文，包含<标签>和&符号。", order: 1 },
    { id: "chapter-empty", volume_id: "volume-1", title: "空章", content: "   ", order: 2 },
    { id: "chapter-2", volume_id: "volume-1", title: "第二章", content: "第一卷后续正文。", order: 3 },
    { id: "chapter-3", volume_id: "volume-2", title: "第三章", content: "第二卷正文。", order: 4 },
    { id: "chapter-orphan", volume_id: null, title: "孤儿章", content: "孤儿章正文。", order: 5 },
  ]
  for (const chapter of chapters) {
    db.insert(ChapterTable)
      .values({
        ...chapter,
        novel_id: novelId,
        word_count: chapter.content.length,
        status: "final",
        outline: "",
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .run()
  }
})

afterAll(() => {
  closeDb(testDir)
  delete process.env.OPENNOVEL_DB
})

describe("exportNovel", () => {
  test("Markdown 按卷、章顺序导出并追加孤儿章", async () => {
    const result = await Effect.runPromise(exportNovel(novelId, testDir))
    const first = result.content.indexOf("第一章")
    const empty = result.content.indexOf("空章")
    const second = result.content.indexOf("第二章")
    const third = result.content.indexOf("第三章")
    const orphan = result.content.indexOf("孤儿章")

    expect(result.filename).toBe("导出测试.md")
    expect(result.content).toContain("# 导出测试")
    expect(result.content).toContain("这是导出测试简介。")
    expect(result.content).toContain("## 第一卷")
    expect(result.content).toContain("## 第二卷")
    expect(first).toBeGreaterThan(-1)
    expect(empty).toBe(-1)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
    expect(orphan).toBeGreaterThan(third)
  })

  test("TXT 是不带 Markdown 标记的 UTF-8 文本", async () => {
    const result = await Effect.runPromise(exportNovel(novelId, testDir, "txt"))

    expect(result.filename).toBe("导出测试.txt")
    expect(result.encoding).toBe("utf8")
    expect(result.content).toContain("第一卷")
    expect(result.content).toContain("第二章\n第一卷后续正文。")
    expect(result.content).not.toContain("## 第一卷")
    expect(result.content).not.toContain("### 第二章")
  })

  test("EPUB 是 Base64 编码的合法容器并保留章节顺序", async () => {
    const result = await Effect.runPromise(exportNovel(novelId, testDir, "epub"))

    expect(result.filename).toBe("导出测试.epub")
    expect(result.encoding).toBe("base64")
    const epub = new Blob([new Uint8Array(Buffer.from(result.content, "base64"))])
    const reader = new ZipReader(new BlobReader(epub))
    const entries = await reader.getEntries()
    const names = entries.map((entry) => entry.filename)

    expect(names).toEqual(
      expect.arrayContaining([
        "mimetype",
        "META-INF/container.xml",
        "OEBPS/content.opf",
        "OEBPS/nav.xhtml",
        "OEBPS/toc.ncx",
        "OEBPS/chapter-1.xhtml",
        "OEBPS/chapter-4.xhtml",
      ]),
    )

    const mimetype = entries.find((entry) => entry.filename === "mimetype")
    expect(mimetype).toBeDefined()
    expect(mimetype!.compressedSize).toBe(mimetype!.uncompressedSize)
    expect(await mimetype!.getData!(new TextWriter())).toBe("application/epub+zip")

    const opf = entries.find((entry) => entry.filename === "OEBPS/content.opf")
    expect(await opf!.getData!(new TextWriter())).toContain("<dc:creator>未知作者</dc:creator>")

    const chapter1 = entries.find((entry) => entry.filename === "OEBPS/chapter-1.xhtml")
    const chapter1Content = await chapter1!.getData!(new TextWriter())
    expect(chapter1Content).toContain("&lt;标签&gt;和&amp;符号。")

    const nav = entries.find((entry) => entry.filename === "OEBPS/nav.xhtml")
    const navContent = await nav!.getData!(new TextWriter())
    expect(navContent.indexOf("第一章")).toBeLessThan(navContent.indexOf("第二章"))
    expect(navContent.indexOf("第三章")).toBeLessThan(navContent.indexOf("孤儿章"))

    await reader.close()
  })

  test("小说不存在时返回未找到错误", () => {
    expect(Effect.runPromise(exportNovel("missing-novel", testDir))).rejects.toThrow()
  })
})