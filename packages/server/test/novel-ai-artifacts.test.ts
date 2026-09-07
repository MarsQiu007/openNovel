import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  getDb,
  NovelTable,
  VolumeTable,
  ChapterTable,
  ChapterSummaryTable,
  HookRotationTable,
  VolumeSummaryTable,
  SegmentSummaryTable,
  closeDb,
} from "@opennovel-ai/novel-store"
import { listAiArtifacts } from "../src/handlers/novel"

let testDir: string
let db: ReturnType<typeof getDb>
const novelId = "novel-ai-artifacts"
const volumeId = "volume-1"
const chapterId = "chapter-1"

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "ai-artifacts-"))
  process.env.OPENNOVEL_DB = join(testDir, "novel.db")
  db = getDb(testDir)

  db.insert(NovelTable)
    .values({
      id: novelId,
      title: "AI 产出测试",
      genre: "玄幻",
      synopsis: "测试摘要和汇总读取",
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .run()

  db.insert(VolumeTable)
    .values({ id: volumeId, novel_id: novelId, title: "第一卷", order: 1, created_at: Date.now() })
    .run()

  db.insert(ChapterTable)
    .values({
      id: chapterId,
      novel_id: novelId,
      volume_id: volumeId,
      title: "第一章",
      content: "第一章内容",
      word_count: 6,
      status: "final",
      outline: "",
      order: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .run()

  db.insert(ChapterSummaryTable)
    .values({
      id: "summary-1",
      chapter_id: chapterId,
      summary: "主角进入宗门。",
      key_events: JSON.stringify(["主角入门", "发现灵脉"]),
      char_changes: JSON.stringify([]),
    })
    .run()

  for (let index = 0; index < 4; index++) {
    db.insert(HookRotationTable)
      .values({
        id: `hook-${index}`,
        novel_id: novelId,
        hook_type: "face_slap",
        chapter_id: chapterId,
        created_at: Date.now() + index,
      })
      .run()
  }

  db.insert(VolumeSummaryTable)
    .values({
      id: "volume-summary-1",
      volume_id: volumeId,
      summary: "第一卷围绕宗门试炼展开。",
      char_active: JSON.stringify(["林天"]),
      char_dormant: JSON.stringify([]),
      threads_open: JSON.stringify(["灵脉之谜"]),
      threads_closed: JSON.stringify([]),
    })
    .run()

  db.insert(SegmentSummaryTable)
    .values({
      id: "segment-summary-1",
      novel_id: novelId,
      start_chapter: 1,
      end_chapter: 1,
      summary: "第1章建立了修炼目标。",
      created_at: Date.now(),
    })
    .run()
})

afterAll(() => {
  closeDb(testDir)
  delete process.env.OPENNOVEL_DB
})

describe("listAiArtifacts", () => {
  test("聚合章节摘要、钩子统计、卷汇总和段汇总", async () => {
    const result = await Effect.runPromise(listAiArtifacts(novelId, testDir))

    expect(result.chapterSummaries).toHaveLength(1)
    expect(result.chapterSummaries[0]).toMatchObject({
      chapterId,
      chapterOrder: 1,
      title: "第一章",
      summary: "主角进入宗门。",
    })
    expect(result.chapterSummaries[0]?.keyEvents).toEqual(["主角入门", "发现灵脉"])

    expect(result.hookRotation.records).toHaveLength(4)
    expect(result.hookRotation.counts).toEqual({ face_slap: 4 })
    expect(result.hookRotation.warning).toContain("已连续使用 4 次")

    expect(result.volumeSummaries).toHaveLength(1)
    expect(result.volumeSummaries[0]).toMatchObject({
      volumeId,
      volumeOrder: 1,
      volumeTitle: "第一卷",
      charActive: ["林天"],
      threadsOpen: ["灵脉之谜"],
    })

    expect(result.segmentSummaries).toEqual([
      { startChapter: 1, endChapter: 1, summary: "第1章建立了修炼目标。" },
    ])
  })

  test("小说不存在时返回未找到错误", async () => {
    const result = Effect.runPromise(listAiArtifacts("missing-novel", testDir))
    expect(result).rejects.toThrow()
  })
})