/**
 * 确定性复测案例适配器（任务 5.1）。
 *
 * 适配器独占定义合成夹具、精确工具白名单、准备模板与真实结果核验器：模型只负责
 * 在隔离环境执行，文本不能扩大白名单或改写验收标准。无适配器的工具与场景一律
 * 转人工复测。准备阶段（本模块）纯数据构造：不执行目标工具、不读写文件系统；
 * 夹具写入（seed）与结果核验（verify）由隔离执行编排层在临时 Location 调用。
 *
 * 规范化摘要（caseDigest）覆盖案例、夹具、白名单、验收标准、模型提供方/模型、
 * 修复版本与正文凭据（grant ID 列表）：任何一项变化都使既有确认与授权失效，
 * 必须重新确认。正文凭据（content grant）以 subjectDigest = caseDigest 绑定到
 * 本案例；未授权正文不进入准备模板，也不进入复测 prompt。
 */
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { ChapterTable, NovelTable, getDb } from "../novel-writer/session-store.js"
import type { ToolInsightCaseMeta, ToolInsightCaseSections } from "./issue-store.js"
import type { ToolInsightVerifyResult } from "./verify.js"

export interface ToolInsightCaseFixtureChapter {
  id: string
  title: string
  content: string
}

export interface ToolInsightCaseFixture {
  novel_id: string
  novel_title: string
  genre: string
  synopsis: string
  chapters: readonly ToolInsightCaseFixtureChapter[]
}

export interface ToolInsightCaseAdapter {
  /** 被复测的目标工具；白名单之外的执行面一律不开放 */
  tool: string
  /** 操作场景稳定键（与问题指纹的 scenario 同词表，见 detector DetectionKind） */
  scenario: string
  /** 精确工具白名单：隔离执行时 agent materialize 的工具名称集合必须精确等于此集合 */
  whitelist: readonly string[]
  /** 合成夹具（固定 ID，供准备模板与核验引用）；与原书数据无关 */
  fixture: ToolInsightCaseFixture
  /** 验收标准（进入案例文档与规范化摘要） */
  acceptance: readonly string[]
  /** 准备模板：复测 agent 的完整 prompt，只引用合成夹具，不含用户正文 */
  prompt(input: { novelID: string }): string
  /** 把合成夹具写入临时 Location 的 novel.db（普通插件代码，不执行目标工具） */
  seed(input: { directory: string }): Promise<void>
  /** 真实结果核验器：查临时 Location 最终本地状态，绝不信工具返回或 agent 声明 */
  verify(input: { directory: string }): Promise<ToolInsightVerifyResult>
}

// ─── 合成夹具常量 ───

const FIXTURE_NOVEL_ID = "case-novel-0001"
const FIXTURE_CHAPTER_1_ID = "case-ch-0001"
const FIXTURE_CHAPTER_2_ID = "case-ch-0002"
const FIXTURE_CONTENT_1 =
  "夜色像一层薄釉覆在河面上，摆渡人把竹篙探进水里，搅碎了对岸的灯。他数着水声，等那个每年只来一次的客人。"
const FIXTURE_CONTENT_2 =
  "清晨的雾散得很慢，城门口的告示被露水洇湿了半张。抄录官踩着木梯上去，把新榜文钉在旧钉孔里，钉声传出很远。"
/** update_chapter 复测的确定性目标标题（无自由文本，核验按精确相等判定） */
export const FIXTURE_UPDATED_TITLE = "复测更新标题-384927"

const FIXTURE_GENRE = "都市"

function baseFixture(chapters: readonly ToolInsightCaseFixtureChapter[]): ToolInsightCaseFixture {
  return {
    novel_id: FIXTURE_NOVEL_ID,
    novel_title: "复测合成样本",
    genre: FIXTURE_GENRE,
    synopsis: "仅用于工具复测的合成书籍，与任何原书无关。",
    chapters,
  }
}

// ─── 首批适配器：只读两条路径 + 合成数据写入路径 ───

