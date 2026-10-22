/**
 * misc 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { eq } from "drizzle-orm"
import { Schema } from "effect"
import type { SessionDomain } from "../../v2/effect/session.js"
import { defineTool } from "../../v2/effect/tool.js"
import { splitParagraphs } from "../annotation.js"
import { validateWorldMapAiDraft } from "../map-ai.js"
import { ChapterTable, createAnnotation, getDb, getWorldMapByStatus, replaceWorldMapDraft } from "../session-store.js"
import { resolveSessionNovel } from "./session-novel.js"

export function createMiscTools(deps: { session: SessionDomain }) {
  return {
    polish_paragraph: defineTool({
      description:
        "对指定段落生成润色建议并保存为批注。作者可之后采纳或拒绝。不直接修改正文。",
      args: Schema.Struct({
        chapter_id: Schema.String.annotate({ description: "章节 ID" }),
        paragraph_index: Schema.Number.annotate({ description: "段落索引（从 0 开始）" }),
        comment: Schema.String.annotate({ description: "润色说明" }),
        suggested_replacement: Schema.String.annotate({ description: "润色后的文本" }),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "polish_paragraph", output: "未找到当前小说项目" }
        const db = getDb(ctx.directory)
        const chapter = await db
          .select()
          .from(ChapterTable)
          .where(eq(ChapterTable.id, args.chapter_id))
          .get()
        if (!chapter) return { title: "polish_paragraph", output: "章节不存在" }
        const paragraphs = splitParagraphs(chapter.content)
        const quote = paragraphs[args.paragraph_index] ?? ""
        const ann = await createAnnotation(
          {
            novelId,
            targetType: "chapter",
            targetId: args.chapter_id,
            field: "content",
            source: "ai",
            anchorType: "paragraph",
            paragraphIndex: args.paragraph_index,
            quote,
            comment: args.comment,
            suggestedReplacement: args.suggested_replacement,
          },
          ctx.directory,
        )
        return {
          title: "polish_paragraph",
          output: "已生成润色建议",
          metadata: { annotation_id: ann.id, paragraph_index: ann.paragraph_index, quote },
        }
      },
    }),
    write_world_map_draft: defineTool({
      description:
        "把 AI 生成的结构化世界地图写入草稿。传入用户指定的 novel_id；已有草稿时必须先获得用户确认再传 allow_replace=true。该工具会替换旧草稿的要素和图钉，不影响正式地图。",
      args: Schema.Struct({
        novel_id: Schema.String.annotate({ description: "小说 ID" }),
        title: Schema.String.annotate({ description: "AI 生成的地图标题" }),
        description: Schema.String.annotate({ description: "一句话地图描述" }),
        features_json: Schema.String.annotate({ description: "结构化要素数组 JSON，遵循世界地图生成提示词" }),
        allow_replace: Schema.Boolean.annotate({ description: "已有草稿时是否允许替换；必须先向用户确认" }),
      }),
      async execute(args, ctx) {
        const boundNovelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!boundNovelId || boundNovelId !== args.novel_id) {
          return { title: "write_world_map_draft", output: "会话未绑定到目标小说，禁止写入地图草稿" }
        }
        const existing = await getWorldMapByStatus(boundNovelId, "draft", ctx.directory)
        if (existing && !args.allow_replace) {
          return { title: "write_world_map_draft", output: "已存在地图草稿，必须先获得用户明确确认后才能替换" }
        }
        let rawDraft: unknown
        try {
          rawDraft = JSON.parse(args.features_json)
        } catch {
          return { title: "write_world_map_draft", output: "features_json 不是合法 JSON" }
        }
        const validated = validateWorldMapAiDraft({
          title: args.title,
          description: args.description,
          features: rawDraft,
        })
        if (!validated.ok) return { title: "write_world_map_draft", output: validated.error }
        const map = await replaceWorldMapDraft(
          boundNovelId,
          {
            title: validated.draft.title,
            description: validated.draft.description,
            features: validated.draft.features,
          },
          ctx.directory,
        )
        return {
          title: "write_world_map_draft",
          output: `已写入 AI 地图草稿「${validated.draft.title}」（${validated.draft.features.length} 个要素）`,
          metadata: { map_id: map.id, feature_count: validated.draft.features.length },
        }
      },
    }),
  }
}
