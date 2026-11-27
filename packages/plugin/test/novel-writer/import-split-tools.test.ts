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
import { ChapterTable, getDb, getNovelArchive, NovelArchiveTable, NovelTable, VolumeTable } from "../../src/novel-writer/session-store.js"
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
// 裸数字章题书：相邻同文重复行（采集重复）+ 纯序号章题
const TEXT_BARE = ["１", "    １", "清晨出发。山路难行。", "２", "    ２", "夜宿破庙。忽闻异响。"].join("\n")
// 纯序号章题书：第N章无名字
const TEXT_ORDINAL = ["第三十一章", "清晨出发。山路难行。", "第三十二章", "夜宿破庙。忽闻异响。"].join("\n\n")
// 卷章书：两卷三章，卷题/章题行各独占一行
const TEXT_VOLUMED = [
  "第一卷 风起",
  "第一章 启程",
  "清晨出发。山路难行。",
  "第二章 遇险",
  "夜宿破庙。忽闻异响。",
  "第二卷 远航",
  "第三章 出海",
  "风平浪静。船行千里。",
].join("\n\n")

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

  test("引号缺陷超过单句长度上限自动闭合，窗口正常组章", async () => {
    // 未闭合左引号开放超过 500 字判定为丢失右引号的错字，引号内句末恢复切点资格
    const text = "他推开门。屋内一片漆黑。\n\n“" + "这一段一直没有闭合引号。".repeat(60) + "雨停了。"
    await setupAiBook(text)
    const result = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(result.output).not.toContain("超大句流单元")
    expect(result.output).toContain("雨停了。")
    expect(result.output).toContain("存档引号不配对")
  })

  test("后文超大句流单元时不得误导为全书末尾", async () => {
    // 前几句很短，后文无句末标点被并成超大单元：窗口受硬上限截断但全书未耗尽
    const text = "他推开门。屋内一片漆黑。雨停了。\n\n" + "完全没有句末标点的残留噪声".repeat(400)
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

  test("窗口输出上一章章题", async () => {
    await setupAiBook(TEXT_PLAIN)
    const first = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(first.output).toContain("上一章章题：无（全书第一章）")
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 },
      toolCtx(),
    )
    const metadata = extract.metadata
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "夜访", content: "他推开门。\n\n屋内一片漆黑。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
      toolCtx(),
    )
    const second = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(second.output).toContain("上一章章题：第1章 夜访")
  })
})

describe("import_split_extract 字数硬闸门", () => {
  const sentence = "这是一个用来凑字数的测试句子。"
  const makeText = (count: number) => Array.from({ length: count }, () => sentence).join("")

  test("窗口每行标注累计字数", async () => {
    await setupAiBook(makeText(20))
    const result = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(result.output).toContain("累计约")
  })

  test("超出硬上限 3500 拒绝并要求重选更早边界", async () => {
    await setupAiBook(makeText(300))
    await expectFailure(
      importSplitTools.import_split_extract.execute({ novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 260 }, toolCtx()),
      "content_rejected",
      "超出硬上限",
    )
  })

  test("低于硬下限且后文充足时拒绝并要求重选更晚边界", async () => {
    await setupAiBook(makeText(300))
    await expectFailure(
      importSplitTools.import_split_extract.execute({ novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 50 }, toolCtx()),
      "content_rejected",
      "低于硬下限",
    )
  })

  test("临近全书结尾允许小章收尾", async () => {
    await setupAiBook(makeText(100))
    const result = await importSplitTools.import_split_extract.execute({ novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 30 }, toolCtx())
    expect(Number(result.metadata?.raw_word_count)).toBeGreaterThan(0)
  })

  test("引号不配对时窗口输出诊断", async () => {
    await setupAiBook("他说「你好。她答「嗯。」然后他走了。")
    const result = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(result.output).toContain("引号不配对")
  })
})

