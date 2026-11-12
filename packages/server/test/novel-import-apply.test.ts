/**
 * 书籍导入编排集成测试（book-import · analyze/apply 经 Effect HTTP 全管线）。
 *
 * 覆盖：预览往返、token 一致性校验（改内容/改参数/坏 token 均预览过期）、
 * 事务化建书（书/卷/章 + 初始正文 + 字数，不落 chapter_versions）、
 * 未识别边界的拒绝与等长兜底、~50 MiB 原文（~68 MB base64 载荷）大文件承载。
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  closeDb,
  getDb,
  NovelTable,
  VolumeTable,
  ChapterTable,
  ChapterVersionTable,
} from "@opennovel-ai/novel-store"
import { createEmbeddedRoutes } from "../src/routes"

let tempDir: string
let handler: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }

function url(path: string) {
  return `http://localhost${path}?location[directory]=${encodeURIComponent(tempDir)}`
}

function api(path: string, init?: RequestInit) {
  return handler.handler(new Request(url(path), init))
}

function post(path: string, payload: unknown) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

function toDataUrl(text: string): string {
  return `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`
}

const MANUSCRIPT = [
  "第一卷 风起天南",
  "第一章 开局",
  "清晨的风从东方吹来",
  "带着一丝凉意。",
  "第二章 发展",
  "第二回正文，带半角标点,哦。",
  "第二卷 纵横天下",
  "第三章 转折",
  "卷二正文。",
].join("\n")

async function analyze(payload: Record<string, unknown>) {
  const res = await post("/api/novel/import/analyze", payload)
  expect(res.status).toBe(200)
  return readJson(res)
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "novel-import-apply-"))
  handler = HttpRouter.toWebHandler(createEmbeddedRoutes().pipe(Layer.provide(HttpServer.layerServices)), {
    disableLogger: true,
  }) as { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
})

afterAll(() => {
  handler.dispose().catch(() => {})
  closeDb(tempDir)
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 SQLite 句柄偶发延迟释放，忽略清理失败
  }
})

describe("novel.import.analyze", () => {
  test("常规书稿解析出卷章树/问题清单/清洗摘要与 token", async () => {
    const body = await analyze({ dataUrl: toDataUrl(MANUSCRIPT), filename: "demo.txt", cleanEnabled: true })
    expect(body.suggestedTitle).toBe("demo")
    expect(body.encoding).toBe("utf-8")
    const volumes = body.volumes as Array<{
      title: string | null
      chapters: Array<{ title: string; wordCount: number; contentHash: string }>
    }>
    expect(volumes).toHaveLength(2)
    expect(volumes[0]!.title).toBe("第一卷 风起天南")
    expect(volumes[0]!.chapters.map((chapter) => chapter.title)).toEqual(["第一章 开局", "第二章 发展"])
    expect(volumes[1]!.chapters.map((chapter) => chapter.title)).toEqual(["第三章 转折"])
    expect(volumes[0]!.chapters[0]!.wordCount).toBeGreaterThan(0)
    expect(typeof body.previewToken).toBe("string")
    const summary = body.cleanSummary as Record<string, number>
    expect(summary.linesMerged).toBeGreaterThan(0)
    expect(summary.punctuationNormalized).toBeGreaterThan(0)
  })

  test("未识别边界如实上报，volumes 为空", async () => {
    const body = await analyze({
      dataUrl: toDataUrl("完全没有章节标题的散文内容。"),
      filename: "plain.txt",
      cleanEnabled: false,
    })
    expect(body.volumes).toEqual([])
    const issues = body.issues as Array<{ type: string }>
    expect(issues[0]!.type).toBe("unrecognized-boundary")
  })
})

describe("novel.import.apply", () => {
  const baseInput = { filename: "demo.txt", cleanEnabled: true }

  test("analyze → apply 事务化建书，正文/字数/卷归属正确且不落版本", async () => {
    const preview = await analyze({ dataUrl: toDataUrl(MANUSCRIPT), ...baseInput })
    const res = await post("/api/novel/import/apply", {
      ...baseInput,
      dataUrl: toDataUrl(MANUSCRIPT),
      previewToken: preview.previewToken,
      title: "导入 Demo",
    })
    expect(res.status).toBe(200)
    const report = await readJson(res)
    expect(report.title).toBe("导入 Demo")
    expect(report.volumeCount).toBe(2)
    expect(report.chapterCount).toBe(3)

    const db = getDb(tempDir)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.title, "导入 Demo")).get()!
    expect(novel.genre).toBe("玄幻")
    const volumes = db.select().from(VolumeTable).where(eq(VolumeTable.novel_id, novel.id)).all()
    expect(volumes.map((volume) => volume.title)).toEqual(["第一卷 风起天南", "第二卷 纵横天下"])
    const chapters = db
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, novel.id))
      .all()
      .sort((a, b) => a.order - b.order)
    expect(chapters.map((chapter) => chapter.order)).toEqual([1, 2, 3])
    expect(chapters[0]!.volume_id).toBe(volumes[0]!.id)
    expect(chapters[2]!.volume_id).toBe(volumes[1]!.id)
    expect(chapters[0]!.content).toContain("带着一丝凉意。")
    expect(chapters[0]!.word_count).toBeGreaterThan(0)
    const chapterIds = new Set(chapters.map((chapter) => chapter.id))
    const versions = db
      .select()
      .from(ChapterVersionTable)
      .all()
      .filter((version) => chapterIds.has(version.chapter_id))
    expect(versions).toEqual([])
  })

  test("正文被改（token 哈希不符）返回预览过期且不建书", async () => {
    const preview = await analyze({ dataUrl: toDataUrl(MANUSCRIPT), ...baseInput })
    const before = getDb(tempDir).select({ id: NovelTable.id }).from(NovelTable).all().length
    const res = await post("/api/novel/import/apply", {
      ...baseInput,
      dataUrl: toDataUrl(MANUSCRIPT + "多了几句。"),
      previewToken: preview.previewToken,
      title: "不应建成",
    })
    expect(res.status).toBe(400)
    const after = getDb(tempDir).select({ id: NovelTable.id }).from(NovelTable).all().length
    expect(after).toBe(before)
  })

  test("解析参数漂移（清洗开关）返回预览过期", async () => {
    const preview = await analyze({ dataUrl: toDataUrl(MANUSCRIPT), ...baseInput })
    const res = await post("/api/novel/import/apply", {
      ...baseInput,
      cleanEnabled: false,
      dataUrl: toDataUrl(MANUSCRIPT),
      previewToken: preview.previewToken,
      title: "不应建成",
    })
    expect(res.status).toBe(400)
  })

  test("非法 token 返回预览过期", async () => {
    const res = await post("/api/novel/import/apply", {
      ...baseInput,
      dataUrl: toDataUrl(MANUSCRIPT),
      previewToken: "not-a-token",
      title: "不应建成",
    })
    expect(res.status).toBe(400)
  })

  test("未识别边界且未开兜底：拒绝建书且不留半成品", async () => {
    const plain = toDataUrl("一篇没有任何章节标题的长文。它就这样一直写下去。")
    const preview = await analyze({ dataUrl: plain, filename: "plain.txt", cleanEnabled: false })
    const before = getDb(tempDir).select({ id: NovelTable.id }).from(NovelTable).all().length
    const res = await post("/api/novel/import/apply", {
      dataUrl: plain,
      filename: "plain.txt",
      cleanEnabled: false,
      previewToken: preview.previewToken,
      title: "不应建成",
    })
    expect(res.status).toBe(400)
    const after = getDb(tempDir).select({ id: NovelTable.id }).from(NovelTable).all().length
    expect(after).toBe(before)
  })

  test("等长兜底：未识别边界按固定长度分章建书", async () => {
    const body = "字".repeat(7000)
    const dataUrl = toDataUrl(body)
    const preview = await analyze({
      dataUrl,
      filename: "long.txt",
      cleanEnabled: false,
      fallbackFixedLength: true,
    })
    const volumes = preview.volumes as Array<{ chapters: unknown[] }>
    expect(volumes[0]!.chapters).toHaveLength(3)
    const res = await post("/api/novel/import/apply", {
      dataUrl,
      filename: "long.txt",
      cleanEnabled: false,
      fallbackFixedLength: true,
      previewToken: preview.previewToken,
      title: "等长兜底书",
    })
    expect(res.status).toBe(200)
    const report = await readJson(res)
    expect(report.chapterCount).toBe(3)
    expect(report.volumeCount).toBe(1)
  })
})

describe("novel.import 大载荷承载", () => {
  test("~48 MiB 原文（~64 MB base64 请求体）可完成 analyze", async () => {
    // 单章长文：按字节逼近 50 MiB 上限（汉字 UTF-8 三字节，须按字节计），验证 Effect HTTP 对超大 base64 载荷的承载。
    // 两行正文交替（去重只清连续相同行），避免机械去重把重复段落消掉。
    const paraA = "甲段落内容，验证大载荷承载。".repeat(400)
    const paraB = "乙段落内容，验证大载荷承载。".repeat(400)
    const paragraphBytes = Buffer.byteLength(paraA, "utf8")
    const chunks: string[] = ["第一章 巨章"]
    let totalBytes = 0
    while (totalBytes < 48 * 1024 * 1024) {
      chunks.push(chunks.length % 2 === 0 ? paraA : paraB)
      totalBytes += paragraphBytes
    }
    const dataUrl = `data:text/plain;base64,${Buffer.from(chunks.join("\n"), "utf8").toString("base64")}`
    const res = await post("/api/novel/import/analyze", { dataUrl, filename: "huge.txt", cleanEnabled: true })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.encoding).toBe("utf-8")
    const volumes = body.volumes as Array<{ chapters: Array<{ wordCount: number }> }>
    expect(volumes[0]!.chapters).toHaveLength(1)
    expect(volumes[0]!.chapters[0]!.wordCount).toBeGreaterThan(10_000_000)
  }, 120_000)
})
