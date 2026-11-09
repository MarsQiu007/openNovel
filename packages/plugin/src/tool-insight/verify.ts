/**
 * 真实结果只读核验适配器（任务 3.3）。
 *
 * 区分三种事实来源：agent 声明（轨迹里的文本事实）、工具返回（success 事件）、
 * 最终本地状态（本模块查询的结果）。只有本地状态可核验时才算「已核实」；
 * 没有注册核验器或标识不足时一律「未验证」，不根据工具返回或 agent 声明推断成功。
 *
 * 全部查询走 novel-store 只读 select：核验路径没有任何 insert/update/delete，
 * 也不调用 agent 或模型。标识只允许 ID/枚举类标量（章节 ID、候选类型、版本号），
 * extract 永不返回正文、路径或自由文本。
 */
import { desc, eq } from "drizzle-orm"
import {
  ChapterReviewTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterTable,
  RelationshipTable,
  WorldEntryTable,
  getDb,
} from "../novel-writer/session-store.js"

export type ToolInsightVerifyResult =
  | { status: "verified_success"; detail: string }
  | { status: "verified_failure"; detail: string }
  | { status: "unverified"; detail: string }

export interface ToolInsightVerifyAdapter {
  tool: string
  /**
   * 从调用输入与成功结果中提取核验标识：只返回 ID/枚举类标量。
   * 返回 undefined 表示本次调用携带的标识不足以核验（结果按「未验证」处理）。
   */
  extract(input: { callInput: Record<string, unknown>; resultStructured: Record<string, unknown> }): Record<string, string> | undefined
  verify(input: { directory: string; identifiers: Record<string, string> }): Promise<ToolInsightVerifyResult>
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const scalarString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim() !== "") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

// ─── 章节内容核验：write_chapter / revise_chapter / update_chapter ───

function chapterVerify(kind: "created" | "revised" | "updated"): ToolInsightVerifyAdapter {
  return {
    tool: "",
    extract: ({ callInput }) => {
      const chapterID = scalarString(callInput.chapter_id)
      return chapterID === undefined ? undefined : { chapter_id: chapterID }
    },
    verify: async ({ directory, identifiers }) => {
      const chapterID = identifiers.chapter_id
      if (chapterID === undefined) return { status: "unverified", detail: "缺少章节标识" }
      try {
        const db = getDb(directory)
        const rows = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).limit(1).all()
        const chapter = rows[0]
        if (!chapter) return { status: "verified_failure", detail: `章节 ${chapterID.slice(0, 8)} 不存在于本地书籍状态` }
        const versions = await db
          .select({ version: ChapterVersionTable.version })
          .from(ChapterVersionTable)
          .where(eq(ChapterVersionTable.chapter_id, chapterID))
          .orderBy(desc(ChapterVersionTable.version))
          .limit(1)
          .all()
        const latest = versions[0]?.version ?? 0
        if (kind === "created" || kind === "revised") {
          if (latest < 1) return { status: "verified_failure", detail: "章节存在但没有任何内容版本落库" }
          return { status: "verified_success", detail: `章节存在，最新版本 v${latest}` }
        }
        if (chapter.content === "") return { status: "verified_failure", detail: "章节内容为空，更新未落库" }
        return { status: "verified_success", detail: `章节内容已落库，最新版本 v${latest}` }
      } catch (error) {
        return { status: "unverified", detail: `本地状态查询失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }
}

// ─── 审批轨迹核验：submit_chapter_review（章节审计/评审记录） ───

const reviewVerify: ToolInsightVerifyAdapter = {
  tool: "",
  extract: ({ callInput }) => {
    const chapterID = scalarString(callInput.chapter_id)
    return chapterID === undefined ? undefined : { chapter_id: chapterID }
  },
  verify: async ({ directory, identifiers }) => {
    const chapterID = identifiers.chapter_id
    if (chapterID === undefined) return { status: "unverified", detail: "缺少章节标识" }
    try {
      const db = getDb(directory)
      const rows = await db
        .select({ round: ChapterReviewTable.round })
        .from(ChapterReviewTable)
        .where(eq(ChapterReviewTable.chapter_id, chapterID))
        .limit(1)
        .all()
      if (rows.length === 0) return { status: "verified_failure", detail: "本地无该章节的评审记录" }
      return { status: "verified_success", detail: `评审记录已落库（round ${rows[0]?.round}）` }
    } catch (error) {
      return { status: "unverified", detail: `本地状态查询失败：${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

// ─── 设定入库核验：accept_pending_setting ───

const settingAcceptVerify: ToolInsightVerifyAdapter = {
  tool: "",
  extract: ({ resultStructured }) => {
    const createdID = scalarString(resultStructured.created_id)
    if (createdID === undefined) return undefined
    const candidateType = scalarString(resultStructured.candidate_type) ?? "unknown"
    return { created_id: createdID, candidate_type: candidateType }
  },
  verify: async ({ directory, identifiers }) => {
    const createdID = identifiers.created_id
    if (createdID === undefined) return { status: "unverified", detail: "结果中缺少入库标识" }
    try {
      const db = getDb(directory)
      const found =
        (await db.select({ id: CharacterTable.id }).from(CharacterTable).where(eq(CharacterTable.id, createdID)).limit(1).all()).length >
        0 ||
        (await db.select({ id: WorldEntryTable.id }).from(WorldEntryTable).where(eq(WorldEntryTable.id, createdID)).limit(1).all()).length >
        0 ||
        (await db.select({ id: RelationshipTable.id }).from(RelationshipTable).where(eq(RelationshipTable.id, createdID)).limit(1).all()).length >
        0
      if (!found) return { status: "verified_failure", detail: "入库标识未出现在任何设定正式表" }
      return { status: "verified_success", detail: `设定已落库（${identifiers.candidate_type ?? "unknown"}）` }
    } catch (error) {
      return { status: "unverified", detail: `本地状态查询失败：${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

/** 首批只读核验适配器：章节内容（建/改/审）、审批轨迹、设定入库 */
const VERIFY_ADAPTERS: readonly ToolInsightVerifyAdapter[] = [
  { ...chapterVerify("created"), tool: "write_chapter" },
  { ...chapterVerify("revised"), tool: "revise_chapter" },
  { ...chapterVerify("updated"), tool: "update_chapter" },
  { ...reviewVerify, tool: "submit_chapter_review" },
  { ...settingAcceptVerify, tool: "accept_pending_setting" },
]

export function findToolInsightVerifyAdapter(tool: string): ToolInsightVerifyAdapter | undefined {
  return VERIFY_ADAPTERS.find((adapter) => adapter.tool === tool)
}