describe("import_split_commit 段落归一与单段上限", () => {
  test("单换行归一为空行分段，段间空行保留", async () => {
    await setupAiBook(TEXT_PLAIN)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 },
      toolCtx(),
    )
    const metadata = extract.metadata
    // cleaner 输出用单换行连写段落：落章必须归一为空行分段
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "推门", content: "他推开门。\n屋内一片漆黑。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
      toolCtx(),
    )
    const [chapter] = getDb(projectDir).select().from(ChapterTable).all()
    expect(chapter?.content).toBe("他推开门。\n\n屋内一片漆黑。")
  })

  test("单段超过 1000 字拒绝并要求细分", async () => {
    const sentence = "这是一个用来凑字数的测试句子。"
    const long = Array.from({ length: 80 }, () => sentence).join("") + "\n\n结尾。"
    await setupAiBook(long)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 81 },
      toolCtx(),
    )
    const metadata = extract.metadata
    await expectFailure(
      importSplitTools.import_split_commit.execute(
        { novel_id: NOVEL_ID, title: "长段", content: Array.from({ length: 80 }, () => sentence).join("") + "结尾。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
        toolCtx(),
      ),
      "content_rejected",
      "最长段",
    )
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
      { novel_id: NOVEL_ID, title: "夜访", content: "他推开门。\n\n屋内一片漆黑。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
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
  test("落章导入语义：draft、计字数、游标同事务推进", async () => {
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
    expect(row.title).toBe("第1章 夜访")
    expect(row.volume_id).toBeNull()
    expect(row.status).toBe("draft")
    expect(row.order).toBe(1)
    expect(row.word_count).toBe(countWords(content))
    const archive = await getNovelArchive(NOVEL_ID, projectDir)
    expect(archive?.split_cursor).toBe(Number(metadata?.end_offset))
  })

  test("拟题统一编排：剥离模型自带序号，同名连续章统一编号", async () => {
    await setupAiBook(TEXT_PLAIN)
    const first = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 },
      toolCtx(),
    )
    const firstMeta = first.metadata
    // 模型自带序号前缀：执行器剥离后按全书章序重排
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "第三章 夜访", content: "他推开门。\n\n屋内一片漆黑。", window_cursor: 0, end_offset: Number(firstMeta?.end_offset), raw_word_count: Number(firstMeta?.raw_word_count) },
      toolCtx(),
    )
    const second = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: Number(firstMeta?.end_offset), end_sentence: 2 },
      toolCtx(),
    )
    const secondMeta = second.metadata
    // 第二章同名（同一叙事单元）：上一章回溯补编（1），本章编号（2）
    const committed = await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "夜访", content: "雨下了一整夜。\n\n他始终没有说话。", window_cursor: Number(firstMeta?.end_offset), end_offset: Number(secondMeta?.end_offset), raw_word_count: Number(secondMeta?.raw_word_count) },
      toolCtx(),
    )
    const rows = getDb(projectDir).select().from(ChapterTable).all()
    expect(rows[0]?.title).toBe("第1章 夜访（1）")
    expect(rows[1]?.title).toBe("第2章 夜访（2）")
    expect(committed.output).toContain("第2章 夜访（2）")
    expect(committed.output).toContain("统一编号")
  })

  test("纯序号章题拒绝：缺名字部分且不落章不动游标", async () => {
    await setupAiBook(TEXT_PLAIN)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 2 },
      toolCtx(),
    )
    const metadata = extract.metadata
    await expectFailure(
      importSplitTools.import_split_commit.execute(
        { novel_id: NOVEL_ID, title: "第一章", content: "他推开门。\n\n屋内一片漆黑。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
        toolCtx(),
      ),
      "content_rejected",
      "只有序号没有名字",
    )
    expect(getDb(projectDir).select().from(ChapterTable).all().length).toBe(0)
    const archive = await getNovelArchive(NOVEL_ID, projectDir)
    expect(archive?.split_cursor).toBe(0)
  })

  test("存档章题书原样采用存档章题", async () => {
    await setupAiBook(TEXT_HEADED)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 3 },
      toolCtx(),
    )
    const metadata = extract.metadata
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "模型自拟的名", content: "第一章 启程\n\n清晨出发。\n\n山路难行。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
      toolCtx(),
    )
    const [row] = getDb(projectDir).select().from(ChapterTable).all()
    expect(row?.title).toBe("第一章 启程")
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

