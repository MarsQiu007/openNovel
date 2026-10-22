/**
 * hooks 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import { getHookStats, HOOK_TYPES, trackHook } from "../hook-rotation.js"
import { getDb } from "../session-store.js"
import { resolveNovelId } from "./shared.js"

export const hooksTools = {
  record_hook: defineTool({
    description:
      "记录本章使用的钩子类型。每章写完后调用，用于钩子轮换统计，避免连续 4 章以上使用同一类型。钩子类型仅限：foreshadow_plant（埋设伏笔）、face_slap（打脸反转）、power_up（能力升级）、emotional_peak（情感高潮）。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      hook_type: Schema.Literals(HOOK_TYPES).annotate({ description: "本章使用的钩子类型" }),
      chapter_id: Schema.optional(Schema.String.annotate({ description: "关联章节 ID（可选）" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      await trackHook(novelId, args.hook_type, args.chapter_id, ctx.directory)
      const stats = await getHookStats(novelId, 10, ctx.directory)
      const note = stats.warning ? `\n⚠️ ${stats.warning}` : ""
      return {
        title: "record_hook",
        output: `已记录钩子：${args.hook_type}${note}`,
        metadata: { hook_type: args.hook_type, warning: stats.warning },
      }
    },
  }),

  get_hook_stats: defineTool({
    description:
      "查看最近钩子使用统计。返回最近若干条钩子记录；若连续 4 次以上使用同一类型会给出轮换警告。写新章前调用以选择差异化的钩子类型。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      recent_count: Schema.optional(Schema.Number.annotate({ description: "查询最近多少条记录（默认 10）" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const stats = await getHookStats(novelId, args.recent_count ?? 10, ctx.directory)
      if (stats.hooks.length === 0) {
        return { title: "get_hook_stats", output: "暂无钩子记录" }
      }
      const lines = stats.hooks.map(
        (h, i) => `${i + 1}. ${h.hookType}${h.chapterId ? " (" + h.chapterId.slice(0, 8) + ")" : ""}`,
      )
      if (stats.warning) lines.push("", `⚠️ ${stats.warning}`)
      return {
        title: "get_hook_stats",
        output: lines.join("\n"),
        metadata: { count: stats.hooks.length, warning: stats.warning, hooks: stats.hooks },
      }
    },
  }),
}
