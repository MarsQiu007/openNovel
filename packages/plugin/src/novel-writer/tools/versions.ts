/**
 * versions 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { and, desc, eq, sql } from "drizzle-orm"
import { defineTool } from "../../v2/effect/tool.js"
import { ChapterTable, ChapterVersionTable, getDb } from "../session-store.js"
import { computeParagraphDiff } from "./paragraph-diff.js"

export const versionsTools = {
  list_chapter_versions: defineTool({
    description:
      "列出某章节的所有历史版本（按版本号降序）。返回每版的 version 号、字数、创建时间、创建者，以及前 80 字摘要预览。**不返回完整正文**（用 read_chapter_version 读取指定版本）。常用于：发现误改后查看历史、或修订前对比上下文。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      limit: Schema.optional(Schema.Number.annotate({ description: "最多返回条数，默认 20" })),
      offset: Schema.optional(Schema.Number.annotate({ description: "跳过前 N 条，默认 0（用于分页翻看更早版本）" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      // 校验 chapter 存在
      const [chapter] = await db
        .select({ id: ChapterTable.id, title: ChapterTable.title, order: ChapterTable.order })
        .from(ChapterTable)
        .where(eq(ChapterTable.id, args.chapter_id))
        .all()
      if (!chapter) {
        return { title: "list_chapter_versions", output: `章节不存在：${args.chapter_id}` }
      }
      const total = await db
        .select({ c: sql<number>`count(*)` })
        .from(ChapterVersionTable)
        .where(eq(ChapterVersionTable.chapter_id, args.chapter_id))
        .get()
      const totalCount = total?.c ?? 0
      const rows = await db
        .select()
        .from(ChapterVersionTable)
        .where(eq(ChapterVersionTable.chapter_id, args.chapter_id))
        .orderBy(desc(ChapterVersionTable.version))
        .limit(args.limit ?? 20)
        .offset(args.offset ?? 0)
        .all()
      if (rows.length === 0) {
        return {
          title: "list_chapter_versions",
          output: `第${chapter.order}章 ${chapter.title} 暂无任何版本记录（异常：章节存在但无 version 行）`,
        }
      }
      const lines: string[] = [`第${chapter.order}章 ${chapter.title} — 共 ${totalCount} 个版本，显示 ${rows.length} 条：`]
      for (const r of rows) {
        const time = new Date(r.created_at).toLocaleString("zh-CN")
        const summary = r.content.replace(/\s+/g, " ").slice(0, 80)
        const marker = r.version === rows[0].version ? "（最新）" : ""
        lines.push(`\n[v${r.version}] ${time} by ${r.created_by} | ${r.word_count} 字${marker}\n  ${summary}…`)
      }
      return {
        title: "list_chapter_versions",
        output: lines.join("\n"),
        metadata: {
          chapter_id: args.chapter_id,
          total: totalCount,
          returned: rows.length,
          offset: args.offset ?? 0,
          latest_version: rows[0].version,
          versions: rows.map((r) => ({
            version: r.version,
            word_count: r.word_count,
            created_at: r.created_at,
            created_by: r.created_by,
            preview: r.content.replace(/\s+/g, " ").slice(0, 80),
          })),
        },
      }
    },
  }),
  read_chapter_version: defineTool({
    description:
      "读取章节的指定历史版本的完整正文。默认 read_chapter_content 只读最新版本；想查看历史版本（修订前/驳回前）必须用本工具。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      version: Schema.Number.check(Schema.isMultipleOf(1), Schema.isGreaterThan(0)).annotate({
        description: "版本号（整数，从 1 起；用 list_chapter_versions 查到）",
      }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const [chapter] = await db
        .select({ id: ChapterTable.id, order: ChapterTable.order, title: ChapterTable.title })
        .from(ChapterTable)
        .where(eq(ChapterTable.id, args.chapter_id))
        .all()
      if (!chapter) {
        return { title: "read_chapter_version", output: `章节不存在：${args.chapter_id}` }
      }
      const [row] = await db
        .select()
        .from(ChapterVersionTable)
        .where(and(eq(ChapterVersionTable.chapter_id, args.chapter_id), eq(ChapterVersionTable.version, args.version)))
        .all()
      if (!row) {
        return {
          title: "read_chapter_version",
          output: `第${chapter.order}章 不存在 v${args.version}（用 list_chapter_versions 查看可用版本号）`,
        }
      }
      return {
        title: `read_chapter_version（v${args.version}）`,
        output:
          `第${chapter.order}章《${chapter.title}》v${args.version}（${row.word_count} 字，${new Date(row.created_at).toLocaleString("zh-CN")} by ${row.created_by}）：\n\n` +
          row.content,
        metadata: {
          chapter_id: args.chapter_id,
          version: row.version,
          word_count: row.word_count,
          created_at: row.created_at,
          created_by: row.created_by,
        },
      }
    },
  }),
  diff_chapter_version: defineTool({
    description:
      "对比某章节任意两个版本的差异（段落级 diff，+ 新增 / - 删除 / 空格 相同）。to_version 默认取最新版本。用于：审批驳回后查看 LLM 改了哪些地方、user 手动修订后看与上一版差异。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      from_version: Schema.Number.check(Schema.isMultipleOf(1), Schema.isGreaterThan(0)).annotate({
        description: "起始版本（旧版）",
      }),
      to_version: Schema.optional(
        Schema.Number.check(Schema.isMultipleOf(1), Schema.isGreaterThan(0)).annotate({
          description: "目标版本（新版），默认取最新版本",
        }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const [chapter] = await db
        .select({ id: ChapterTable.id, order: ChapterTable.order, title: ChapterTable.title })
        .from(ChapterTable)
        .where(eq(ChapterTable.id, args.chapter_id))
        .all()
      if (!chapter) {
        return { title: "diff_chapter_version", output: `章节不存在：${args.chapter_id}` }
      }
      // 解析 to_version
      let targetVersion = args.to_version
      if (targetVersion == null) {
        const [latest] = await db
          .select({ version: ChapterVersionTable.version })
          .from(ChapterVersionTable)
          .where(eq(ChapterVersionTable.chapter_id, args.chapter_id))
          .orderBy(desc(ChapterVersionTable.version))
          .limit(1)
          .all()
        if (!latest) {
          return { title: "diff_chapter_version", output: "该章节无任何版本" }
        }
        targetVersion = latest.version
      }
      if (args.from_version === targetVersion) {
        return {
          title: "diff_chapter_version",
          output: `from_version 与 to_version 相同（都是 v${args.from_version}），无差异可对比`,
        }
      }
      const [fromRow] = await db
        .select()
        .from(ChapterVersionTable)
        .where(
          and(eq(ChapterVersionTable.chapter_id, args.chapter_id), eq(ChapterVersionTable.version, args.from_version)),
        )
        .all()
      const [toRow] = await db
        .select()
        .from(ChapterVersionTable)
        .where(and(eq(ChapterVersionTable.chapter_id, args.chapter_id), eq(ChapterVersionTable.version, targetVersion)))
        .all()
      if (!fromRow || !toRow) {
        const missing = [fromRow ? null : `v${args.from_version}`, toRow ? null : `v${targetVersion}`].filter(Boolean)
        return {
          title: "diff_chapter_version",
          output: `版本不存在：${missing.join("、")}（用 list_chapter_versions 查看可用版本号）`,
        }
      }
      // 段落级 diff：按 \n 切，简化 LCS 求最长公共子序列对齐
      const split = (s: string) => s.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0)
      const a = split(fromRow.content)
      const b = split(toRow.content)
      const diff = computeParagraphDiff(a, b)
      let added = 0
      let removed = 0
      const lines: string[] = []
      for (const op of diff) {
        if (op.kind === "same") {
          lines.push(`  ${op.text}`)
        } else if (op.kind === "add") {
          added += op.text.length
          lines.push(`+ ${op.text}`)
        } else {
          removed += op.text.length
          lines.push(`- ${op.text}`)
        }
      }
      const header =
        `第${chapter.order}章《${chapter.title}》v${args.from_version} → v${targetVersion} 段落级 diff：\n` +
        `字数：v${args.from_version}=${fromRow.word_count} → v${targetVersion}=${toRow.word_count}（Δ ${toRow.word_count - fromRow.word_count}）\n` +
        `段落级：+${added} 字 / -${removed} 字（粗略统计按行长度）\n` +
        `（"+ "为新增段、"  "为相同段、"- "为删除段；段落按 \\\\n 切分，最长公共子序列对齐）\n\n`
      return {
        title: `diff_chapter_version（v${args.from_version} → v${targetVersion}）`,
        output: header + lines.join("\n"),
        metadata: {
          chapter_id: args.chapter_id,
          from_version: args.from_version,
          to_version: targetVersion,
          from_word_count: fromRow.word_count,
          to_word_count: toRow.word_count,
          added_chars: added,
          removed_chars: removed,
          same_paragraphs: diff.filter((d) => d.kind === "same").length,
          added_paragraphs: diff.filter((d) => d.kind === "add").length,
          removed_paragraphs: diff.filter((d) => d.kind === "remove").length,
        },
      }
    },
  }),
  restore_chapter_version: defineTool({
    description:
      "把章节回滚到指定历史版本。**采用追加新版本语义**：不会删除中间任何历史版本，而是把目标 version 的 content 复制为新的 latest version（version 号 = 当前最新 + 1）。同时同步更新 ChapterTable.content 字段。这样：(1) 完整保留所有修订轨迹；(2) review/审批流仍按 latest 工作。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      target_version: Schema.Number.check(Schema.isMultipleOf(1), Schema.isGreaterThan(0)).annotate({
        description: "要回滚到的目标版本号（用 list_chapter_versions 查到）",
      }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const [chapter] = await db
        .select({ id: ChapterTable.id, order: ChapterTable.order, title: ChapterTable.title })
        .from(ChapterTable)
        .where(eq(ChapterTable.id, args.chapter_id))
        .all()
      if (!chapter) {
        return { title: "restore_chapter_version", output: `章节不存在：${args.chapter_id}` }
      }
      const [targetRow] = await db
        .select()
        .from(ChapterVersionTable)
        .where(
          and(
            eq(ChapterVersionTable.chapter_id, args.chapter_id),
            eq(ChapterVersionTable.version, args.target_version),
          ),
        )
        .all()
      if (!targetRow) {
        return {
          title: "restore_chapter_version",
          output: `v${args.target_version} 不存在（用 list_chapter_versions 查看可用版本号）`,
        }
      }
      const [latest] = await db
        .select({ version: ChapterVersionTable.version, word_count: ChapterVersionTable.word_count })
        .from(ChapterVersionTable)
        .where(eq(ChapterVersionTable.chapter_id, args.chapter_id))
        .orderBy(desc(ChapterVersionTable.version))
        .limit(1)
        .all()
      const oldLatestVersion = latest?.version ?? 0
      if (targetRow.version === oldLatestVersion) {
        return {
          title: "restore_chapter_version",
          output: `v${targetRow.version} 已经是最新版本，无需回滚`,
        }
      }
      // 复制为新 latest version
      const newVersion = oldLatestVersion + 1
      await db
        .insert(ChapterVersionTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: args.chapter_id,
          version: newVersion,
          content: targetRow.content,
          word_count: targetRow.word_count,
          created_at: Date.now(),
          created_by: `restore_from_v${targetRow.version}`,
        })
        .run()
      // 同步 ChapterTable.content 字段（保持一致）
      await db
        .update(ChapterTable)
        .set({ content: targetRow.content, word_count: targetRow.word_count, updated_at: Date.now() })
        .where(eq(ChapterTable.id, args.chapter_id))
        .run()
      return {
        title: `restore_chapter_version（v${targetRow.version} → 新 v${newVersion}）`,
        output:
          `已回滚第${chapter.order}章《${chapter.title}》：v${oldLatestVersion} → v${newVersion}（内容拷贝自 v${targetRow.version}，${targetRow.word_count} 字）\n` +
          `所有历史版本已保留（v1 ~ v${newVersion}），可随时再次回滚。`,
        metadata: {
          chapter_id: args.chapter_id,
          target_version: targetRow.version,
          old_latest_version: oldLatestVersion,
          new_version: newVersion,
          restored_content_preview: targetRow.content.replace(/\s+/g, " ").slice(0, 200),
        },
      }
    },
  }),
}
