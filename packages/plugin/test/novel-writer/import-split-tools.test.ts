/**
 * AI 拆章执行器工具测试（narrative-unit-split 任务 2.5 执行器部分）
 *
 * 覆盖：句流窗口与衔接、章题强边界、句末/引号闭合硬校验、游标一致与单调、
 * 分段不改正文、字数偏差拒绝、无存档与游标错位失败、全书耗尽。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { countWords } from "@opennovel-ai/schema/schema"
import { ChapterTable, getDb, getNovelArchive, NovelArchiveTable, NovelTable } from "../../src/novel-writer/session-store.js"
import { parseCleanerOutput } from "../../src/novel-writer/cleaner-contract.js"
import { parseCutterOutput } from "../../src/novel-writer/cutter-contract.js"
import { importSplitTools } from "../../src/novel-writer/tools/import-split.js"
import { createToolContext } from "./runtime-assembly-helpers.js"

const NOVEL_ID = "novel-ai-split"
const ARCHIVE_PATH = ".opennovel/sources/" + NOVEL_ID + ".txt"

// 无章题书：两段各两句，句流 4 单元
const TEXT_PLAIN = ["他推开门。屋内一片漆黑。", "雨下了一整夜。他始终没有说话。"].join("\n\n")
// 章题书：两个章题行 + 每章两句
const TEXT_HEADED = ["第一章 启程", "清晨出发。山路难行。", "第二章 遇险", "夜宿破庙。忽闻异响。"].join("\n\n")

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), "import-split-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8))
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

function toolCtx() {
  return createToolContext(projectDir)
}

async function setupAiBook(text: string, splitCursor = 0) {
  const db = getDb(projectDir)
  db
    .insert(NovelTable)
    .values({ id: NOVEL_ID, title: "AI拆章测试", genre: "都市", synopsis: "", status: "draft", created_at: 1, updated_at: 1, split_mode: "ai" })
    .run()
  mkdirSync(join(projectDir, ".opennovel", "sources"), { recursive: true })
  writeFileSync(join(projectDir, ARCHIVE_PATH), text, "utf8")
  db
    .insert(NovelArchiveTable)
    .values({
      id: "archive-1",
      novel_id: NOVEL_ID,
      content_hash: "test-hash",
      encoding: "utf-8",
      word_count: countWords(text),
      file_path: ARCHIVE_PATH,
      split_cursor: splitCursor,
      created_at: 1,
      updated_at: 1,
    })
    .run()
}

async function expectFailure(promise: Promise<unknown>, category: string, messagePart: string) {
  try {
    await promise
    throw new Error("期望工具失败未发生：" + category)
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    expect(failure.name).toBe(category)
    expect(failure.message).toContain(messagePart)
  }
}

describe("import_split_window", () => {
  test("无章题书：句流编号 + 前文衔接 + 剩余提示", async () => {
    await setupAiBook(TEXT_PLAIN)
    const result = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    const metadata = result.metadata
    expect(metadata?.window_cursor).toBe(0)
    expect(metadata?.sentence_count).toBe(4)
    expect(result.output).toContain("1. 他推开门。")
    expect(result.output).toContain("4. 他始终没有说话。")
    expect(result.output).toContain("无（全书开头）")
  })

  test("章题书：章题行以【章题】标记为强边界信号", async () => {
    await setupAiBook(TEXT_HEADED)
    const result = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(result.output).toContain("【章题】1. 第一章 启程")
    expect(result.output).toContain("【章题】4. 第二章 遇险")
  })

  test("无存档书籍不可用", async () => {
    await expectFailure(
      importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx()),
      "not_found",
      "未找到原文存档",
    )
  })

  test("原文引号缺陷：无平衡切点时输出存档警示且游标保留", async () => {
    // 游标后缺失右引号：所有句末 balance 不归零，句流只剩单一巨型单元
    await setupAiBook("“整段没有闭合引号一直说到结尾也没有右引号，句号也全在引号里面。")
    const result = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(result.output).toContain("存档警示")
    expect(result.output).toContain("缺失的右引号")
    expect(result.output).toContain("先修复原文再继续")
    expect(result.metadata?.window_cursor).toBe(0)
  })

  test("后文超大句流单元时不得误导为全书末尾", async () => {
    // 前几句很短，后文因引号缺陷被并成超大单元：窗口受硬上限截断但全书未耗尽
    const text = "他推开门。屋内一片漆黑。雨停了。\n\n“" + "这一段一直没有闭合引号。".repeat(1200)
    await setupAiBook(text)
    const result = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(Number(result.metadata?.remaining_word_count)).toBeGreaterThan(0)
    expect(result.output).not.toContain("已到全书末尾")
    expect(result.output).toContain("后文仍有约")
    expect(result.output).toContain("超大句流单元")
  })

  test("游标与句流不对齐时拒绝组章", async () => {
    await setupAiBook(TEXT_PLAIN, 3)
    await expectFailure(
      importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx()),
      "gate_blocked",
      "不对齐",
    )
  })

  test("全书组章完成后返回耗尽", async () => {
    await setupAiBook("只有一句。")
    const first = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 1 },
      toolCtx(),
    )
    const extractMeta = first.metadata
    await importSplitTools.import_split_commit.execute(
      {
        novel_id: NOVEL_ID,
        title: "孤章",
        content: "只有一句。",
        window_cursor: 0,
        end_offset: Number(extractMeta?.end_offset),
        raw_word_count: Number(extractMeta?.raw_word_count),
      },
      toolCtx(),
    )
    const second = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect((second.metadata).exhausted).toBe(true)
  })
})

describe("import_split_extract", () => {
  test("切章 + 分段点重排，且分段不改正文", async () => {
    await setupAiBook(TEXT_PLAIN)
    const result = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2, segments: [2] },
      toolCtx(),
    )
    const metadata = result.metadata
    // 落章参数必须模型可见：commit 的 window_cursor/end_offset/raw_word_count 写进输出文本
    expect(result.output).toContain("window_cursor=0")
    expect(result.output).toContain("end_offset=" + Number(metadata?.end_offset))
    expect(result.output).toContain("raw_word_count=" + Number(metadata?.raw_word_count))
    expect(metadata?.chapter_text).toBe("他推开门。\n\n屋内一片漆黑。")
    expect(Number(metadata?.raw_word_count)).toBe(countWords("他推开门。屋内一片漆黑。"))
    // 分段不改正文：去空白后与原文切片逐字一致
    const rawSlice = TEXT_PLAIN.slice(0, Number(metadata?.end_offset))
    expect(metadata?.chapter_text.replace(/\s+/g, "")).toBe(rawSlice.replace(/\s+/g, ""))
  })

  test("章题强边界：章末句必须落在章题行前一句", async () => {
    await setupAiBook(TEXT_HEADED)
    const ok = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 3 },
      toolCtx(),
    )
    const metadata = ok.metadata
    expect(metadata?.title_hint).toBe("第一章 启程")
    expect(ok.output).toContain("第一章 启程")
    await expectFailure(
      importSplitTools.import_split_extract.execute({ novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 }, toolCtx()),
      "content_rejected",
      "章题强边界",
    )
  })

  test("引号未闭合处收章被拒绝", async () => {
    const text = "他说：“今天来。明天走。"
    await setupAiBook(text)
    await expectFailure(
      importSplitTools.import_split_extract.execute({ novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 1 }, toolCtx()),
      "content_rejected",
      "引号未闭合",
    )
  })

  test("游标已推进时拒绝过期窗口", async () => {
    await setupAiBook(TEXT_PLAIN)
    // extract 只校验不改游标；模拟游标已推进：先落一章再对同窗口重切
    const first = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 },
      toolCtx(),
    )
    const metadata = first.metadata
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "第一章", content: "他推开门。\n\n屋内一片漆黑。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
      toolCtx(),
    )
    await expectFailure(
      importSplitTools.import_split_extract.execute({ novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 }, toolCtx()),
      "gate_blocked",
      "窗口过期",
    )
  })
})

describe("import_split_commit", () => {
  test("落章导入语义：不分组、draft、计字数、游标同事务推进", async () => {
    await setupAiBook(TEXT_PLAIN)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2, segments: [2] },
      toolCtx(),
    )
    const metadata = extract.metadata
    const content = "他推开门。\n\n屋内一片漆黑。"
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "夜访", content, window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
      toolCtx(),
    )
    const db = getDb(projectDir)
    const row = db.select().from(ChapterTable).all()[0]
    expect(row.title).toBe("夜访")
    expect(row.volume_id).toBeNull()
    expect(row.status).toBe("draft")
    expect(row.order).toBe(1)
    expect(row.word_count).toBe(countWords(content))
    const archive = await getNovelArchive(NOVEL_ID, projectDir)
    expect(archive?.split_cursor).toBe(Number(metadata?.end_offset))
  })

  test("修复后字数偏差超 10% 拒绝落章", async () => {
    await setupAiBook(TEXT_PLAIN)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 },
      toolCtx(),
    )
    const metadata = extract.metadata
    await expectFailure(
      importSplitTools.import_split_commit.execute(
        {
          novel_id: NOVEL_ID,
          title: "夜访",
          content: "他推开了门。屋内一片漆黑，伸手不见五指，他摸索着找到了墙上的开关，灯亮了起来，照亮了整个房间。",
          window_cursor: 0,
          end_offset: Number(metadata?.end_offset),
          raw_word_count: Number(metadata?.raw_word_count),
        },
        toolCtx(),
      ),
      "content_rejected",
      "超过 10% 上限",
    )
  })

  test("raw_word_count 与存档切片不符时拒绝", async () => {
    await setupAiBook(TEXT_PLAIN)
    await expectFailure(
      importSplitTools.import_split_commit.execute(
        { novel_id: NOVEL_ID, title: "夜访", content: "他推开门。\n\n屋内一片漆黑。", window_cursor: 0, end_offset: 12, raw_word_count: 99 },
        toolCtx(),
      ),
      "param_error",
      "raw_word_count 与存档切片字数不符",
    )
  })

  test("游标单调：同一窗口不得重复落章", async () => {
    await setupAiBook(TEXT_PLAIN)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 },
      toolCtx(),
    )
    const metadata = extract.metadata
    const commitArgs = {
      novel_id: NOVEL_ID,
      title: "夜访",
      content: "他推开门。\n\n屋内一片漆黑。",
      window_cursor: 0,
      end_offset: Number(metadata?.end_offset),
      raw_word_count: Number(metadata?.raw_word_count),
    }
    await importSplitTools.import_split_commit.execute(commitArgs, toolCtx())
    await expectFailure(
      importSplitTools.import_split_commit.execute(commitArgs, toolCtx()),
      "gate_blocked",
      "不得重复落章",
    )
    // 落章后续窗口从新游标处重启，不重复组章
    const next = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect((next.metadata).window_cursor).toBe(Number(metadata?.end_offset))
    expect(next.output).toContain("1. 雨下了一整夜。")
    expect(next.output).toContain("他推开门。")
  })
})

describe("parseCutterOutput", () => {
  test("合法结论解析：trim 与缺省 reason", () => {
    const output = parseCutterOutput(JSON.stringify({ endSentence: 42, title: " 破庙夜雨 ", segments: [12, 37] }), 50)
    expect(output.endSentence).toBe(42)
    expect(output.title).toBe("破庙夜雨")
    expect(output.segments).toEqual([12, 37])
    expect(output.reason).toBe("")
  })

  test("非 JSON 与缺字段拒绝", () => {
    expect(() => parseCutterOutput("不是 JSON", 50)).toThrow("合法 JSON")
    expect(() => parseCutterOutput(JSON.stringify({ title: "无句号" }), 50)).toThrow("endSentence 非法")
    expect(() => parseCutterOutput(JSON.stringify({ endSentence: 3 }), 50)).toThrow("title 缺失")
  })

  test("句号越界与分段乱序拒绝", () => {
    expect(() => parseCutterOutput(JSON.stringify({ endSentence: 51, title: "越界" }), 50)).toThrow("endSentence 非法")
    expect(() =>
      parseCutterOutput(JSON.stringify({ endSentence: 10, title: "乱序", segments: [5, 5] }), 50),
    ).toThrow("严格递增")
    expect(() =>
      parseCutterOutput(JSON.stringify({ endSentence: 10, title: "越界段", segments: [11] }), 50),
    ).toThrow("segments 项非法")
  })
})

describe("parseCleanerOutput", () => {
  const chapterText = "他推开门。屋内一片漆黑。\n\n雨下了一整夜。他始终没有说话。"
  const rawWordCount = countWords(chapterText)
  const fullInput = { rawWordCount, chapterText, mode: "full" as const }

  test("合法三产出解析：修复对照、设定、技法", () => {
    const payload = {
      fixed_text: "他推开门。屋内一片漆黑。\n\n雨下了一整夜。他始终没有说话。",
      fixes: [{ original: "漆黑", fixed: "漆黑", reason: "段落" }],
      structure_only: false,
      settings: [{ type: "character", data: { name: "他", role: "主角", description: "深夜访客" }, sufficient: true, source_quote: "他推开门。" }],
      techniques: [
        {
          name: "环境氛围短句收束",
          principle: "以环境短句收束场景",
          instruction: "场景结束时用不超过十字的环境描写短句收尾",
          scene_types: ["description"],
          level: "paragraph",
          evidence: [{ source_title: "", source_location: "", excerpt: "屋内一片漆黑。", annotation: "环境短句收束" }],
          common_misuse: "连续多段使用",
          scope: "general",
        },
      ],
      reason: "无错字，抽取设定 1 条技法 1 条",
    }
    const output = parseCleanerOutput(JSON.stringify(payload), fullInput)
    expect(output.fixedText).toContain("他推开门。")
    expect(output.fixes).toHaveLength(1)
    expect(output.settings).toHaveLength(1)
    expect(output.settings[0].type).toBe("character")
    expect(output.techniques).toHaveLength(1)
    expect(output.techniques[0].evidence[0].excerpt).toBe("屋内一片漆黑。")
  })

  test("修复后字数偏差超 10% 拒绝", () => {
    const payload = {
      fixed_text: "他推开了门。屋内一片漆黑，伸手不见五指，他摸索着找到了墙上的开关，灯亮了起来，照亮了整个房间。",
      fixes: [],
      settings: [],
      techniques: [],
    }
    expect(() => parseCleanerOutput(JSON.stringify(payload), fullInput)).toThrow("超过 10% 上限")
  })

  test("fixes 原文片段逐字校验：不存在的片段拒绝", () => {
    const payload = {
      fixed_text: chapterText,
      fixes: [{ original: "不存在的片段", fixed: "x", reason: "错别字" }],
      settings: [],
      techniques: [],
    }
    expect(() => parseCleanerOutput(JSON.stringify(payload), fullInput)).toThrow("不存在于章全文")
  })

  test("结构清洗模式改正文拒绝，纯结构调整通过", () => {
    const mangled = "他推开了门。屋内一片漆黑。\n\n雨下了一整夜。他始终没有说话。"
    expect(() =>
      parseCleanerOutput(JSON.stringify({ fixed_text: mangled, fixes: [], settings: [], techniques: [] }), {
        rawWordCount,
        chapterText,
        mode: "structure_only",
      }),
    ).toThrow("不得改动正文字符")
    const ok = parseCleanerOutput(
      JSON.stringify({ fixed_text: "他推开门。\n\n屋内一片漆黑。\n\n雨下了一整夜。他始终没有说话。", fixes: [], settings: [], techniques: [] }),
      { rawWordCount, chapterText, mode: "structure_only" },
    )
    expect(ok.structureOnly).toBe(false)
  })

  test("非法设定类型与非法技法字段拒绝", () => {
    const base = { fixed_text: chapterText, fixes: [] }
    expect(() =>
      parseCleanerOutput(JSON.stringify({ ...base, settings: [{ type: "magic", data: {} }] }), fullInput),
    ).toThrow("settings.type 非法")
    expect(() =>
      parseCleanerOutput(
        JSON.stringify({
          ...base,
          techniques: [{ name: "x", principle: "p", instruction: "i", scene_types: ["description"], level: "chapter", evidence: [{ excerpt: "他推开门。", annotation: "a" }], common_misuse: "m", scope: "general" }],
        }),
        fullInput,
      ),
    ).toThrow("techniques.level 非法")
    expect(() =>
      parseCleanerOutput(
        JSON.stringify({
          ...base,
          techniques: [{ name: "x", principle: "p", instruction: "i", scene_types: ["description"], level: "paragraph", evidence: [], common_misuse: "m", scope: "general" }],
        }),
        fullInput,
      ),
    ).toThrow("至少一条")
  })

  test("技法证据逐字校验：excerpt 不在原文拒绝", () => {
    const payload = {
      fixed_text: chapterText,
      fixes: [],
      settings: [],
      techniques: [
        {
          name: "x",
          principle: "p",
          instruction: "i",
          scene_types: ["general"],
          level: "paragraph",
          evidence: [{ source_title: "", source_location: "", excerpt: "虚构的句子", annotation: "a" }],
          common_misuse: "m",
          scope: "general",
        },
      ],
    }
    expect(() => parseCleanerOutput(JSON.stringify(payload), fullInput)).toThrow("不存在于章全文")
  })
})
