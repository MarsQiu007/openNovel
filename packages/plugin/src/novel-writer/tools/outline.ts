/**
 * outline 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { and, eq } from "drizzle-orm"
import { Schema } from "effect"
import type { SessionDomain } from "../../v2/effect/session.js"
import { defineTool } from "../../v2/effect/tool.js"
import { sanitizeLayout, defaultLayout } from "../outline-canvas.js"
import { generateChapterOutline, generateMasterOutline, generateVolumeOutline } from "../outline.js"
import { readChapterOutline } from "../pipeline.js"
import { performVolumeRollup } from "../rollup.js"
import {
  ChapterTable,
  getDb,
  getOutlineCanvasLayout,
  listStructureForEditor,
  NovelTable,
  resolveChapterOutline,
  resolveMasterOutline,
  resolveVolumeOutline,
  upsertOutlineCanvasLayout,
  VolumeTable,
} from "../session-store.js"
import { projectDirFromCtx, resolveNovelId } from "./shared.js"
import { resolveSessionNovel } from "./session-novel.js"

export function createOutlineTools(deps: { session: SessionDomain }) {
  return {
    generate_master_outline: defineTool({
      description:
        "生成整体大纲，写入数据库。传入 content 参数时使用实际内容；不传时生成空模板。director 应先根据小说设定生成实际大纲内容再传入。",
      args: Schema.Struct({
        novel_id: Schema.String.annotate({ description: "小说 ID" }),
        content: Schema.String.annotate({
          description:
            "大纲 Markdown 全文。director 根据小说设定（角色/世界观/伏笔/卷纲等）生成实际内容后传入。留空则生成模板。",
        }),
      }),
      async execute(args, ctx) {
        const db = getDb(ctx.directory)
        const novelId = await resolveNovelId(db, args.novel_id)
        const projectDir = projectDirFromCtx(ctx.directory)
        const result = await generateMasterOutline(novelId, projectDir, args.content || undefined)
        return {
          title: "generate_master_outline",
          output: `已生成整体大纲（${result.length} 字）${args.content ? "" : "（模板，需填充内容）"}`,
          metadata: { novel_id: novelId, length: result.length },
        }
      },
    }),

    generate_volume_outline: defineTool({
      description:
        "生成卷大纲，创建 volumes 表记录并写入数据库。传入 content 参数时使用实际内容；不传时生成空模板。director 应先根据小说设定生成实际卷大纲内容再传入。",
      args: Schema.Struct({
        novel_id: Schema.String.annotate({ description: "小说 ID" }),
        volume_number: Schema.Number.annotate({ description: "卷号（从 1 开始）" }),
        title: Schema.String.annotate({
          description: "卷标题（如'卷一·军校风云'）。重新生成时传入新标题会更新原有记录。留空则使用'第X卷'。",
        }),
        content: Schema.String.annotate({
          description: "卷大纲 Markdown 全文。director 根据小说设定生成实际内容后传入。留空则生成模板。",
        }),
      }),
      async execute(args, ctx) {
        const db = getDb(ctx.directory)
        const novelId = await resolveNovelId(db, args.novel_id)
        const projectDir = projectDirFromCtx(ctx.directory)
        const result = await generateVolumeOutline(
          novelId,
          args.volume_number,
          projectDir,
          args.content || undefined,
          args.title || undefined,
        )
        return {
          title: "generate_volume_outline",
          output: `已生成第${args.volume_number}卷大纲（${result.length} 字）${args.content ? "" : "（模板，需填充内容）"}`,
          metadata: { novel_id: novelId, volume_number: args.volume_number, length: result.length },
        }
      },
    }),

    generate_chapter_outline: defineTool({
      description:
        "生成章节大纲，创建 chapters 表记录并写入数据库。自动创建所属卷记录。传入 content 参数时使用实际内容（由大纲 agent 生成完整章纲后传入）；不传时生成空模板。生成后可在 WebUI 大纲标签页查看。卷长度由剧情决定：省略 volume_number 时沿用上一章所属卷；仅当本章在剧情上开启新卷时才传入新卷号（通常先调用 generate_volume_outline 生成该卷大纲），此时会自动对上一卷执行卷级汇总。",
      args: Schema.Struct({
        novel_id: Schema.String.annotate({ description: "小说 ID" }),
        chapter_number: Schema.Number.annotate({ description: "章节序号（从 1 开始）" }),
        title: Schema.String.annotate({
          description: "章节标题（如'第一章 觉醒'）。重新生成时传入新标题会更新原有记录。留空则使用'第X章'。",
        }),
        content: Schema.String.annotate({
          description:
            "章节大纲 Markdown 全文。director 应先阅读小说设定（角色/卷纲/伏笔/前文摘要等），根据剧情发展生成实际的章节大纲内容后传入。包含：章节目标、关键场景（地点/时间/角色/概要/字数）、角色出场、剧情推进等。留空则生成模板。",
        }),
        volume_number: Schema.optional(
          Schema.Number.annotate({
            description:
              "所属卷号（可选）。省略时沿用上一章所属卷；仅当本章在剧情上开启新卷时传入新卷号。传入与上一章不同的卷号会自动对上一卷做卷级汇总。",
          }),
        ),
      }),
      async execute(args, ctx) {
        const db = getDb(ctx.directory)
        const novelId = await resolveNovelId(db, args.novel_id)
        const projectDir = projectDirFromCtx(ctx.directory)
        // 剧情上开启新卷时，先对上一卷做卷级汇总（幂等：先删后插，可安全重复）
        let rollupNote = ""
        if (args.volume_number !== undefined && args.chapter_number > 1) {
          const prev = await db
            .select()
            .from(ChapterTable)
            .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, args.chapter_number - 1)))
            .get()
          const prevVolume = prev?.volume_id
            ? await db.select().from(VolumeTable).where(eq(VolumeTable.id, prev.volume_id)).get()
            : undefined
          if (prevVolume && prevVolume.order !== args.volume_number) {
            const rollup = await performVolumeRollup(novelId, prevVolume.order, ctx.directory)
            if (rollup) {
              rollupNote = `\n第${prevVolume.order}卷已随新卷开启完成卷级汇总（卷摘要/角色休眠标记/线索归档）`
            }
          }
        }
        const result = await generateChapterOutline(
          novelId,
          args.chapter_number,
          projectDir,
          args.content || undefined,
          args.title || undefined,
          args.volume_number,
        )
        return {
          title: "generate_chapter_outline",
          output: `已生成第${args.chapter_number}章大纲（${result.length} 字）${args.content ? "" : "（模板，需填充内容）"}${rollupNote}`,
          metadata: { novel_id: novelId, chapter_number: args.chapter_number, length: result.length },
        }
      },
    }),

    read_chapter_outline: defineTool({
      description:
        "读取章节大纲。返回章节元信息与章纲正文（数据库优先，旧文件兜底）。流水线步骤1（plan）。",
      args: Schema.Struct({
        novel_id: Schema.String.annotate({ description: "小说 ID" }),
        chapter_number: Schema.Number.annotate({ description: "章节序号" }),
      }),
      async execute(args, ctx) {
        const db = getDb(ctx.directory)
        const novelId = await resolveNovelId(db, args.novel_id)
        const chapter = await readChapterOutline(novelId, args.chapter_number, ctx.directory)
        if (!chapter) {
          return {
            title: "read_chapter_outline",
            output: `第${args.chapter_number}章不存在，请先调用 generate_chapter_outline 生成大纲`,
          }
        }
        const resolvedOutline = await resolveChapterOutline(novelId, args.chapter_number, ctx.directory)
        const outlineSection = resolvedOutline.available
          ? `章纲正文：\n${resolvedOutline.outline}`
          : resolvedOutline.outline
            ? `章纲正文：现有内容不是可用章纲（空模板或未完成），请补全后重新调用 generate_chapter_outline 并传入完整章纲`
            : `章纲正文：缺失，可调用 generate_chapter_outline 重新生成`
        return {
          title: "read_chapter_outline",
          output: `章节ID：${chapter.id}\n标题：${chapter.title}\n序号：${chapter.order}\n现有字数：${chapter.word_count}\n状态：${chapter.status}\n${outlineSection}`,
          metadata: {
            chapter_id: chapter.id,
            title: chapter.title,
            order: chapter.order,
            word_count: chapter.word_count,
            outline_available: resolvedOutline.available,
            outline_source: resolvedOutline.source,
          },
        }
      },
    }),

    read_outline: defineTool({
      description:
        "读取大纲 Markdown 文件原文。可读取总纲、卷纲或章节大纲，全部从数据库读取；旧项目首次读取时会从存量文件懒导入。",
      args: Schema.Struct({
        type: Schema.Literals(["master", "volume", "chapter"]).annotate({
          description: "大纲类型：master=总纲，volume=卷纲，chapter=章节大纲文件",
        }),
        number: Schema.optional(
          Schema.Number.annotate({ description: "卷号（type=volume 时必填）或章节序号（type=chapter 时必填）" }),
        ),
        novel_id: Schema.optional(
          Schema.String.annotate({
            description: "小说 ID（type=chapter 时用于数据库优先读取；省略且项目只有一本小说时可自动解析）",
          }),
        ),
      }),
      async execute(args, ctx) {
        if ((args.type === "volume" || args.type === "chapter") && typeof args.number !== "number") {
          return { title: "read_outline", output: `type=${args.type} 时必须提供 number 参数` }
        }
        if (args.type === "chapter") {
          if (typeof args.number !== "number") {
            return { title: "read_outline", output: `type=chapter 时必须提供 number 参数` }
          }
          const db = getDb(ctx.directory)
          let novelId: string | null = null
          if (args.novel_id) {
            novelId = await resolveNovelId(db, args.novel_id)
          } else {
            const novels = db.select({ id: NovelTable.id }).from(NovelTable).all()
            if (novels.length === 1) novelId = novels[0]!.id
          }
          if (novelId) {
            const resolvedOutline = await resolveChapterOutline(novelId, args.number, ctx.directory)
            if (resolvedOutline.outline) {
              // 章纲场景硬约束清单：与写作快照同一份确定性编译输出，兜底路径同样注入硬约束
              const { compileSceneChecklist } = await import("../scene-constraints.js")
              const sceneChecklist = compileSceneChecklist(resolvedOutline.outline)
              const output = sceneChecklist
                ? `${resolvedOutline.outline}

═══ 章纲场景硬约束清单 ═══
本章正文必须逐场景落实以下清单。清单与字数、角色白名单同为硬约束。
${sceneChecklist}`
                : resolvedOutline.outline
              return {
                title: "read_outline",
                output,
                metadata: {
                  source: resolvedOutline.source,
                  chapter_number: args.number,
                  length: output.length,
                },
              }
            }
          }
        }
        if (args.type === "master") {
          const db = getDb(ctx.directory)
          let novelId: string | null = null
          if (args.novel_id) {
            novelId = await resolveNovelId(db, args.novel_id)
          } else {
            const novels = db.select({ id: NovelTable.id }).from(NovelTable).all()
            if (novels.length === 1) novelId = novels[0]!.id
          }
          if (novelId) {
            const resolved = await resolveMasterOutline(novelId, ctx.directory)
            if (resolved.outline) {
              return { title: "read_outline", output: resolved.outline, metadata: { source: resolved.source, length: resolved.outline.length } }
            }
          }
          return { title: "read_outline", output: "总纲不存在。请先调用 generate_master_outline 工具生成。" }
        }
        if (args.type === "volume") {
          const db = getDb(ctx.directory)
          let novelId: string | null = null
          if (args.novel_id) {
            novelId = await resolveNovelId(db, args.novel_id)
          } else {
            const novels = db.select({ id: NovelTable.id }).from(NovelTable).all()
            if (novels.length === 1) novelId = novels[0]!.id
          }
          if (novelId) {
            const resolved = await resolveVolumeOutline(novelId, args.number!, ctx.directory)
            if (resolved.outline) {
              return { title: "read_outline", output: resolved.outline, metadata: { source: resolved.source, volume_number: args.number, length: resolved.outline.length } }
            }
          }
          return { title: "read_outline", output: `第${args.number}卷大纲不存在。请先调用 generate_volume_outline 工具生成。` }
        }
        return { title: "read_outline", output: "未找到大纲。请先调用对应的 generate_*_outline 工具生成。" }
      },
    }),

    read_outline_canvas: defineTool({
      description: "读取大纲画布布局。损坏时返回自动布局。",
      args: Schema.Struct({}),
      async execute(_args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "read_outline_canvas", output: "未找到当前小说项目" }
        const raw = await getOutlineCanvasLayout(novelId, ctx.directory)
        const data = await listStructureForEditor(novelId, ctx.directory)
        const layout = sanitizeLayout(
          raw?.layout_json,
          defaultLayout(
            data.volumes.map((v) => ({ id: v.id, order: v.order })),
            data.chapters.map((c) => ({ id: c.id, order: c.order, volume_id: c.volume_id })),
          ),
        )
        return {
          title: "read_outline_canvas",
          output: `画布布局：${layout.columns.length} 列，${layout.cards.length} 张卡`,
          metadata: { layout, volumes: data.volumes, arcs: data.arcs, beats: data.beats },
        }
      },
    }),

    write_outline_canvas: defineTool({
      description: "保存大纲画布布局（仅 UI 坐标和视图状态）。",
      args: Schema.Struct({
        layout: Schema.String.annotate({ description: "画布布局 JSON 字符串" }),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "write_outline_canvas", output: "未找到当前小说项目" }
        const parsed = JSON.parse(args.layout)
        const layout = sanitizeLayout(parsed)
        await upsertOutlineCanvasLayout(novelId, layout, ctx.directory)
        return {
          title: "write_outline_canvas",
          output: "画布布局已保存",
          metadata: { columns: layout.columns.length, cards: layout.cards.length },
        }
      },
    }),
  }
}
