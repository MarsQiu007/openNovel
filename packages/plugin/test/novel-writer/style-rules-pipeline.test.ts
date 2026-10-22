/**
 * style-rules-pipeline — 读取侧与端到端回归测试
 *
 * 覆盖：check_novel_settings 对历史形态 rules 的展平输出；
 * 端到端：save_novel_settings 保存嵌套 rules → 写作快照按预算渲染规则行（含拒绝与截断边界）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { getDb, NovelTable, StyleGuideTable } from "../../src/novel-writer/session-store.js"
import { formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import { assembleWriterSnapshot } from "../../src/novel-writer/recall.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `style-rules-pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
  return createToolContext(projectDir, { sessionID: "ses-style-rules", messageID: "msg_style_rules" })
}

async function seed() {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: "novel-check", title: "检查测试", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  return db
}

describe("check_novel_settings 读取归一化", () => {
  test("历史嵌套/数组规则以展平行输出，不再输出原始 JSON 或占位符", async () => {
    const db = await seed()
    // 直接写入历史嵌套形态（模拟旧数据或外部写入）
    await db
      .insert(StyleGuideTable)
      .values({
        id: "sg-check",
        novel_id: "novel-check",
        rules: { "异能体系": { "等级严格": "三级" }, "叙事节奏": ["紧凑", "留白"] },
        tone: "热血",
        pov: "第三人称",
        tense: "过去时",
      })
      .run()

    const result = await createWritingTools().check_novel_settings.execute(
      { novel_id: "novel-check", scope: "style_guide" },
      toolCtx(),
    )

    expect(result.output).toContain("- 异能体系.等级严格: 三级")
    expect(result.output).toContain("- 叙事节奏.0: 紧凑")
    expect(result.output).toContain("- 叙事节奏.1: 留白")
    expect(result.output).not.toContain("[object Object]")
    expect(result.output).not.toContain('{"')
  })
})

// ── 5.1 端到端：save_novel_settings → 落库 → 写作快照渲染 ──

function saveStyleGuide(data: Record<string, unknown>) {
  return createWritingTools().save_novel_settings.execute(
    { novel_id: "novel-check", settings_json: JSON.stringify([{ type: "style_guide", data }]) },
    toolCtx(),
  )
}

async function styleGuideRow() {
  const db = getDb(projectDir)
  const [row] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-check")).all()
  return row
}

describe("端到端：嵌套规则保存、读取与快照渲染", () => {
  test("嵌套 rules 保存后以规则行进入写作快照", async () => {
    await seed()
    const save = await saveStyleGuide({
      tone: "冷峻",
      pov: "第三人称",
      tense: "过去时",
      rules: { 异能体系: { 等级严格: "三级" }, 禁用手法: ["总结式收尾"] },
    })
    expect(save.metadata.count).toBe(1)

    const row = await styleGuideRow()
    expect(row.rules).toMatchObject({ "异能体系.等级严格": "三级", "禁用手法.0": "总结式收尾" })

    const snapshot = await assembleWriterSnapshot("novel-check", 0, projectDir)
    expect(snapshot).not.toBeNull()
    const { output } = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(output).toContain("风格：基调=冷峻 视角=第三人称 时态=过去时")
    expect(output).toContain("- 异能体系.等级严格: 三级")
    expect(output).toContain("- 禁用手法.0: 总结式收尾")
    expect(output).not.toContain("[object Object]")
    expect(output).not.toContain("已截断")
  })

  test("超长规则集合：快照按序截断其余并附查询提示，基调视角时态保留", async () => {
    await seed()
    const longRule = "这是一条非常长的风格规则内容".repeat(12)
    const rules: Record<string, string> = {}
    for (let i = 0; i < 20; i++) rules[`规则${i}`] = longRule
    await saveStyleGuide({ tone: "冷峻", pov: "第三人称", tense: "过去时", rules })

    const row = await styleGuideRow()
    expect(Object.keys(row.rules).length).toBe(20)

    const snapshot = await assembleWriterSnapshot("novel-check", 0, projectDir)
    expect(snapshot!.styleGuideTruncated).toBe(true)
    expect(snapshot!.styleGuide!.tone).toBe("冷峻")
    expect(snapshot!.styleGuide!.pov).toBe("第三人称")
    expect(snapshot!.styleGuide!.tense).toBe("过去时")

    const { output } = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(output).toContain("- 规则0: ")
    expect(output).not.toContain("- 规则19: ")
    expect(output).toContain("完整规则可通过 check_novel_settings")
  })

  test("无法归一化的 rules 被拒绝：库与快照保持旧值", async () => {
    await seed()
    await saveStyleGuide({ tone: "旧基调", rules: { 既定: "规则" } })

    const save = await saveStyleGuide({ tone: "新基调", rules: { bad: null } })
    expect(save.output).toContain("无法归一化")
    expect(save.metadata.count).toBe(0)

    const row = await styleGuideRow()
    expect(row.tone).toBe("旧基调")
    expect(row.rules).toMatchObject({ 既定: "规则" })

    const snapshot = await assembleWriterSnapshot("novel-check", 0, projectDir)
    const { output } = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(output).toContain("- 既定: 规则")
    expect(output).not.toContain("新基调")
  })
})