const listChaptersAdapter: ToolInsightCaseAdapter = {
  tool: "list_chapters",
  scenario: "recovery_failed",
  whitelist: ["list_chapters"],
  fixture: baseFixture([
    { id: FIXTURE_CHAPTER_1_ID, title: "渡口", content: FIXTURE_CONTENT_1 },
    { id: FIXTURE_CHAPTER_2_ID, title: "榜文", content: FIXTURE_CONTENT_2 },
  ]),
  acceptance: [
    "list_chapters 对合成书籍返回恰好 2 条章节记录，ID 与夹具一致",
    "只读路径：复测结束后夹具两章的标题与正文与夹具定义逐字一致",
  ],
  prompt: ({ novelID }) =>
    [
      "你是复测执行 agent。请严格按以下步骤操作，不要做任何其他事：",
      `1. 调用 list_chapters 工具，参数 novel_id="${novelID}"。`,
      "2. 工具返回后立即结束，不要总结、不要继续调用其他工具。",
    ].join("\n"),
  seed: async ({ directory }) => {
    await seedFixture(directory, listChaptersAdapter.fixture)
  },
  verify: async ({ directory }) => {
    try {
      const db = getDb(directory)
      const rows = db
        .select({ id: ChapterTable.id, title: ChapterTable.title, content: ChapterTable.content })
        .from(ChapterTable)
        .where(eq(ChapterTable.novel_id, FIXTURE_NOVEL_ID))
        .all()
      const byID = new Map(rows.map((row) => [row.id, row]))
      const missing = listChaptersAdapter.fixture.chapters.filter((chapter) => byID.get(chapter.id) === undefined)
      if (missing.length > 0) return { status: "verified_failure", detail: `夹具章节缺失：${missing.map((c) => c.id).join("、")}` }
      if (rows.length !== listChaptersAdapter.fixture.chapters.length) {
        return { status: "verified_failure", detail: `章节记录数 ${rows.length} 与夹具 ${listChaptersAdapter.fixture.chapters.length} 不一致` }
      }
      const mutated = listChaptersAdapter.fixture.chapters.filter((chapter) => byID.get(chapter.id)?.title !== chapter.title || byID.get(chapter.id)?.content !== chapter.content)
      if (mutated.length > 0) return { status: "verified_failure", detail: `只读路径夹具被改动：${mutated.map((c) => c.id).join("、")}` }
      return { status: "verified_success", detail: `合成书籍 2 条章节记录齐全，只读未改动` }
    } catch (error) {
      return { status: "unverified", detail: `本地状态查询失败：${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

const readChapterAdapter: ToolInsightCaseAdapter = {
  tool: "read_chapter_content",
  scenario: "recovery_failed",
  whitelist: ["read_chapter_content"],
  fixture: baseFixture([{ id: FIXTURE_CHAPTER_1_ID, title: "渡口", content: FIXTURE_CONTENT_1 }]),
  acceptance: [
    "read_chapter_content 读取夹具章节返回的正文与夹具定义逐字一致",
    "只读路径：复测结束后夹具章节的标题与正文与夹具定义逐字一致",
  ],
  prompt: ({ novelID }) =>
    [
      "你是复测执行 agent。请严格按以下步骤操作，不要做任何其他事：",
      `1. 调用 read_chapter_content 工具，参数 novel_id="${novelID}"、chapter_id="${FIXTURE_CHAPTER_1_ID}"。`,
      "2. 工具返回后立即结束，不要总结、不要继续调用其他工具。",
    ].join("\n"),
  seed: async ({ directory }) => {
    await seedFixture(directory, readChapterAdapter.fixture)
  },
  verify: async ({ directory }) => {
    try {
      const db = getDb(directory)
      const rows = db
        .select({ title: ChapterTable.title, content: ChapterTable.content })
        .from(ChapterTable)
        .where(eq(ChapterTable.id, FIXTURE_CHAPTER_1_ID))
        .limit(1)
        .all()
      const chapter = rows[0]
      if (!chapter) return { status: "verified_failure", detail: `夹具章节 ${FIXTURE_CHAPTER_1_ID} 不存在` }
      if (chapter.content !== FIXTURE_CONTENT_1) return { status: "verified_failure", detail: "夹具章节正文与夹具定义不一致（只读路径被改动）" }
      if (chapter.title !== "渡口") return { status: "verified_failure", detail: "夹具章节标题与夹具定义不一致" }
      return { status: "verified_success", detail: "夹具章节正文保持原样，只读未改动" }
    } catch (error) {
      return { status: "unverified", detail: `本地状态查询失败：${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

const updateChapterAdapter: ToolInsightCaseAdapter = {
  tool: "update_chapter",
  scenario: "recovery_failed",
  whitelist: ["update_chapter"],
  fixture: baseFixture([{ id: FIXTURE_CHAPTER_1_ID, title: "渡口", content: FIXTURE_CONTENT_1 }]),
  acceptance: [
    "update_chapter 后夹具章节标题精确等于 FIXTURE_UPDATED_TITLE",
    "合成写入路径：夹具章节正文保持原样（本案例只改标题，不动正文）",
  ],
  prompt: ({ novelID }) =>
    [
      "你是复测执行 agent。请严格按以下步骤操作，不要做任何其他事：",
      `1. 调用 update_chapter 工具，参数 chapter_id="${FIXTURE_CHAPTER_1_ID}"、title="${FIXTURE_UPDATED_TITLE}"（novel_id="${novelID}" 仅供定位，不要传其他字段）。`,
      "2. 工具返回后立即结束，不要总结、不要继续调用其他工具。",
    ].join("\n"),
  seed: async ({ directory }) => {
    await seedFixture(directory, updateChapterAdapter.fixture)
  },
  verify: async ({ directory }) => {
    try {
      const db = getDb(directory)
      const rows = db
        .select({ title: ChapterTable.title, content: ChapterTable.content })
        .from(ChapterTable)
        .where(eq(ChapterTable.id, FIXTURE_CHAPTER_1_ID))
        .limit(1)
        .all()
      const chapter = rows[0]
      if (!chapter) return { status: "verified_failure", detail: `夹具章节 ${FIXTURE_CHAPTER_1_ID} 不存在` }
      if (chapter.title !== FIXTURE_UPDATED_TITLE) {
        return { status: "verified_failure", detail: `章节标题未更新为预期值（当前「${chapter.title}」）` }
      }
      if (chapter.content !== FIXTURE_CONTENT_1) return { status: "verified_failure", detail: "夹具章节正文被越权改动（本案例只应改标题）" }
      return { status: "verified_success", detail: "章节标题已按案例更新且正文未被改动" }
    } catch (error) {
      return { status: "unverified", detail: `本地状态查询失败：${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

/** 首批案例适配器注册表；其余工具与场景一律无适配器 → 转人工复测 */
const CASE_ADAPTERS: readonly ToolInsightCaseAdapter[] = [listChaptersAdapter, readChapterAdapter, updateChapterAdapter]

export function findToolInsightCaseAdapter(tool: string, scenario: string): ToolInsightCaseAdapter | undefined {
  return CASE_ADAPTERS.find((adapter) => adapter.tool === tool && adapter.scenario === scenario)
}

// ─── 规范化摘要 ───

export interface ToolInsightCaseDigestInput {
  case_id: string
  tool: string
  scenario: string
  whitelist: readonly string[]
  fixture: ToolInsightCaseFixture
  acceptance: readonly string[]
  model: { providerID?: string; modelID?: string }
  fix_version: string
  /** 绑定到本案例的正文凭据 ID 列表；凭据增删即摘要失效 */
  grant_ids: readonly string[]
}

/** 规范化摘要：sha256 覆盖案例、夹具、白名单、验收标准、模型、修复版本与正文凭据 */
export function computeCaseDigest(input: ToolInsightCaseDigestInput): string {
  const canonical = JSON.stringify({
    case_id: input.case_id,
    tool: input.tool,
    scenario: input.scenario,
    whitelist: [...input.whitelist],
    fixture: input.fixture,
    acceptance: [...input.acceptance],
    model: input.model,
    fix_version: input.fix_version,
    grant_ids: [...input.grant_ids],
  })
  return createHash("sha256").update(canonical).digest("hex")
}

// ─── 案例准备（纯数据构造；不执行目标工具、不触碰文件系统） ───

export type PreparedToolInsightCase =
  | {
      eligible: true
      case_id: string
      adapter: ToolInsightCaseAdapter
      meta: ToolInsightCaseMeta
      sections: ToolInsightCaseSections
      /** 准备模板（复测 agent 的完整 prompt），只含合成夹具引用 */
      prompt: string
      digest: string
    }
  | { eligible: false; reason: "no-adapter" }

export interface PrepareToolInsightCaseInput {
  fingerprint: string
  tool: string
  scenario: string
  model: { providerID?: string; modelID?: string }
  fix_version: string
  /** 绑定到本案例的正文凭据 ID 列表（来自 content_exception 证据的 retest grants） */
  grant_ids: readonly string[]
  now?: Date
}

/** 复测资格判定与案例材料构造：无适配器返回 no-adapter（转人工），其余情况一律可准备 */
export function prepareToolInsightCase(input: PrepareToolInsightCaseInput): PreparedToolInsightCase {
  const adapter = findToolInsightCaseAdapter(input.tool, input.scenario)
  if (!adapter) return { eligible: false, reason: "no-adapter" }

  const case_id = `case_${input.fingerprint}`
  const digest = computeCaseDigest({
    case_id,
    tool: adapter.tool,
    scenario: adapter.scenario,
    whitelist: adapter.whitelist,
    fixture: adapter.fixture,
    acceptance: adapter.acceptance,
    model: input.model,
    fix_version: input.fix_version,
    grant_ids: input.grant_ids,
  })
  const meta = {
    format: 1,
    case_id,
    fingerprint: input.fingerprint,
    tool: adapter.tool,
    scenario: adapter.scenario,
    whitelist: [...adapter.whitelist],
    model: input.model,
    fix_version: input.fix_version,
    created_at: (input.now ?? new Date()).toISOString(),
  }
  const sections = {
    说明: [
      `本案例由确定性适配器生成，用于在隔离环境中复测工具 \`${adapter.tool}\`（场景 ${adapter.scenario}）。`,
      "执行内容、白名单与验收标准全部由适配器独占定义；模型文本不得扩大白名单或改写验收标准。",
      "复测只在一次性临时项目中进行：不读写原书、不产生真实外部副作用。",
    ].join("\n"),
    夹具: [
      `- 合成书籍：${adapter.fixture.novel_id}「${adapter.fixture.novel_title}」（${adapter.fixture.genre}）`,
      ...adapter.fixture.chapters.map((chapter, index) => {
        return `- 章节 ${index + 1}：${chapter.id}「${chapter.title}」（${chapter.content.length} 字合成正文）`
      }),
    ].join("\n"),
    验收标准: adapter.acceptance.map((item) => `- ${item}`).join("\n"),
  }
  const prompt = adapter.prompt({ novelID: adapter.fixture.novel_id })
  return { eligible: true, case_id, adapter, meta, sections, prompt, digest }
}

// ─── 夹具写入（由隔离执行编排层在临时 Location 调用） ───

async function seedFixture(directory: string, fixture: ToolInsightCaseFixture): Promise<void> {
  const db = getDb(directory)
  const now = Date.now()
  // bun:sqlite 驱动下 drizzle 写入链是同步的，无需 await
  db
    .insert(NovelTable)
    .values({
      id: fixture.novel_id,
      title: fixture.novel_title,
      genre: fixture.genre,
      synopsis: fixture.synopsis,
      status: "draft",
      created_at: now,
      updated_at: now,
    })
    .run()
  for (const [index, chapter] of fixture.chapters.entries()) {
    db
      .insert(ChapterTable)
      .values({
        id: chapter.id,
        novel_id: fixture.novel_id,
        title: chapter.title,
        content: chapter.content,
        word_count: chapter.content.length,
        status: "draft",
        order: index + 1,
        created_at: now,
        updated_at: now,
      })
      .run()
  }
}
