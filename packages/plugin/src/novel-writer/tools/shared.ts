/**
 * novel-writer 工具共享 helper。
 *
 * 这些函数从 novel-writer.ts 原样搬入（V1 入口经 import 复用，窗口期双入口
 * 共用同一份实现）；V2 工具（tools/ 下各域文件）同样从这里引用。
 */
import { desc, eq } from "drizzle-orm"
import type { StoryArcSummary } from "../context.js"
import { ChapterVersionTable, getDb, NovelTable } from "../session-store.js"

export const SETTING_ENTITY_TYPES = [
  "character",
  "world_entry",
  "plot_thread",
  "foreshadowing",
  "volume",
  "relationship",
]

export function projectDirFromCtx(directory?: string | null): string {
  // 项目根只由 ctx.directory 决定，与 db 路径重定向（OPENNOVEL_DB）解耦：
  // 旧实现经 db 路径反推（join(dirname(getDbPath(directory)), "..")），env 误设时
  // 会静默读错项目根、配置读取降级默认值；无 env 时反推本就是恒等变换
  return directory ?? process.cwd()
}

/**
 * 计算下一个版本号。版本号从 1 起，按已有版本最大值 +1。
 */
export async function nextVersion(db: ReturnType<typeof getDb>, chapterId: string): Promise<number> {
  const rows = await db
    .select({ version: ChapterVersionTable.version })
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, chapterId))
    .orderBy(desc(ChapterVersionTable.version))
    .limit(1)
    .all()
  return (rows[0]?.version ?? 0) + 1
}

/** 系统提示注入用的活跃弧光渲染（【结构线/弧光 — 本章需推进】段）。 */
export function formatActiveArcs(arcs: StoryArcSummary[]): string[] {
  if (arcs.length === 0) return []
  const typeLabel: Record<string, string> = { narrative: "主线", character: "角色弧", subplot: "支线" }
  const beatLabel: Record<string, string> = {
    setup: "开场", rising: "升温", turn: "转折", midpoint: "中点",
    crisis: "危机", climax: "高潮", resolution: "结局", note: "备注",
  }
  const lines: string[] = ["【结构线/弧光 — 本章需推进】"]
  for (const arc of arcs) {
    const range =
      arc.plannedStartChapter != null || arc.plannedEndChapter != null
        ? `（规划 ${arc.plannedStartChapter ?? "?"}-${arc.plannedEndChapter ?? "?"} 章）`
        : ""
    const target = arc.targetCharacterName ? ` [角色:${arc.targetCharacterName}]` : ""
    lines.push(`- [${typeLabel[arc.arcType] ?? arc.arcType}] ${arc.title}${target}${range}：${arc.summary || "（无摘要）"}`)
    for (const b of arc.beats) {
      const ch = b.chapterOrder != null ? `第${b.chapterOrder}章` : "未锚定章节"
      const status = b.status === "drafted" || b.status === "reviewed" ? "已写" : "待写"
      lines.push(`    · [${beatLabel[b.kind] ?? b.kind}/${status}] ${ch} ${b.label}${b.summary ? `：${b.summary}` : ""}`)
    }
  }
  lines.push("（以上节点为当前章节窗口内的结构目标；待写节点请在正文中自然推进，已写节点注意承接，勿重复演出）")
  lines.push("")
  return lines
}

/**
 * 校验并自动解析 novel_id。LLM agent 可能传入项目 slug 而非 UUID，
 * 此函数先在 novels 表中查找传入值；若不存在且库中恰好只有一本小说，则返回该小说 ID。
 */
export async function resolveNovelId(db: ReturnType<typeof getDb>, novelId: string): Promise<string> {
  const match = await db.select({ id: NovelTable.id }).from(NovelTable).where(eq(NovelTable.id, novelId)).limit(1).all()
  if (match.length > 0) return novelId
  const all = await db.select({ id: NovelTable.id }).from(NovelTable).limit(2).all()
  if (all.length === 1) return all[0].id
  return novelId
}

/**
 * 解析 relationship 中的角色引用。优先级：char_a_ref/char_b_ref -> char_a_id/char_b_id（UUID 或姓名）。
 * 姓名匹配到多个角色时报错（同名歧义），需用 ref 区分。
 */
export function resolveCharRef(
  d: Record<string, unknown>,
  prefix: "char_a" | "char_b",
  refToId: Map<string, string>,
  nameToIds: Map<string, string[]>,
): { id: string } | { error: string } {
  const ref = d[`${prefix}_ref`]
  if (typeof ref === "string" && ref) {
    const id = refToId.get(ref)
    return id ? { id } : { error: `ref "${ref}" 未匹配到任何角色` }
  }
  const raw = d[`${prefix}_id`]
  if (typeof raw === "string" && raw) {
    if (raw.length === 36 && raw.includes("-")) return { id: raw }
    const ids = nameToIds.get(raw)
    if (ids && ids.length === 1) return { id: ids[0] }
    if (ids && ids.length > 1) return { error: `姓名 "${raw}" 匹配到 ${ids.length} 个角色，存在歧义，请使用 ref` }
    return { error: `姓名 "${raw}" 未匹配到任何角色` }
  }
  return { error: "未提供 ref 或 id" }
}

export function searchSnippet(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text.slice(0, 100)
  const start = Math.max(0, index - 50)
  const end = Math.min(text.length, index + query.length + 50)
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`
}
