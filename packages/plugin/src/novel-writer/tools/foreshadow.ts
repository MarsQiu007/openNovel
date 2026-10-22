/**
 * foreshadow 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { defineTool } from "../../v2/effect/tool.js"
import { normalizeSettingText, SETTING_TEXT_FORMAT_RULE, settingTextFormatError } from "../setting-text.js"
import { createForeshadowing, ForeshadowingTable, getDb, updateForeshadowing } from "../session-store.js"
import { resolveNovelId } from "./shared.js"

export const foreshadowTools = {
  foreshadow_plant: defineTool({
    description:
      "埋设一条新伏笔。伏笔必须具体可查（人物/物品/事件/信息），记录内容和埋设所在章节。重复内容（同 novel 内 content 完全相同）不会重复创建，而是返回已有伏笔。\n\n" +
      SETTING_TEXT_FORMAT_RULE,
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      content: Schema.String.annotate({ description: "伏笔内容（具体、可在未来回收的线索）" }),
      planted_chapter_id: Schema.optional(Schema.String.annotate({ description: "埋设伏笔的章节 ID（不传则不绑定章节）" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      // V2 args 为 readonly，V1 的 args.content 原地归一化改为局部变量
      const content = normalizeSettingText(args.content)
      const textError = settingTextFormatError(content, "foreshadowing", "content")
      if (textError) return { title: "foreshadow_plant", output: `设定文本格式校验失败：${textError}` }
      // 同 novel 内按 content 去重
      const [existing] = await db
        .select()
        .from(ForeshadowingTable)
        .where(and(eq(ForeshadowingTable.novel_id, novelId), eq(ForeshadowingTable.content, content)))
        .limit(1)
        .all()
      if (existing) {
        return {
          title: "foreshadow_plant（已存在）",
          output: `伏笔已存在，未重复创建：${existing.content.slice(0, 60)}（状态=${existing.state}，ID=${existing.id}）`,
          metadata: { id: existing.id, deduplicated: true },
        }
      }
      const row = await createForeshadowing(novelId, content, args.planted_chapter_id ?? null, ctx.directory)
      return {
        title: "foreshadow_plant",
        output: `已埋设伏笔：${row.content.slice(0, 60)}（ID=${row.id}，状态=planted）`,
        metadata: { id: row.id },
      }
    },
  }),

  foreshadow_resolve: defineTool({
    description:
      "回收/推进伏笔。把伏笔状态改为 hinted（暗示）、resolved（已回收）或 abandoned（废弃）。回收时应明确呼应前文，并传入回收所在章节 ID。",
    args: Schema.Struct({
      foreshadowing_id: Schema.String.annotate({ description: "伏笔 ID" }),
      state: Schema.String.annotate({ description: "新状态：hinted / resolved / abandoned" }),
      resolved_chapter_id: Schema.optional(
        Schema.String.annotate({ description: "回收/暗示所在的章节 ID（resolved/hinted 时建议传入）" }),
      ),
    }),
    async execute(args, ctx) {
      if (!["hinted", "resolved", "abandoned"].includes(args.state)) {
        return {
          title: "foreshadow_resolve",
          output: `state 必须是 hinted/resolved/abandoned，收到：${args.state}`,
        }
      }
      const row = await updateForeshadowing(
        args.foreshadowing_id,
        {
          state: args.state,
          resolvedChapterId: args.state === "resolved" ? (args.resolved_chapter_id ?? null) : undefined,
        },
        ctx.directory,
      )
      return {
        title: "foreshadow_resolve",
        output: `伏笔已${args.state === "resolved" ? "回收" : args.state === "hinted" ? "标记为暗示" : "废弃"}：${row.content.slice(0, 60)}`,
        metadata: { id: row.id, state: row.state },
      }
    },
  }),

  foreshadow_list: defineTool({
    description:
      "列出小说的伏笔，可按状态过滤（planted/hinted/resolved/abandoned），返回 ID、内容、状态和所在章节。回收伏笔前用它查找伏笔 ID。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      state: Schema.optional(
        Schema.String.annotate({ description: "按状态过滤：planted / hinted / resolved / abandoned（不传则返回全部）" }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      let rows = await db
        .select()
        .from(ForeshadowingTable)
        .where(eq(ForeshadowingTable.novel_id, novelId))
        .orderBy(asc(ForeshadowingTable.created_at))
        .all()
      if (args.state) rows = rows.filter((r) => r.state === args.state)
      if (rows.length === 0) {
        return { title: "foreshadow_list", output: args.state ? `没有状态为 ${args.state} 的伏笔` : "暂无伏笔" }
      }
      const lines = rows.map(
        (r) =>
          `${r.id} | ${r.state} | ${r.planted_chapter_id ? "埋设" + r.planted_chapter_id.slice(0, 8) + " " : ""}${r.content.slice(0, 80)}`,
      )
      return {
        title: "foreshadow_list",
        output: lines.join("\n"),
        metadata: { count: rows.length, items: rows },
      }
    },
  }),
}