describe("import_split_commit 分卷归属", () => {
  async function commitChapter(cursor: number, endSentence: number, title: string, content: string) {
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: cursor, end_sentence: endSentence },
      toolCtx(),
    )
    const metadata = extract.metadata
    const committed = await importSplitTools.import_split_commit.execute(
      {
        novel_id: NOVEL_ID,
        title,
        content,
        window_cursor: cursor,
        end_offset: Number(metadata?.end_offset),
        raw_word_count: Number(metadata?.raw_word_count),
      },
      toolCtx(),
    )
    return { metadata, committed }
  }

  test("卷题书自动建卷并归属，同名卷复用", async () => {
    await setupAiBook(TEXT_VOLUMED)
    const first = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(first.output).toContain("【卷题】1. 第一卷 风起")

    // 第一章：起点为卷题 + 章题标题块，章题取章题行，卷自动创建
    const ch1 = await commitChapter(0, 4, "模型自拟", "第一卷 风起\n\n第一章 启程\n\n清晨出发。\n\n山路难行。")
    expect(ch1.metadata?.title_hint).toBe("第一章 启程")
    expect(ch1.committed.output).toContain("归属卷「第一卷 风起」")

    // 第二章：同一卷复用，不重复建卷
    const ch2 = await commitChapter(Number(ch1.metadata?.end_offset), 3, "模型自拟", "第二章 遇险\n\n夜宿破庙。\n\n忽闻异响。")
    expect(ch2.committed.output).toContain("归属卷「第一卷 风起」")

    // 第三章：起点为第二卷卷题，建第二卷并归属
    const ch3 = await commitChapter(Number(ch2.metadata?.end_offset), 4, "模型自拟", "第二卷 远航\n\n第三章 出海\n\n风平浪静。\n\n船行千里。")
    expect(ch3.metadata?.title_hint).toBe("第三章 出海")
    expect(ch3.committed.output).toContain("归属卷「第二卷 远航」")

    const db = getDb(projectDir)
    const volumes = db.select().from(VolumeTable).all()
    expect(volumes.length).toBe(2)
    expect(volumes[0]?.title).toBe("第一卷 风起")
    expect(volumes[0]?.order).toBe(1)
    expect(volumes[1]?.title).toBe("第二卷 远航")
    expect(volumes[1]?.order).toBe(2)
    const chapters = db.select().from(ChapterTable).all()
    expect(chapters.map((row) => row.title)).toEqual(["第一章 启程", "第二章 遇险", "第三章 出海"])
    expect(chapters[0]?.volume_id).toBe(volumes[0]?.id)
    expect(chapters[1]?.volume_id).toBe(volumes[0]?.id)
    expect(chapters[2]?.volume_id).toBe(volumes[1]?.id)
  })

  test("卷题强边界：章不得跨卷题收章", async () => {
    await setupAiBook(TEXT_VOLUMED)
    const ch1 = await commitChapter(0, 4, "模型自拟", "第一卷 风起\n\n第一章 启程\n\n清晨出发。\n\n山路难行。")
    // 第二章窗口含第二卷卷题（窗口第 4 句）：跨卷题收章被拒绝
    await expectFailure(
      importSplitTools.import_split_extract.execute(
        { novel_id: NOVEL_ID, window_cursor: Number(ch1.metadata?.end_offset), end_sentence: 4 },
        toolCtx(),
      ),
      "content_rejected",
      "章题强边界",
    )
  })

  test("首个卷题之前的章保持无卷归属", async () => {
    await setupAiBook(["引子内容。开场白。", "第一卷 风起", "第一章 启程", "清晨出发。"].join("\n\n"))
    const ch1 = await commitChapter(0, 2, "引子", "引子内容。\n\n开场白。")
    expect(ch1.committed.output).not.toContain("归属卷")
    const db = getDb(projectDir)
    const [row] = db.select().from(ChapterTable).all()
    expect(row?.title).toBe("第1章 引子")
    expect(row?.volume_id).toBeNull()
    expect(db.select().from(VolumeTable).all().length).toBe(0)
  })
})

describe("import_split_commit 裸数字与纯序号章题", () => {
  test("裸数字章题书：重复行去重、纯序号拟名合成第N章 名字", async () => {
    await setupAiBook(TEXT_BARE)
    const window = await importSplitTools.import_split_window.execute({ novel_id: NOVEL_ID }, toolCtx())
    expect(window.output).toContain("【章题】")

    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 3 },
      toolCtx(),
    )
    const metadata = extract.metadata
    expect(metadata?.title_hint).toBe("１")
    expect(extract.output).toContain("纯序号章题")

    // cutter 未拟名（仍只给序号）拒绝
    await expectFailure(
      importSplitTools.import_split_commit.execute(
        { novel_id: NOVEL_ID, title: "１", content: "清晨出发。\n\n山路难行。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
        toolCtx(),
      ),
      "content_rejected",
      "纯序号",
    )

    // 拟名后合成「第1章 名字」
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "觉醒", content: "清晨出发。\n\n山路难行。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
      toolCtx(),
    )
    const second = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: Number(metadata?.end_offset), end_sentence: 3 },
      toolCtx(),
    )
    const secondMeta = second.metadata
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "遇险", content: "夜宿破庙。\n\n忽闻异响。", window_cursor: Number(metadata?.end_offset), end_offset: Number(secondMeta?.end_offset), raw_word_count: Number(secondMeta?.raw_word_count) },
      toolCtx(),
    )
    const rows = getDb(projectDir).select().from(ChapterTable).all()
    expect(rows.map((row) => row.title)).toEqual(["第1章 觉醒", "第2章 遇险"])
  })

  test("纯序号第N章存档章题：保留原序号拟名合成", async () => {
    await setupAiBook(TEXT_ORDINAL)
    const extract = await importSplitTools.import_split_extract.execute(
      { novel_id: NOVEL_ID, window_cursor: 0, end_sentence: 3 },
      toolCtx(),
    )
    const metadata = extract.metadata
    expect(metadata?.title_hint).toBe("第三十一章")
    expect(extract.output).toContain("纯序号章题")
    await importSplitTools.import_split_commit.execute(
      { novel_id: NOVEL_ID, title: "夜雨", content: "第三十一章\n\n清晨出发。\n\n山路难行。", window_cursor: 0, end_offset: Number(metadata?.end_offset), raw_word_count: Number(metadata?.raw_word_count) },
      toolCtx(),
    )
    const [row] = getDb(projectDir).select().from(ChapterTable).all()
    expect(row?.title).toBe("第三十一章 夜雨")
  })
})
