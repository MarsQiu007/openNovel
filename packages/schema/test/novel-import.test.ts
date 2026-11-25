/**
 * 原文驱动导入契约单测（source-driven-import）。
 *
 * 覆盖 NovelImportStartInput / NovelImportControlInput 的解码往返与非法输入拒绝，
 * 以及进度/报告结构的最小合法样本往返。解析与状态机行为在 server/plugin 包测试。
 */
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  NovelImportStartInput,
  NovelImportControlInput,
  NovelImportProgress,
  NovelImportReport,
} from "../src/novel"

const startSample = {
  dataUrl: "data:text/plain;base64,5Zu+6Zui55qE5paH56ug",
  filename: "demo.txt",
  title: "演示书",
}

describe("NovelImportStartInput", () => {
  test("合法样本解码往返", () => {
    const decoded = Schema.decodeUnknownSync(NovelImportStartInput)(startSample)
    expect(decoded).toEqual(startSample)
  })

  test("可显式指定编码与目标章长", () => {
    const decoded = Schema.decodeUnknownSync(NovelImportStartInput)({
      ...startSample,
      encoding: "gb18030",
      targetChapterChars: 4000,
      repairLevel: "standard",
    })
    expect(decoded.encoding).toBe("gb18030")
    expect(decoded.targetChapterChars).toBe(4000)
    expect(decoded.repairLevel).toBe("standard")
  })

  test("拒绝空书名与未知修复强度", () => {
    expect(() => Schema.decodeUnknownSync(NovelImportStartInput)({ ...startSample, title: "" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(NovelImportStartInput)({ ...startSample, repairLevel: "deep" as never }),
    ).toThrow()
  })
})

describe("NovelImportControlInput", () => {
  test("四种动作往返", () => {
    for (const action of ["pause", "resume", "retry", "configure"] as const) {
      const decoded = Schema.decodeUnknownSync(NovelImportControlInput)({ action })
      expect(decoded.action).toBe(action)
    }
  })

  test("configure 可携带后续配置", () => {
    const decoded = Schema.decodeUnknownSync(NovelImportControlInput)({
      action: "configure",
      targetChapterChars: 2500,
      repairLevel: "off",
    })
    expect(decoded.targetChapterChars).toBe(2500)
    expect(decoded.repairLevel).toBe("off")
  })
})

describe("NovelImportProgress / NovelImportReport", () => {
  test("进度最小样本往返", () => {
    const sample = {
      novelId: "n1",
      jobId: "j1",
      sessionId: null,
      status: "calibrating" as const,
      phase: "calibration",
      processedChars: 1200,
      totalChars: 50000,
      progressRatio: 0.024,
      chapterCount: 1,
      calibrationReached: false,
      sourceExhausted: false,
      planVersion: 0,
      carryCount: 2,
      chapters: [
        { chapterId: "c1", order: 1, title: "第一章", wordCount: 1180, settingsStage: "pending", techniqueStage: "pending" },
      ],
    }
    expect(Schema.decodeUnknownSync(NovelImportProgress)(sample)).toEqual(sample)
  })

  test("报告最小样本往返", () => {
    const sample = {
      novelId: "n1",
      title: "演示书",
      chapterCount: 3,
      planVersion: 1,
      plannedCount: 12,
      opCounts: { keep: 20, merge: 3, exclude: 1 },
      excluded: [{ chapterId: "c2", reason: "广告", beforeText: "请记住本站" }],
      moveCount: 1,
      unresolvedCount: 0,
    }
    expect(Schema.decodeUnknownSync(NovelImportReport)(sample)).toEqual(sample)
  })
})
