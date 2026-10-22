/**
 * novel 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { defineTool } from "../../v2/effect/tool.js"
import { readProjectConfig, writeProjectConfig } from "./project-config.js"
import { ChapterTable, getDb, getNovelForSession, NovelTable, tagNovelSession } from "../session-store.js"
import { projectDirFromCtx } from "./shared.js"

export const novelTools = {
  list_novels: defineTool({
    description:
      "列出当前项目中的所有书籍（id、书名、类型、简介、状态、章节数、创建时间）。在初始化新书之前应先调用本工具，确认项目中是否已存在同名书籍，避免重复创建。",
    args: Schema.Struct({}),
    async execute(_args, ctx) {
      const db = getDb(ctx.directory)
      const novels = await db.select().from(NovelTable).all()
      const list = novels.map((n) => {
        const chapterCount = db
          .select({ c: sql<number>`count(*)` })
          .from(ChapterTable)
          .where(eq(ChapterTable.novel_id, n.id))
          .get()?.c ?? 0
        return {
          id: n.id,
          title: n.title,
          genre: n.genre,
          synopsis: n.synopsis,
          status: n.status,
          chapterCount,
          createdAt: new Date(n.created_at).toISOString(),
        }
      })
      return {
        title: "list_novels",
        output:
          list.length === 0
            ? "当前项目中暂无书籍。"
            : `当前项目共有 ${list.length} 本书籍：\n${list
                .map(
                  (n) =>
                    `- 《${n.title}》（id: ${n.id}，类型：${n.genre}，章节：${n.chapterCount}，状态：${n.status}）`,
                )
                .join("\n")}`,
        metadata: { novels: list },
      }
    },
  }),

  init_novel: defineTool({
    description:
      "初始化一本新书并绑定到当前会话。未绑定书籍的全局对话专用：根据对话中讨论好的书籍创意创建小说记录（书名/类型/简介），创建后当前会话自动成为该书的主会话，随后可直接使用 save_novel_settings 保存设定、generate_master_outline 生成总纲等写作工具。若当前会话已绑定书籍则返回已有绑定，不重复创建。若项目中已存在同名书籍，不会重复创建，而是将当前会话绑定到已有书籍。",
    args: Schema.Struct({
      title: Schema.String.annotate({ description: "书名" }),
      genre: Schema.String.annotate({ description: "类型，必须是：玄幻/都市/仙侠/历史/科幻/悬疑/言情/游戏 之一" }),
      synopsis: Schema.String.annotate({ description: "一句话简介或故事梗概" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      // 已绑定会话不重复创建，防止一个会话挂多本书
      const bound = await getNovelForSession(ctx.sessionID, ctx.directory)
      if (bound) {
        const [existing] = await db.select().from(NovelTable).where(eq(NovelTable.id, bound)).limit(1).all()
        return {
          title: "init_novel",
          output: `当前会话已绑定书籍《${existing?.title ?? bound}》（id: ${bound}），无需重复初始化。如需另开新书，请新建全局对话。`,
        }
      }
      const GENRES = ["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"]
      if (!GENRES.includes(args.genre)) {
        return { title: "init_novel", output: `类型「${args.genre}」不合法，必须是：${GENRES.join("/")} 之一` }
      }
      // 项目级同名去重：同项目已存在同名书籍时直接绑定，不重复 INSERT
      const title = args.title.trim()
      const [existingNovel] = await db
        .select()
        .from(NovelTable)
        .where(eq(NovelTable.title, title))
        .limit(1)
        .all()
      if (existingNovel) {
        await tagNovelSession(ctx.sessionID, existingNovel.id, ctx.directory)
        return {
          title: "init_novel",
          output: `项目中已存在同名书籍《${existingNovel.title}》（id: ${existingNovel.id}，类型：${existingNovel.genre}），已将当前会话绑定到该书籍，未重复创建。如果确实需要另开一本不同的书，请先修改书名再试。`,
          metadata: { novelId: existingNovel.id, reused: true },
        }
      }
      const id = crypto.randomUUID()
      const now = Date.now()
      await db
        .insert(NovelTable)
        .values({
          id,
          title,
          genre: args.genre,
          synopsis: args.synopsis.trim(),
          status: "draft",
          created_at: now,
          updated_at: now,
        })
        .run()
      await tagNovelSession(ctx.sessionID, id, ctx.directory)
      return {
        title: "init_novel",
        output: `已创建书籍《${title}》（id: ${id}，类型：${args.genre}）并绑定到当前会话。下一步建议：用 save_novel_settings 保存世界观/角色等设定，再用 generate_master_outline 生成整体大纲。`,
        metadata: { novelId: id },
      }
    },
  }),

  check_project_config: defineTool({
    description:
      "一键拉取项目配置文件的关键字段概览。读取 opennovel.json（model/small_model/default_agent/username/share/autoupdate/logLevel）和 .novel/config.json（name/created_at/version/writing_mode/setup_mode），供 director 路由'改模型配置/改项目名称/查看当前配置/切换写作模式'类指令使用。仅查询不修改，文件不存在或字段不在白名单时跳过。",
    args: Schema.Struct({}),
    async execute(_args, ctx) {
      return readProjectConfig(projectDirFromCtx(ctx.directory))
    },
  }),

  update_project_config: defineTool({
    description:
      "更新项目配置文件的白名单字段。target=opennovel 时改 opennovel.json，支持 model（provider/model 格式）、small_model、default_agent、username、share、autoupdate、logLevel；target=novel 时改 .novel/config.json，支持 name、version、writing_mode（auto 自动 / review 审核）、setup_mode（interactive 确认 / auto 自动）。改前自动备份原文件到 <file>.bak；拒绝改 provider/mcp/permission/plugin/agent.*.permission 等敏感字段（防止越权改认证信息或权限）。",
    args: Schema.Struct({
      target: Schema.Literals(["opennovel", "novel"]).annotate({
        description: "目标配置文件：opennovel=opennovel.json，novel=.novel/config.json",
      }),
      field: Schema.String.annotate({ description: "要修改的字段名（受白名单限制，见 description）" }),
      value: Schema.String.annotate({
        description:
          "新值。字符串字段（model/name 等）直接传字符串；enum/boolean 字段传 JSON 字面量如 true / \"auto\" / \"DEBUG\"",
      }),
    }),
    async execute(args, ctx) {
      return writeProjectConfig(
        projectDirFromCtx(ctx.directory),
        args.target as "opennovel" | "novel",
        args.field,
        args.value,
      )
    },
  }),
}
