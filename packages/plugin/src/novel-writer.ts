/**
 * 小说写作插件 - NovelWriterPlugin
 *
 * 注册小说写作所需的 hooks 与写作工具。
 * 遵循 example.ts 的导出模式。
 *
 * DB / session 绑定边界已提取至 session-store.ts。
 */
import type { Plugin } from "./index.js"
import { tool } from "./tool.js"
import { existsSync, readFileSync } from "fs"
import { eq, desc, and, asc, lt, sql } from "drizzle-orm"
import { join, dirname } from "path"
import { assembleSnapshot, parseStyleRules } from "./novel-writer/context.js"
import { readChapterOutline, validateStateDelta, persistStateDelta } from "./novel-writer/pipeline.js"
import { stringifyRules } from "./novel-writer/state-commit.js"
import { generateMasterOutline, generateVolumeOutline, generateChapterOutline } from "./novel-writer/outline.js"
import { checkContinuity, CONTINUITY_DIMENSIONS } from "./novel-writer/continuity-check.js"
import { trackHook, getHookStats, HOOK_TYPES } from "./novel-writer/hook-rotation.js"
import { writerAgentConfig } from "./novel-writer/agents/writer.js"
import { directorAgentConfig } from "./novel-writer/agents/director.js"
import { pipelineAgentConfig } from "./novel-writer/agents/pipeline.js"
import { observerAgent } from "./novel-writer/agents/observer.js"
import { reflectorAgent } from "./novel-writer/agents/reflector.js"
import { auditorAgent } from "./novel-writer/agents/auditor.js"
import { reviserAgent } from "./novel-writer/agents/reviser.js"
import { architectAgent } from "./novel-writer/agents/architect.js"
import {
  commitState,
  StateDeltaSchema,
  scanReferences,
  cascadeCheck,
  cascadeCreateTasks,
  cascadeListPending,
  cascadeResolve,
  cascadeRebuildRefs,
  cascadeExecute,
  cascadeGetStatus,
  deduplicateCharacters,
  deduplicateRelationships,
  archiveDescription,
  listDescriptionHistory,
  restoreDescription,
} from "./novel-writer/state-commit.js"
import {
  getDb,
  NovelTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterTable,
  VolumeTable,
  WorldEntryTable,
  PlotThreadTable,
  ForeshadowingTable,
  StyleGuideTable,
  RelationshipTable,
  PendingUpdateTable,
  ChapterReviewTable,
  ChapterSummaryTable,
  CharacterStateTable,
  TensionLogTable,
  EntityRefTable,
  NovelStateLogTable,
  HookRotationTable,
  resolveNovelForSession,
  tagNovelSession,
  getNovelForSession,
  isNovelSession,
  getDbPath,
  createChapterReview,
  listChapterReviews,
  deleteChapter,
  updateChapter,
  deleteCharacter,
  deleteWorldEntry,
  deletePlotThread,
  deleteForeshadowing,
  deleteVolume,
  deleteRelationship,
  updateRelationship,
  updatePlotThread,
  updateForeshadowing,
  updateWorldEntry,
  createForeshadowing,
} from "./novel-writer/session-store.js"

export { tagNovelSession, getNovelForSession, isNovelSession }

function projectDirFromCtx(directory?: string | null): string {
  const dbPath = getDbPath(directory)
  return join(dirname(dbPath), "..")
}

export const NovelWriterPlugin: Plugin = async (ctx) => {
  return {
    /**
     * 系统提示注入 hook
     * 在系统提示中注入小说写作相关的上下文指令。
     * 非小说会话直接返回，不注入任何内容。
     */
    "experimental.chat.system.transform": async (input, output) => {
      output.system = output.system ?? []
      // 无会话ID时跳过（隐藏agent如compaction/title/summary等）
      if (!input.sessionID) return

      // 已绑定会话直接复用；未绑定时若恰好只有一本小说则懒绑定到该会话。
      const novelId = await resolveNovelForSession(input.sessionID, ctx.directory)
      if (!novelId) return

      // 查询当前最新章节序号
      const db = getDb(ctx.directory)
      const [latestChapter] = await db
        .select()
        .from(ChapterTable)
        .where(eq(ChapterTable.novel_id, novelId))
        .orderBy(desc(ChapterTable.order))
        .limit(1)
        .all()
      const chapterNumber = latestChapter?.order ?? 0

      // 组装上下文快照
      const snapshot = await assembleSnapshot(novelId, chapterNumber, ctx.directory)
      if (!snapshot) return

      // 将快照序列化为文本注入 output.system
      const lines: string[] = ["【小说写作上下文快照】"]
      lines.push("")
      lines.push(`【小说蓝图】\n书名：${snapshot.novelTitle}\n题材：${snapshot.genre}\n梗概：${snapshot.synopsis}`)
      lines.push("")

      if (snapshot.activeCharacters.length > 0) {
        lines.push("【活跃角色】")
        for (const c of snapshot.activeCharacters) {
          lines.push(`- ${c.name}（${c.role}）${c.description ? `：${c.description}` : ""}`)
          if (c.location || c.mood || c.summary) {
            lines.push(`  位置：${c.location} | 情绪：${c.mood} | 状态：${c.summary}`)
          }
        }
        lines.push("")
      }

      if (snapshot.volumeSummary) {
        lines.push(`【当前卷摘要】\n${snapshot.volumeSummary}`)
        lines.push("")
      }

      if (snapshot.recentChapterSummaries.length > 0) {
        lines.push("【最近章节摘要】")
        for (const ch of snapshot.recentChapterSummaries) {
          lines.push(`- 第${ch.chapterOrder}章 ${ch.chapterTitle}：${ch.summary}`)
          if (ch.keyEvents.length > 0) {
            lines.push(`  关键事件：${ch.keyEvents.join("、")}`)
          }
        }
        lines.push("")
      }

      if (snapshot.plotThreads.length > 0) {
        lines.push("【剧情线索】")
        for (const t of snapshot.plotThreads) {
          lines.push(`- ${t.title}（${t.status}）${t.description ? `：${t.description}` : ""}`)
        }
        lines.push("")
      }

      if (snapshot.foreshadowing.length > 0) {
        lines.push("【伏笔】")
        for (const f of snapshot.foreshadowing) {
          lines.push(`- [${f.id}] ${f.content}（${f.state === "planted" ? "已埋设" : "已揭晓"}）`)
        }
        lines.push("")
      }

      if (snapshot.styleGuide) {
        lines.push("【风格指南】")
        if (snapshot.styleGuide.tone) lines.push(`基调：${snapshot.styleGuide.tone}`)
        if (snapshot.styleGuide.pov) lines.push(`视角：${snapshot.styleGuide.pov}`)
        if (snapshot.styleGuide.tense) lines.push(`时态：${snapshot.styleGuide.tense}`)
        lines.push("")
      }

      if (snapshot.genreRules.length > 0) {
        lines.push("【题材规则】")
        for (const rule of snapshot.genreRules) {
          lines.push(`- ${rule}`)
        }
        lines.push("")
      }

      output.system.push(lines.join("\n"))
    },

    /**
     * 会话压缩 hook
     * 压缩时保留小说上下文（角色、剧情、设定等摘要）。
     */
    "experimental.session.compacting": async (input, output) => {
      output.context = output.context ?? []
      if (!input.sessionID) return

      // 已绑定会话直接复用；未绑定时若恰好只有一本小说则懒绑定到该会话。
      const novelId = await resolveNovelForSession(input.sessionID, ctx.directory)
      if (!novelId) return

      const db = getDb(ctx.directory)

      // P0: 小说蓝图（书名、题材、梗概）
      const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
      if (novel) {
        output.context.push(`【小说蓝图】\n书名：${novel.title}\n题材：${novel.genre}\n梗概：${novel.synopsis}`)
      }

      // P1: 活跃角色列表（名称+一句话描述）
      const characters = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()
      if (characters.length > 0) {
        const charLines = characters.map(
          (c) => `- ${c.name}${c.role ? `（${c.role}）` : ""}${c.description ? `：${c.description}` : ""}`,
        )
        output.context.push(`【活跃角色】\n${charLines.join("\n")}`)
      }

      // P2: 当前卷摘要（最新一卷的摘要）
      const volumes = await db
        .select()
        .from(VolumeTable)
        .where(eq(VolumeTable.novel_id, novelId))
        .orderBy(desc(VolumeTable.order))
        .limit(1)
        .all()
      if (volumes.length > 0) {
        const vol = volumes[0]
        output.context.push(`【当前卷摘要】\n卷名：${vol.title}\n摘要：${vol.summary}`)
      }
    },

    /**
     * 写作工具
     * 由 writer / reviser agent 在生成章节内容后调用，负责落库。
     * 工具本身不调用 LLM —— 内容生成由 opennovel 运行时驱动 agent 完成。
     */
    tool: {
      write_chapter: tool({
        description: "撰写小说章节内容。将生成的章节正文写入数据库，并归档一个历史版本。若章节已存在正文则覆盖。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          content: tool.schema.string().describe("章节正文"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
          if (!chapter) return { title: "write_chapter", output: `章节不存在：${args.chapter_id}` }

          const pendingCount = await db
            .select({ id: PendingUpdateTable.id })
            .from(PendingUpdateTable)
            .where(and(eq(PendingUpdateTable.novel_id, chapter.novel_id), eq(PendingUpdateTable.status, "pending")))
            .all()
          if (pendingCount.length > 0) {
            return {
              title: "write_chapter（被门禁拦截）",
              output: `当前小说有 ${pendingCount.length} 个待统改任务未处理。请先调用 cascade_execute 或 cascade_list_pending 处理后再写新内容。`,
              metadata: { blocked: true, pending_count: pendingCount.length },
            }
          }

          // 字数校验：低于目标字数或超过目标 130% 均拒绝写入，强制 writer 补足/精简后再提交
          const target = await getTargetWordCount(db, chapter.novel_id)
          const wordCount = countWords(args.content)
          if (wordCount < target) {
            return {
              title: "write_chapter（字数不达标）",
              output: `字数不足：当前 ${wordCount} 字，本章目标至少 ${target} 字，还差 ${target - wordCount} 字。请扩写正文补足字数后重新调用 write_chapter，不要先写入不足的内容。`,
              metadata: { rejected: true, reason: "too_short", word_count: wordCount, target },
            }
          }
          const maxWords = Math.ceil(target * 1.3)
          if (wordCount > maxWords) {
            return {
              title: "write_chapter（字数超限）",
              output: `字数超限：当前 ${wordCount} 字，本章目标 ${target} 字，最多允许 ${maxWords} 字。请精简后重新调用 write_chapter。`,
              metadata: { rejected: true, reason: "too_long", word_count: wordCount, target },
            }
          }

          // 重复度校验：与前文章节重复（照抄或开头场景重演）拒绝写入，防止重写已写过的内容
          const dup = await checkDuplicateRatio(db, chapter.novel_id, args.content, chapter.order)
          if (dup.duplicate) {
            const why =
              dup.openingRatio > 0.05
                ? `本章开头与前文章节高度相似（相似度约 ${Math.round(dup.openingRatio * 100)}%）`
                : `约 ${Math.round(dup.ratio * 100)}% 的段落与前文相同`
            return {
              title: "write_chapter（与前文重复）",
              output: `检测到与前文章节重复的内容：${why}。例如：${dup.samples.join(" / ")}。禁止重复已写章节的事件和场景，请承接上一章结尾之后重写后重新调用 write_chapter。`,
              metadata: { rejected: true, reason: "duplicate", ratio: dup.ratio, opening_ratio: dup.openingRatio },
            }
          }

          // 归档当前正文为历史版本（仅当已有正文时）
          if (chapter.content.length > 0) {
            await db
              .insert(ChapterVersionTable)
              .values({
                id: crypto.randomUUID(),
                chapter_id: chapter.id,
                version: await nextVersion(db, chapter.id),
                content: chapter.content,
                word_count: chapter.word_count,
                created_by: ctx.agent,
              })
              .run()
          }

          const now = Date.now()
          await db
            .update(ChapterTable)
            .set({ content: args.content, word_count: wordCount, status: "draft", updated_at: now })
            .where(eq(ChapterTable.id, args.chapter_id))
            .run()

          await scanReferences(db, chapter.novel_id, "chapter", args.chapter_id, "content", args.content)

          return {
            title: "write_chapter",
            output: `已写入第${chapter.order}章「${chapter.title}」：${wordCount}字（目标≥${target}字）`,
            metadata: { chapter_id: args.chapter_id, word_count: wordCount },
          }
        },
      }),
      revise_chapter: tool({
        description: "修改已生成的章节内容。先归档旧版本，再用新正文覆盖。用于审计失败后的自动修订或人工修改。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          revision: tool.schema.string().describe("修订后的完整章节正文（非修改意见）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
          if (!chapter) return { title: "revise_chapter", output: `章节不存在：${args.chapter_id}` }
          if (chapter.content.length === 0)
            return { title: "revise_chapter", output: `章节尚无正文，无需修订：${args.chapter_id}` }

          const pendingCount = await db
            .select({ id: PendingUpdateTable.id })
            .from(PendingUpdateTable)
            .where(and(eq(PendingUpdateTable.novel_id, chapter.novel_id), eq(PendingUpdateTable.status, "pending")))
            .all()
          if (pendingCount.length > 0) {
            return {
              title: "revise_chapter（被门禁拦截）",
              output: `当前小说有 ${pendingCount.length} 个待统改任务未处理。请先调用 cascade_execute 或 cascade_list_pending 处理后再修订内容。`,
              metadata: { blocked: true, pending_count: pendingCount.length },
            }
          }

          // 修订后仍需满足字数要求，防止修订把章节字数改少
          const target = await getTargetWordCount(db, chapter.novel_id)
          const wordCount = countWords(args.revision)
          if (wordCount < target) {
            return {
              title: "revise_chapter（字数不达标）",
              output: `修订后字数不足：当前 ${wordCount} 字，本章目标至少 ${target} 字，还差 ${target - wordCount} 字。请在修订内容中补足字数后重新调用 revise_chapter。`,
              metadata: { rejected: true, reason: "too_short", word_count: wordCount, target },
            }
          }
          const maxWords = Math.ceil(target * 1.3)
          if (wordCount > maxWords) {
            return {
              title: "revise_chapter（字数超限）",
              output: `修订后字数超限：当前 ${wordCount} 字，本章目标 ${target} 字，最多允许 ${maxWords} 字。请精简后重新调用 revise_chapter。`,
              metadata: { rejected: true, reason: "too_long", word_count: wordCount, target },
            }
          }

          const dup = await checkDuplicateRatio(db, chapter.novel_id, args.revision, chapter.order)
          if (dup.duplicate) {
            const why =
              dup.openingRatio > 0.05
                ? `修订后开头与前文章节高度相似（相似度约 ${Math.round(dup.openingRatio * 100)}%）`
                : `约 ${Math.round(dup.ratio * 100)}% 的段落与前文相同`
            return {
              title: "revise_chapter（与前文重复）",
              output: `检测到修订内容与前文章节重复：${why}。例如：${dup.samples.join(" / ")}。禁止重复已写章节的事件和场景，请重写重复部分后重新调用 revise_chapter。`,
              metadata: { rejected: true, reason: "duplicate", ratio: dup.ratio, opening_ratio: dup.openingRatio },
            }
          }

          // 归档修订前版本
          await db
            .insert(ChapterVersionTable)
            .values({
              id: crypto.randomUUID(),
              chapter_id: chapter.id,
              version: await nextVersion(db, chapter.id),
              content: chapter.content,
              word_count: chapter.word_count,
              created_by: ctx.agent,
            })
            .run()

          const now = Date.now()
          await db
            .update(ChapterTable)
            .set({ content: args.revision, word_count: wordCount, status: "revised", updated_at: now })
            .where(eq(ChapterTable.id, args.chapter_id))
            .run()

          await scanReferences(db, chapter.novel_id, "chapter", args.chapter_id, "content", args.revision)

          return {
            title: "revise_chapter",
            output: `已修订第${chapter.order}章「${chapter.title}」：${wordCount}字（目标≥${target}字）`,
            metadata: { chapter_id: args.chapter_id, word_count: wordCount },
          }
        },
      }),
      manage_characters: tool({
        description: "管理小说角色信息。可新增或更新角色（name/role/description）。character_id 为空时新增。",
        args: {
          character_id: tool.schema.string().describe("角色 ID；传空字符串表示新增角色"),
          update: tool.schema.string().describe("角色更新内容 JSON：{name?,role?,description?,novel_id?}"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          let patch: { name?: string; role?: string; description?: string; novel_id?: string }
          try {
            patch = JSON.parse(args.update)
          } catch {
            return { title: "manage_characters", output: `update 不是合法 JSON：${args.update}` }
          }
          if (patch.novel_id) patch.novel_id = await resolveNovelId(db, patch.novel_id)

          // 新增角色
          if (args.character_id.length === 0) {
            if (!patch.novel_id) return { title: "manage_characters", output: "新增角色需提供 novel_id" }
            if (!patch.name) return { title: "manage_characters", output: "新增角色需提供 name" }

            const [dup] = await db
              .select({ id: CharacterTable.id })
              .from(CharacterTable)
              .where(and(eq(CharacterTable.novel_id, patch.novel_id), eq(CharacterTable.name, patch.name)))
              .limit(1)
              .all()
            if (dup) {
              await db
                .update(CharacterTable)
                .set({
                  role: patch.role ?? "",
                  description: patch.description ?? "",
                })
                .where(eq(CharacterTable.id, dup.id))
                .run()
              await scanReferences(db, patch.novel_id, "character", dup.id, "description", patch.description ?? "")
              return {
                title: "manage_characters（已合并重复）",
                output: `角色「${patch.name}」已存在，已更新描述：${dup.id}`,
                metadata: { character_id: dup.id, merged: true },
              }
            }

            const id = crypto.randomUUID()
            await db
              .insert(CharacterTable)
              .values({
                id,
                novel_id: patch.novel_id,
                name: patch.name,
                role: patch.role ?? "",
                description: patch.description ?? "",
              })
              .run()
            return {
              title: "manage_characters",
              output: `已新增角色「${patch.name}」：${id}`,
              metadata: { character_id: id },
            }
          }

          // 更新现有角色
          const [existing] = await db
            .select()
            .from(CharacterTable)
            .where(eq(CharacterTable.id, args.character_id))
            .all()
          if (!existing) return { title: "manage_characters", output: `角色不存在：${args.character_id}` }

          const oldDesc = existing.description
          const newDesc = patch.description ?? existing.description

          if (patch.description !== undefined && oldDesc.length > 0 && newDesc.length < oldDesc.length * 0.5) {
            return {
              title: "manage_characters（已拦截）",
              output: `⚠ 新描述(${newDesc.length}字)比旧描述(${oldDesc.length}字)短超过一半，可能丢失信息。\n\n旧描述全文：\n${oldDesc}\n\n如确认无误，请在 update 中保留旧描述的内容后再提交。`,
            }
          }

          if (patch.description !== undefined && oldDesc.length > 0 && newDesc.length < oldDesc.length) {
            await archiveDescription(ctx.directory, existing.novel_id, "character", args.character_id, oldDesc, newDesc)
          }

          await db
            .update(CharacterTable)
            .set({
              name: patch.name ?? existing.name,
              role: patch.role ?? existing.role,
              description: newDesc,
            })
            .where(eq(CharacterTable.id, args.character_id))
            .run()

          const changedFields: string[] = []
          if (patch.name !== undefined) changedFields.push("name")
          if (patch.role !== undefined) changedFields.push("role")
          if (patch.description !== undefined) changedFields.push("description")
          await scanReferences(db, existing.novel_id, "character", args.character_id, "description", newDesc)

          if (changedFields.length > 0) {
            await cascadeCreateTasks(
              db,
              existing.novel_id,
              "character",
              args.character_id,
              changedFields.join(", "),
              JSON.stringify({ name: existing.name, role: existing.role, description: existing.description }),
              JSON.stringify({
                name: patch.name ?? existing.name,
                role: patch.role ?? existing.role,
                description: newDesc,
              }),
              `角色「${existing.name}」更新（${changedFields.join(", ")}）`,
            )
          }

          return {
            title: "manage_characters",
            output: `已更新角色「${patch.name ?? existing.name}」`,
            metadata: { character_id: args.character_id },
          }
        },
      }),
      generate_master_outline: tool({
        description:
          "生成整体大纲，写入 .novel/outlines/master-outline.md。传入 content 参数时使用实际内容；不传时生成空模板。director 应先根据小说设定生成实际大纲内容再传入。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          content: tool.schema
            .string()
            .describe(
              "大纲 Markdown 全文。director 根据小说设定（角色/世界观/伏笔/卷纲等）生成实际内容后传入。留空则生成模板。",
            ),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const projectDir = projectDirFromCtx(ctx.directory)
          const result = await generateMasterOutline(novelId, projectDir, args.content || undefined)
          return {
            title: "generate_master_outline",
            output: `已生成整体大纲（master-outline.md，${result.length} 字）${args.content ? "" : "（模板，需填充内容）"}`,
            metadata: { novel_id: novelId, length: result.length },
          }
        },
      }),
      generate_volume_outline: tool({
        description:
          "生成卷大纲，创建 volumes 表记录并写入 .novel/outlines/volume-{n}.md。传入 content 参数时使用实际内容；不传时生成空模板。director 应先根据小说设定生成实际卷大纲内容再传入。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          volume_number: tool.schema.number().describe("卷号（从 1 开始）"),
          title: tool.schema
            .string()
            .describe("卷标题（如'卷一·军校风云'）。重新生成时传入新标题会更新原有记录。留空则使用'第X卷'。"),
          content: tool.schema
            .string()
            .describe("卷大纲 Markdown 全文。director 根据小说设定生成实际内容后传入。留空则生成模板。"),
        },
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
            output: `已生成第${args.volume_number}卷大纲（volume-${args.volume_number}.md，${result.length} 字）${args.content ? "" : "（模板，需填充内容）"}`,
            metadata: { novel_id: novelId, volume_number: args.volume_number, length: result.length },
          }
        },
      }),
      generate_chapter_outline: tool({
        description:
          "生成章节大纲，创建 chapters 表记录并写入 .novel/outlines/chapter-{n}.md。自动创建所属卷记录。传入 content 参数时使用实际内容（director 根据小说设定生成的完整章纲）；不传时生成空模板。生成后可在 WebUI 大纲标签页查看。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_number: tool.schema.number().describe("章节序号（从 1 开始）"),
          title: tool.schema
            .string()
            .describe("章节标题（如'第一章 觉醒'）。重新生成时传入新标题会更新原有记录。留空则使用'第X章'。"),
          content: tool.schema
            .string()
            .describe(
              "章节大纲 Markdown 全文。director 应先阅读小说设定（角色/卷纲/伏笔/前文摘要等），根据剧情发展生成实际的章节大纲内容后传入。包含：章节目标、关键场景（地点/时间/角色/概要/字数）、角色出场、剧情推进等。留空则生成模板。",
            ),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const projectDir = projectDirFromCtx(ctx.directory)
          const result = await generateChapterOutline(
            novelId,
            args.chapter_number,
            projectDir,
            args.content || undefined,
            args.title || undefined,
          )
          return {
            title: "generate_chapter_outline",
            output: `已生成第${args.chapter_number}章大纲（chapter-${args.chapter_number}.md，${result.length} 字）${args.content ? "" : "（模板，需填充内容）"}`,
            metadata: { novel_id: novelId, chapter_number: args.chapter_number, length: result.length },
          }
        },
      }),
      read_chapter_outline: tool({
        description: "读取章节大纲。从数据库读取指定章节的标题、内容、字数等信息。流水线步骤1（plan）。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_number: tool.schema.number().describe("章节序号"),
        },
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
          return {
            title: "read_chapter_outline",
            output: `章节ID：${chapter.id}\n标题：${chapter.title}\n序号：${chapter.order}\n现有字数：${chapter.word_count}\n状态：${chapter.status}`,
            metadata: {
              chapter_id: chapter.id,
              title: chapter.title,
              order: chapter.order,
              word_count: chapter.word_count,
            },
          }
        },
      }),
      read_outline: tool({
        description:
          "读取大纲 Markdown 文件原文。可读取总纲（master-outline.md）、卷纲（volume-{n}.md）或章节大纲文件（chapter-{n}.md）。用于在写作前回顾已生成的大纲细节。注意：这是读取 .novel/outlines/ 下的 markdown 文件，与 read_chapter_outline（读数据库元信息）互补。",
        args: {
          type: tool.schema
            .enum(["master", "volume", "chapter"])
            .describe("大纲类型：master=总纲，volume=卷纲，chapter=章节大纲文件"),
          number: tool.schema
            .number()
            .optional()
            .describe("卷号（type=volume 时必填）或章节序号（type=chapter 时必填，对应 chapter-{n}.md）"),
        },
        async execute(args, ctx) {
          if ((args.type === "volume" || args.type === "chapter") && typeof args.number !== "number") {
            return { title: "read_outline", output: `type=${args.type} 时必须提供 number 参数` }
          }
          const projectDir = projectDirFromCtx(ctx.directory)
          const outlinesDir = join(projectDir, ".novel", "outlines")
          const filename =
            args.type === "master"
              ? "master-outline.md"
              : args.type === "volume"
                ? `volume-${args.number}.md`
                : `chapter-${args.number}.md`
          const filePath = join(outlinesDir, filename)
          if (!existsSync(filePath)) {
            return {
              title: "read_outline",
              output: `大纲文件不存在：${filePath}。请先调用对应的 generate_*_outline 工具生成。`,
            }
          }
          const content = readFileSync(filePath, "utf-8")
          return {
            title: "read_outline",
            output: content,
            metadata: { file: filename, path: filePath, length: content.length },
          }
        },
      }),
      assemble_context_snapshot: tool({
        description:
          "组装上下文快照。查询小说蓝图、活跃角色、最近3章摘要、剧情线索、伏笔、风格指南等。流水线步骤2（compose）。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_number: tool.schema.number().describe("当前章节序号"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const snapshot = await assembleSnapshot(novelId, args.chapter_number, ctx.directory)
          if (!snapshot) {
            return { title: "assemble_context_snapshot", output: `无法组装上下文快照，小说 ${novelId} 不存在` }
          }
          const lines: string[] = [`小说：${snapshot.novelTitle}（${snapshot.genre}）`, `梗概：${snapshot.synopsis}`]
          if (snapshot.activeCharacters.length > 0) {
            lines.push("活跃角色：")
            for (const c of snapshot.activeCharacters) {
              lines.push(`- ${c.name}（${c.role}）：${c.description}`)
              if (c.location || c.mood) lines.push(`  位置：${c.location} | 情绪：${c.mood}`)
            }
          }
          if (snapshot.recentChapterSummaries.length > 0) {
            lines.push("最近章节摘要：")
            for (const ch of snapshot.recentChapterSummaries) {
              lines.push(`- 第${ch.chapterOrder}章 ${ch.chapterTitle}：${ch.summary}`)
            }
          }
          if (snapshot.plotThreads.length > 0) {
            lines.push("剧情线索：")
            for (const t of snapshot.plotThreads) lines.push(`- ${t.title}（${t.status}）`)
          }
          if (snapshot.foreshadowing.length > 0) {
            lines.push("伏笔：")
            for (const f of snapshot.foreshadowing) lines.push(`- [${f.id}] ${f.content}（${f.state}）`)
          }
          if (snapshot.styleGuide) {
            lines.push(
              `风格：基调=${snapshot.styleGuide.tone ?? "无"} 视角=${snapshot.styleGuide.pov ?? "无"} 时态=${snapshot.styleGuide.tense ?? "无"}`,
            )
          }
          if (snapshot.targetWordCount) {
            lines.push(`目标字数：每章至少 ${snapshot.targetWordCount} 字（write_chapter 会拒绝低于此字数的章节）`)
          }
          if (snapshot.prevChapterTail) {
            lines.push(
              `上一章结尾原文（本章必须从该时间点之后展开，严禁重复或重演前文已发生的内容）：\n${snapshot.prevChapterTail}`,
            )
          }
          const hookStats = await getHookStats(novelId, 10, ctx.directory)
          if (hookStats.hooks.length > 0) {
            const recent = hookStats.hooks
              .slice(0, 5)
              .map((h) => h.hookType)
              .join(" → ")
            lines.push(`最近钩子使用：${recent}`)
          }
          if (hookStats.warning) lines.push(`⚠️ 钩子轮换警告：${hookStats.warning}`)
          return {
            title: "assemble_context_snapshot",
            output: lines.join("\n"),
            metadata: {
              character_count: snapshot.activeCharacters.length,
              plot_thread_count: snapshot.plotThreads.length,
            },
          }
        },
      }),
      check_continuity: tool({
        description:
          "执行连续性检查。对当前章节进行37维确定性检查（角色/关系/时间线/地点/剧情/世界观/风格/逻辑/细节）。检查结果自动持久化为评审记录（source=deterministic）。流水线步骤4（audit）。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_number: tool.schema.number().describe("章节序号"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const result = await checkContinuity(novelId, args.chapter_number, ctx.directory)
          if (!result) {
            return { title: "check_continuity", output: "连续性检查失败：无法获取检查结果" }
          }
          if (result.chapterId) {
            await createChapterReview(
              result.chapterId,
              {
                source: "deterministic",
                overall: result.overall,
                dimensions: result.dimensions,
                summary: `37维确定性检查：${result.overall}`,
                sessionId: ctx.sessionID,
              },
              ctx.directory,
            )
          }
          const failCount = result.dimensions.filter((d) => d.status === "FAIL").length
          const warnCount = result.dimensions.filter((d) => d.status === "WARN").length
          const passCount = result.dimensions.length - failCount - warnCount
          const failDims = result.dimensions
            .filter((d) => d.status === "FAIL")
            .map((d) => `${d.dimension}：${d.detail}`)
          return {
            title: "check_continuity",
            output: `连续性检查结果：${result.overall}（PASS ${passCount}，WARN ${warnCount}，FAIL ${failCount}）${failDims.length > 0 ? "\n失败维度：\n" + failDims.join("\n") : ""}`,
            metadata: { overall: result.overall, fail_count: failCount, warn_count: warnCount },
          }
        },
      }),
      submit_chapter_review: tool({
        description:
          "提交章节评审结果（结构化持久化）。auditor 完成37维深度审计后必须调用此工具提交全部维度结果，供人工审批时查阅。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          overall: tool.schema.enum(["PASS", "WARN", "FAIL"]).describe("总体评估"),
          dimensions: tool.schema
            .array(
              tool.schema.object({
                dimension: tool.schema.string().describe("维度名称（必须是37维清单中的名称）"),
                status: tool.schema.enum(["PASS", "WARN", "FAIL"]).describe("该维度审计结果"),
                detail: tool.schema
                  .string()
                  .describe("具体说明（PASS 说明通过原因，WARN 指出潜在风险，FAIL 指出具体矛盾）"),
                evidence: tool.schema.string().optional().describe("引用章节中的具体内容作为证据"),
              }),
            )
            .describe("37个维度的审计结果列表"),
          summary: tool.schema.string().describe("总体评估文字"),
        },
        async execute(args, ctx) {
          const invalid = args.dimensions.filter((d) => !CONTINUITY_DIMENSIONS.includes(d.dimension))
          if (invalid.length > 0) {
            return {
              title: "submit_chapter_review",
              output: `提交失败：${invalid.length} 个维度名称不在37维清单中：${invalid.map((d) => d.dimension).join("、")}。有效维度：${CONTINUITY_DIMENSIONS.join("、")}`,
            }
          }
          const review = await createChapterReview(
            args.chapter_id,
            {
              source: "auditor",
              overall: args.overall,
              dimensions: args.dimensions,
              summary: args.summary,
              sessionId: ctx.sessionID,
            },
            ctx.directory,
          )
          return {
            title: "submit_chapter_review",
            output: `评审已提交：第 ${review.round} 轮，总体 ${args.overall}（PASS ${review.pass_count}，WARN ${review.warn_count}，FAIL ${review.fail_count}）`,
            metadata: { review_id: review.id, round: review.round },
          }
        },
      }),
      validate_state_delta: tool({
        description: "验证状态变更。检查当前章节是否有有效的状态变更需要提交。流水线步骤6（reflect）。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_id: tool.schema.string().describe("章节 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const result = await validateStateDelta(novelId, args.chapter_id, ctx.directory)
          return { title: "validate_state_delta", output: result.message, metadata: { status: result.status } }
        },
      }),
      commit_state_delta: tool({
        description:
          "提交状态变更到持久层（仅章节元数据）。注意：此工具只写入 chapter_summary 条目（标题/字数/状态/序号），不提取角色状态、剧情线索、伏笔等变更。完整状态提交请使用 commit_observer_delta 工具传入 observer/reflector 校验的 delta JSON。流水线步骤7（sync）应使用 commit_observer_delta，非此工具。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_id: tool.schema.string().describe("章节 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const result = await persistStateDelta(novelId, args.chapter_id, ctx.directory)
          return { title: "commit_state_delta", output: result.message, metadata: { status: result.status } }
        },
      }),
      advance_chapter: tool({
        description: "推进到下一章。返回下一章序号，流水线步骤8（next）。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_number: tool.schema.number().describe("当前章节序号"),
        },
        async execute(args) {
          const nextChapter = args.chapter_number + 1
          return {
            title: "advance_chapter",
            output: `流水线完成，下一章为第${nextChapter}章`,
            metadata: { next_chapter: nextChapter },
          }
        },
      }),
      read_chapter_content: tool({
        description:
          "读取章节正文内容。返回完整的章节正文文本，供 observer/auditor 分析使用。可通过 chapter_id（UUID）或 chapter_number（章节序号，从 1 开始）定位章节，二选一即可。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_id: tool.schema.string().optional().describe("章节 ID（UUID）。与 chapter_number 二选一。"),
          chapter_number: tool.schema.number().optional().describe("章节序号（从 1 开始）。与 chapter_id 二选一。"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          if (!args.chapter_id && args.chapter_number === undefined) {
            return { title: "read_chapter_content", output: "请提供 chapter_id 或 chapter_number 之一" }
          }
          const chapter = args.chapter_id
            ? await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).get()
            : await db
                .select()
                .from(ChapterTable)
                .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, args.chapter_number!)))
                .get()
          if (!chapter) {
            const locator = args.chapter_id ? `ID：${args.chapter_id}` : `第${args.chapter_number}章`
            return { title: "read_chapter_content", output: `章节不存在：${locator}` }
          }
          return {
            title: "read_chapter_content",
            output: chapter.content.length > 0 ? chapter.content : "章节正文为空",
            metadata: { chapter_id: chapter.id, chapter_number: chapter.order, word_count: chapter.word_count },
          }
        },
      }),
      list_chapters: tool({
        description: "列出小说所有章节。返回章节 UUID、序号、标题、字数、状态，供 agent 在读写正文前定位章节。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const chapters = await db
            .select({
              id: ChapterTable.id,
              chapter_number: ChapterTable.order,
              title: ChapterTable.title,
              word_count: ChapterTable.word_count,
              status: ChapterTable.status,
            })
            .from(ChapterTable)
            .where(eq(ChapterTable.novel_id, novelId))
            .orderBy(asc(ChapterTable.order))
            .all()
          if (chapters.length === 0) {
            return { title: "list_chapters", output: `小说 ${novelId} 暂无章节记录` }
          }
          const lines = chapters.map(
            (c) => `第${c.chapter_number}章 | ${c.title} | ${c.word_count}字 | ${c.status} | ${c.id}`,
          )
          return {
            title: "list_chapters",
            output: lines.join("\n"),
            metadata: { count: chapters.length, chapters },
          }
        },
      }),
      update_chapter: tool({
        description:
          "更新章节标题或状态。用于修改章节标题、推进章节状态（如 draft→audited→final）。正文内容请用 write_chapter/revise_chapter，不要用本工具写正文。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          title: tool.schema.string().optional().describe("新的章节标题（不传则不改）"),
          status: tool.schema
            .string()
            .optional()
            .describe(
              "新的章节状态：planned/outline/draft/drafting/audited/revised/pending_review/final/rejected/published/failed（不传则不改）",
            ),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
          if (!chapter) return { title: "update_chapter", output: `章节不存在：${args.chapter_id}` }
          const fields: { title?: string; status?: string } = {}
          if (args.title !== undefined) fields.title = args.title
          if (args.status !== undefined) fields.status = args.status
          if (Object.keys(fields).length === 0) {
            return { title: "update_chapter", output: "未提供任何要更新的字段" }
          }
          const updated = await updateChapter(args.chapter_id, fields, ctx.directory)
          return {
            title: "update_chapter",
            output: `已更新第${updated.order}章「${updated.title}」状态=${updated.status}`,
            metadata: { chapter_id: updated.id, title: updated.title, status: updated.status },
          }
        },
      }),
      delete_chapter: tool({
        description:
          "删除章节及其所有关联数据（正文版本、摘要、角色状态、张力记录、审计记录、状态日志、实体引用）。此操作不可逆，删除前请确认。通常用于删除生成失败或多余的空章节。",
        args: {
          chapter_id: tool.schema.string().describe("要删除的章节 ID"),
          confirm: tool.schema.boolean().describe("必须传 true 确认删除；不传或 false 时只返回预览信息不执行删除"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
          if (!chapter) return { title: "delete_chapter", output: `章节不存在：${args.chapter_id}` }
          if (!args.confirm) {
            return {
              title: "delete_chapter",
              output: `待删除：第${chapter.order}章「${chapter.title}」（${chapter.word_count}字，状态=${chapter.status}）。关联数据（版本/摘要/角色状态/张力/审计/引用）将一并删除。确认删除请传 confirm=true。`,
            }
          }
          // 级联清理：FK CASCADE 仅在 Bun SQLite 开启 foreign_keys 时生效，这里显式清理确保彻底
          await db.delete(ChapterVersionTable).where(eq(ChapterVersionTable.chapter_id, args.chapter_id)).run()
          await db.delete(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, args.chapter_id)).run()
          await db.delete(CharacterStateTable).where(eq(CharacterStateTable.chapter_id, args.chapter_id)).run()
          await db.delete(ChapterReviewTable).where(eq(ChapterReviewTable.chapter_id, args.chapter_id)).run()
          await db.delete(NovelStateLogTable).where(eq(NovelStateLogTable.chapter_id, args.chapter_id)).run()
          await db.delete(HookRotationTable).where(eq(HookRotationTable.chapter_id, args.chapter_id)).run()
          await db
            .delete(EntityRefTable)
            .where(and(eq(EntityRefTable.source_type, "chapter"), eq(EntityRefTable.source_id, args.chapter_id)))
            .run()
          // 伏笔的 planted/resolved_chapter_id 置空（SET NULL 语义）
          await db
            .update(ForeshadowingTable)
            .set({ planted_chapter_id: null })
            .where(eq(ForeshadowingTable.planted_chapter_id, args.chapter_id))
            .run()
          await db
            .update(ForeshadowingTable)
            .set({ resolved_chapter_id: null })
            .where(eq(ForeshadowingTable.resolved_chapter_id, args.chapter_id))
            .run()
          // 该章张力记录按 chapter_number 删除
          await db
            .delete(TensionLogTable)
            .where(
              and(eq(TensionLogTable.novel_id, chapter.novel_id), eq(TensionLogTable.chapter_number, chapter.order)),
            )
            .run()
          await deleteChapter(args.chapter_id, ctx.directory)
          return {
            title: "delete_chapter",
            output: `已删除第${chapter.order}章「${chapter.title}」及其全部关联数据`,
            metadata: { deleted_chapter_id: args.chapter_id, order: chapter.order },
          }
        },
      }),
      search_chapters: tool({
        description:
          "全文检索小说章节。在所有已写章节的标题和正文中搜索关键词，返回匹配章节及上下文片段，供 agent 查证某事件/人物/设定出现在哪一章。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          query: tool.schema.string().describe("搜索关键词（不少于 2 个字符）"),
          limit: tool.schema.number().optional().describe("最多返回条数，默认 10"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          if (!args.query || args.query.trim().length < 2) {
            return { title: "search_chapters", output: "关键词长度至少 2 个字符" }
          }
          const pattern = `%${args.query.trim()}%`
          const rows = await db
            .select({
              id: ChapterTable.id,
              order: ChapterTable.order,
              title: ChapterTable.title,
              content: ChapterTable.content,
            })
            .from(ChapterTable)
            .where(
              and(
                eq(ChapterTable.novel_id, novelId),
                sql`(${ChapterTable.content} LIKE ${pattern} OR ${ChapterTable.title} LIKE ${pattern})`,
              ),
            )
            .orderBy(asc(ChapterTable.order))
            .limit(args.limit ?? 10)
            .all()
          const matched = rows
          if (matched.length === 0) {
            return { title: "search_chapters", output: `未找到包含「${args.query}」的章节` }
          }
          const lines: string[] = [`找到 ${matched.length} 章包含「${args.query}」：`]
          for (const r of matched) {
            const idx = r.content.indexOf(args.query.trim())
            const snippet =
              idx >= 0
                ? r.content.slice(Math.max(0, idx - 30), idx + args.query.trim().length + 50).replace(/\n+/g, " ")
                : r.title
            lines.push(`第${r.order}章 ${r.title}（${r.id}）：…${snippet}…`)
          }
          return {
            title: "search_chapters",
            output: lines.join("\n"),
            metadata: { count: matched.length, query: args.query },
          }
        },
      }),
      list_chapter_reviews: tool({
        description:
          "读取章节的审计/评审记录（确定性检查、auditor 审计、人工审批），返回最近若干轮的总体结论、各维度结果和摘要。修订前用它了解该章历史上被指出过的问题。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          limit: tool.schema.number().optional().describe("最多返回条数，默认 5"),
        },
        async execute(args, ctx) {
          const reviews = await listChapterReviews(args.chapter_id, ctx.directory)
          if (reviews.length === 0) {
            return { title: "list_chapter_reviews", output: `章节 ${args.chapter_id} 暂无审计/评审记录` }
          }
          const limited = reviews.slice(0, args.limit ?? 5)
          const lines: string[] = [
            `章节 ${args.chapter_id.slice(0, 8)} 共 ${reviews.length} 条评审，显示最近 ${limited.length} 条：`,
          ]
          for (const r of limited) {
            let dimensions: unknown = []
            try {
              dimensions = JSON.parse(r.dimensions)
            } catch {
              dimensions = []
            }
            const fails = Array.isArray(dimensions)
              ? (dimensions as Array<{ status?: string }>).filter((d) => d.status === "FAIL").length
              : 0
            lines.push(
              `[${new Date(r.created_at).toLocaleString("zh-CN")}] 第${r.round}轮 ${r.source} ${r.overall}（PASS=${r.pass_count} WARN=${r.warn_count} FAIL=${r.fail_count}）${r.summary ? "：" + r.summary : ""}`,
            )
            if (fails > 0) lines.push(`  ⚠ ${fails} 个维度未通过`)
          }
          return {
            title: "list_chapter_reviews",
            output: lines.join("\n"),
            metadata: { count: reviews.length, reviews: limited },
          }
        },
      }),
      commit_observer_delta: tool({
        description:
          "提交 observer 提取并经 reflector 校验的状态变更 delta。接收 delta JSON 字符串，解析后调用 commitState 写入数据库日志和物化视图。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          chapter_id: tool.schema.string().describe("章节 ID"),
          delta_json: tool.schema.string().describe("reflector 校验通过的 delta JSON 字符串"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          let delta
          try {
            delta = StateDeltaSchema.parse(JSON.parse(args.delta_json))
          } catch (err) {
            return {
              title: "commit_observer_delta",
              output: `delta JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
            }
          }
          try {
            const count = await commitState(novelId, args.chapter_id, delta, ctx.directory)
            return {
              title: "commit_observer_delta",
              output: `状态变更已提交，共 ${count} 条日志`,
              metadata: { count },
            }
          } catch (err) {
            return {
              title: "commit_observer_delta",
              output: `状态提交失败：${err instanceof Error ? err.message : String(err)}`,
            }
          }
        },
      }),
      save_novel_settings: tool({
        description:
          '批量保存小说设定到数据库。architect agent 专用：将世界观/伏笔/剧情线索/风格指南/角色/卷/关系等设定持久化。settings_json 为 JSON 数组，每项形如 {"type":"world_entry","data":{"title":"...","content":"..."}}。支持类型：character/world_entry/plot_thread/foreshadowing/style_guide/volume/relationship。style_guide 为单条覆盖写入（先删后插）。character 先于 relationship 处理：character 可带 ref 字段（本地引用键），relationship 通过 char_a_ref/char_b_ref 引用已插入角色；也兼容 char_a_id/char_b_id 传 UUID 或姓名（同名歧义时需用 ref）。',
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          settings_json: tool.schema
            .string()
            .describe(
              '设定 JSON 数组，如 [{"type":"character","data":{"ref":"protagonist","name":"陆沉","role":"主角"}},{"type":"relationship","data":{"char_a_ref":"protagonist","char_b_ref":"antagonist","type":"宿敌","description":"..."}}]',
            ),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          let settings: Array<{ type: string; data: Record<string, unknown> }>
          try {
            settings = JSON.parse(args.settings_json)
          } catch {
            return { title: "save_novel_settings", output: "settings_json 不是合法 JSON" }
          }
          // Phase 1: 先插入所有 character，构建 ref->id 和 name->id[] 映射。
          // relationship 依赖这些映射来解析角色引用，所以 character 必须先落库。
          const refToId = new Map<string, string>()
          const nameToIds = new Map<string, string[]>()
          let count = 0
          const errors: string[] = []

          for (const [i, s] of settings.entries()) {
            if (s.type !== "character") continue
            try {
              const d = s.data
              const name = String(d.name ?? "")
              const [existing] = await db
                .select({ id: CharacterTable.id, description: CharacterTable.description })
                .from(CharacterTable)
                .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.name, name)))
                .limit(1)
                .all()

              let id: string
              if (existing) {
                id = existing.id
                const newDesc = String(d.description ?? "")
                const oldDesc = existing.description
                if (oldDesc.length > 0 && newDesc.length < oldDesc.length * 0.5) {
                  errors.push(
                    `角色「${name}」新描述(${newDesc.length}字)比旧描述(${oldDesc.length}字)短超过一半，已跳过更新保留原文`,
                  )
                  count++
                  const ref = d.ref ? String(d.ref) : ""
                  if (ref) refToId.set(ref, id)
                  if (name) nameToIds.set(name, [...(nameToIds.get(name) ?? []), id])
                  continue
                }
                if (oldDesc.length > 0 && newDesc.length < oldDesc.length) {
                  await archiveDescription(ctx.directory, novelId, "character", id, oldDesc, newDesc)
                }
                await db
                  .update(CharacterTable)
                  .set({
                    role: String(d.role ?? ""),
                    description: newDesc,
                  })
                  .where(eq(CharacterTable.id, id))
                  .run()
              } else {
                id = crypto.randomUUID()
                await db
                  .insert(CharacterTable)
                  .values({
                    id,
                    novel_id: novelId,
                    name,
                    role: String(d.role ?? ""),
                    description: String(d.description ?? ""),
                  })
                  .run()
              }
              count++
              const ref = d.ref ? String(d.ref) : ""
              if (ref) refToId.set(ref, id)
              if (name) nameToIds.set(name, [...(nameToIds.get(name) ?? []), id])
              await scanReferences(db, novelId, "character", id, "description", String(d.description ?? ""))
            } catch (err) {
              errors.push(`第${i}条：${err instanceof Error ? err.message : String(err)}`)
            }
          }

          // Phase 2: 插入其余类型；relationship 通过 resolveCharRef 解析角色引用
          for (const [i, s] of settings.entries()) {
            if (s.type === "character") continue
            try {
              const d = s.data
              switch (s.type) {
                case "world_entry":
                  await db
                    .insert(WorldEntryTable)
                    .values({
                      id: crypto.randomUUID(),
                      novel_id: novelId,
                      category: String(d.category ?? ""),
                      title: String(d.title ?? ""),
                      content: String(d.content ?? ""),
                    })
                    .run()
                  count++
                  break
                case "plot_thread":
                  await db
                    .insert(PlotThreadTable)
                    .values({
                      id: crypto.randomUUID(),
                      novel_id: novelId,
                      title: String(d.title ?? ""),
                      status: String(d.status ?? "open"),
                      priority: String(d.priority ?? "medium"),
                      description: String(d.description ?? ""),
                    })
                    .run()
                  count++
                  break
                case "foreshadowing":
                  await db
                    .insert(ForeshadowingTable)
                    .values({
                      id: crypto.randomUUID(),
                      novel_id: novelId,
                      content: String(d.content ?? ""),
                      state: String(d.state ?? "planted"),
                      planted_chapter_id: d.planted_chapter_id ? String(d.planted_chapter_id) : null,
                    })
                    .run()
                  count++
                  break
                case "style_guide":
                  await db.delete(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).run()
                  await db
                    .insert(StyleGuideTable)
                    .values({
                      id: crypto.randomUUID(),
                      novel_id: novelId,
                      rules: stringifyRules(d.rules),
                      tone: String(d.tone ?? ""),
                      pov: String(d.pov ?? ""),
                      tense: String(d.tense ?? ""),
                    })
                    .run()
                  count++
                  break
                case "volume":
                  await db
                    .insert(VolumeTable)
                    .values({
                      id: crypto.randomUUID(),
                      novel_id: novelId,
                      title: String(d.title ?? ""),
                      summary: String(d.summary ?? ""),
                      order: Number(d.order ?? 1),
                    })
                    .run()
                  count++
                  break
                case "relationship": {
                  const a = resolveCharRef(d, "char_a", refToId, nameToIds)
                  const b = resolveCharRef(d, "char_b", refToId, nameToIds)
                  if ("error" in a) {
                    errors.push(`第${i}条：char_a ${a.error}`)
                    break
                  }
                  if ("error" in b) {
                    errors.push(`第${i}条：char_b ${b.error}`)
                    break
                  }
                  await db
                    .insert(RelationshipTable)
                    .values({
                      id: crypto.randomUUID(),
                      novel_id: novelId,
                      char_a_id: a.id,
                      char_b_id: b.id,
                      type: String(d.type ?? ""),
                      description: String(d.description ?? ""),
                    })
                    .run()
                  count++
                  break
                }
                default:
                  errors.push(`第${i}条：未知类型 "${s.type}"`)
              }
            } catch (err) {
              errors.push(`第${i}条：${err instanceof Error ? err.message : String(err)}`)
            }
          }
          return {
            title: "save_novel_settings",
            output: `已保存 ${count} 条设定${errors.length > 0 ? "，错误：" + errors.join("; ") : ""}`,
            metadata: { count, errors },
          }
        },
      }),
      check_novel_settings: tool({
        description:
          "一键拉取小说所有设定（角色/世界观/伏笔/剧情线索/关系/卷/风格指南）的概览 + 完整内容 + 状态摘要，供 director 做'检查设定/审查设定/审一遍设定'类指令使用。可选 scope 限定范围。仅查询不修改，是审计设定类指令的入口工具。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          scope: tool.schema
            .enum(["all", "world", "characters", "relationships", "threads", "foreshadowing", "style_guide"])
            .optional()
            .describe(
              "限定范围：all=全部（默认）；world=世界观条目；characters=角色；relationships=关系；threads=剧情线索；foreshadowing=伏笔；style_guide=风格指南",
            ),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const scope = args.scope ?? "all"
          const lines: string[] = []
          const counts: Record<string, number> = {}

          if (scope === "all" || scope === "world") {
            const rows = await db
              .select()
              .from(WorldEntryTable)
              .where(eq(WorldEntryTable.novel_id, novelId))
              .all()
            counts.world = rows.length
            if (rows.length > 0) {
              lines.push(`## 世界观条目（${rows.length}）`)
              for (const r of rows) {
                lines.push(`- [${r.id.slice(0, 8)}] ${r.category}: ${r.title}`)
                if (r.content) lines.push(`  ${r.content}`)
              }
              lines.push("")
            }
          }

          if (scope === "all" || scope === "characters") {
            const rows = await db
              .select()
              .from(CharacterTable)
              .where(eq(CharacterTable.novel_id, novelId))
              .orderBy(CharacterTable.name)
              .all()
            counts.characters = rows.length
            if (rows.length > 0) {
              lines.push(`## 角色（${rows.length}）`)
              for (const r of rows) {
                lines.push(`- [${r.id.slice(0, 8)}] ${r.name}（${r.role || "无角色"}）`)
                if (r.description) lines.push(`  ${r.description}`)
              }
              lines.push("")
            }
          }

          if (scope === "all" || scope === "relationships") {
            const rows = await db
              .select()
              .from(RelationshipTable)
              .where(eq(RelationshipTable.novel_id, novelId))
              .all()
            counts.relationships = rows.length
            if (rows.length > 0) {
              lines.push(`## 关系（${rows.length}）`)
              for (const r of rows) {
                lines.push(`- [${r.id.slice(0, 8)}] ${r.type || "未分类"}`)
                if (r.description) lines.push(`  ${r.description}`)
              }
              lines.push("")
            }
          }

          if (scope === "all" || scope === "threads") {
            const rows = await db
              .select()
              .from(PlotThreadTable)
              .where(eq(PlotThreadTable.novel_id, novelId))
              .orderBy(PlotThreadTable.title)
              .all()
            counts.threads = rows.length
            if (rows.length > 0) {
              lines.push(`## 剧情线索（${rows.length}）`)
              for (const r of rows) {
                lines.push(`- [${r.id.slice(0, 8)}] ${r.title}（${r.status}，优先级=${r.priority}）`)
                if (r.description) lines.push(`  ${r.description}`)
              }
              lines.push("")
            }
          }

          if (scope === "all" || scope === "foreshadowing") {
            const rows = await db
              .select()
              .from(ForeshadowingTable)
              .where(eq(ForeshadowingTable.novel_id, novelId))
              .orderBy(asc(ForeshadowingTable.created_at))
              .all()
            counts.foreshadowing = rows.length
            if (rows.length > 0) {
              lines.push(`## 伏笔（${rows.length}）`)
              for (const r of rows) {
                const planted = r.planted_chapter_id ? `埋于第${r.planted_chapter_id.slice(0, 8)}章` : ""
                const resolved = r.resolved_chapter_id ? `，收于第${r.resolved_chapter_id.slice(0, 8)}章` : ""
                lines.push(`- [${r.id.slice(0, 8)}] ${r.content}（${r.state}${planted}${resolved}）`)
              }
              lines.push("")
            }
          }

          if (scope === "all" || scope === "style_guide") {
            const [sg] = await db
              .select()
              .from(StyleGuideTable)
              .where(eq(StyleGuideTable.novel_id, novelId))
              .all()
            counts.style_guide = sg ? 1 : 0
            if (sg) {
              lines.push(`## 风格指南`)
              if (sg.tone) lines.push(`- 基调：${sg.tone}`)
              if (sg.pov) lines.push(`- 视角：${sg.pov}`)
              if (sg.tense) lines.push(`- 时态：${sg.tense}`)
              if (sg.rules) {
                const parsed = parseStyleRules(sg.rules)
                lines.push(`- 规则：${JSON.stringify(parsed)}`)
              }
              lines.push("")
            }
          }

          if (lines.length === 0) {
            return { title: "check_novel_settings", output: "小说暂无任何设定记录" }
          }

          const header = `小说设定概览（${novelId.slice(0, 8)}）\n范围：${scope} | 统计：${Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}\n`
          return {
            title: "check_novel_settings",
            output: header + "\n" + lines.join("\n"),
            metadata: { novel_id: novelId, scope, counts },
          }
        },
      }),
      list_settings: tool({
        description:
          "列出小说设定。返回 character/world_entry/plot_thread/foreshadowing/volume/relationship 类型记录的 ID、名称/内容摘要、状态等，供 agent 在删除或修改前定位 entity_id。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          entity_type: tool.schema
            .string()
            .describe("实体类型：character/world_entry/plot_thread/foreshadowing/volume/relationship"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const type = args.entity_type
          let lines: string[] = []
          let count = 0
          if (type === "character") {
            const rows = await db
              .select({ id: CharacterTable.id, name: CharacterTable.name, role: CharacterTable.role })
              .from(CharacterTable)
              .where(eq(CharacterTable.novel_id, novelId))
              .orderBy(CharacterTable.name)
              .all()
            count = rows.length
            lines = rows.map((r) => `- [${r.id}] ${r.name}（${r.role}）`)
          } else if (type === "world_entry") {
            const rows = await db
              .select({ id: WorldEntryTable.id, category: WorldEntryTable.category, title: WorldEntryTable.title })
              .from(WorldEntryTable)
              .where(eq(WorldEntryTable.novel_id, novelId))
              .orderBy(WorldEntryTable.category, WorldEntryTable.title)
              .all()
            count = rows.length
            lines = rows.map((r) => `- [${r.id}] ${r.category}: ${r.title}`)
          } else if (type === "plot_thread") {
            const rows = await db
              .select({ id: PlotThreadTable.id, title: PlotThreadTable.title, status: PlotThreadTable.status })
              .from(PlotThreadTable)
              .where(eq(PlotThreadTable.novel_id, novelId))
              .orderBy(PlotThreadTable.title)
              .all()
            count = rows.length
            lines = rows.map((r) => `- [${r.id}] ${r.title}（${r.status}）`)
          } else if (type === "foreshadowing") {
            const rows = await db
              .select({
                id: ForeshadowingTable.id,
                content: ForeshadowingTable.content,
                state: ForeshadowingTable.state,
              })
              .from(ForeshadowingTable)
              .where(eq(ForeshadowingTable.novel_id, novelId))
              .orderBy(ForeshadowingTable.created_at)
              .all()
            count = rows.length
            lines = rows.map(
              (r) => `- [${r.id}] ${r.content.slice(0, 60)}${r.content.length > 60 ? "..." : ""}（${r.state}）`,
            )
          } else if (type === "volume") {
            const rows = await db
              .select({ id: VolumeTable.id, title: VolumeTable.title, order: VolumeTable.order })
              .from(VolumeTable)
              .where(eq(VolumeTable.novel_id, novelId))
              .orderBy(VolumeTable.order)
              .all()
            count = rows.length
            lines = rows.map((r) => `- [${r.id}] 第${r.order}卷 ${r.title}`)
          } else if (type === "relationship") {
            const rows = await db
              .select({
                id: RelationshipTable.id,
                type: RelationshipTable.type,
                description: RelationshipTable.description,
              })
              .from(RelationshipTable)
              .where(eq(RelationshipTable.novel_id, novelId))
              .orderBy(RelationshipTable.type)
              .all()
            count = rows.length
            lines = rows.map(
              (r) => `- [${r.id}] ${r.type}: ${r.description.slice(0, 60)}${r.description.length > 60 ? "..." : ""}`,
            )
          } else {
            return { title: "list_settings", output: `不支持的实体类型：${type}` }
          }
          if (count === 0) return { title: "list_settings", output: `${type} 暂无记录` }
          return {
            title: "list_settings",
            output: lines.join("\n"),
            metadata: { entity_type: type, count, items: lines },
          }
        },
      }),
      delete_setting: tool({
        description:
          "删除小说设定。支持删除 character/world_entry/plot_thread/foreshadowing/volume/relationship 类型的记录。删除前建议先用 list_settings 获取 entity_id，再用 cascade_check 检查影响范围。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          entity_type: tool.schema
            .string()
            .describe("实体类型：character/world_entry/plot_thread/foreshadowing/volume/relationship"),
          entity_id: tool.schema.string().describe("实体 ID（UUID）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          await resolveNovelId(db, args.novel_id)
          const type = args.entity_type
          const id = args.entity_id

          async function exists(): Promise<boolean> {
            if (type === "character")
              return !!(await db
                .select({ id: CharacterTable.id })
                .from(CharacterTable)
                .where(eq(CharacterTable.id, id))
                .get())
            if (type === "world_entry")
              return !!(await db
                .select({ id: WorldEntryTable.id })
                .from(WorldEntryTable)
                .where(eq(WorldEntryTable.id, id))
                .get())
            if (type === "plot_thread")
              return !!(await db
                .select({ id: PlotThreadTable.id })
                .from(PlotThreadTable)
                .where(eq(PlotThreadTable.id, id))
                .get())
            if (type === "foreshadowing")
              return !!(await db
                .select({ id: ForeshadowingTable.id })
                .from(ForeshadowingTable)
                .where(eq(ForeshadowingTable.id, id))
                .get())
            if (type === "volume")
              return !!(await db.select({ id: VolumeTable.id }).from(VolumeTable).where(eq(VolumeTable.id, id)).get())
            if (type === "relationship")
              return !!(await db
                .select({ id: RelationshipTable.id })
                .from(RelationshipTable)
                .where(eq(RelationshipTable.id, id))
                .get())
            return false
          }

          try {
            if (!(await exists())) {
              return { title: "delete_setting", output: `记录不存在：${type} ${id.slice(0, 8)}，未执行删除` }
            }
            if (type === "character") await deleteCharacter(id, ctx.directory)
            else if (type === "world_entry") await deleteWorldEntry(id, ctx.directory)
            else if (type === "plot_thread") await deletePlotThread(id, ctx.directory)
            else if (type === "foreshadowing") await deleteForeshadowing(id, ctx.directory)
            else if (type === "volume") await deleteVolume(id, ctx.directory)
            else if (type === "relationship") await deleteRelationship(id, ctx.directory)
            else return { title: "delete_setting", output: `不支持的实体类型：${type}` }
            return {
              title: "delete_setting",
              output: `已删除 ${type} ${id.slice(0, 8)}`,
              metadata: { entity_type: type, entity_id: id },
            }
          } catch (err) {
            return {
              title: "delete_setting",
              output: `删除失败：${err instanceof Error ? err.message : String(err)}`,
            }
          }
        },
      }),
      update_setting: tool({
        description:
          "更新已有的小说设定记录。支持 world_entry（修改 category/title/content）、plot_thread（修改 title/status/priority/description，status 设为 closed 会自动记录关闭时间）、foreshadowing（修改 content/state/resolved_chapter_id，state 可为 planted/hinted/resolved/abandoned）、relationship（修改 type/description）。用 list_settings 获取 entity_id 后再更新。",
        args: {
          entity_type: tool.schema
            .string()
            .describe("实体类型：world_entry / plot_thread / foreshadowing / relationship"),
          entity_id: tool.schema.string().describe("要更新的记录 ID"),
          fields_json: tool.schema
            .string()
            .describe(
              '要更新的字段 JSON，例如 {"state":"resolved","resolved_chapter_id":"uuid"} 或 {"status":"closed"}',
            ),
        },
        async execute(args, ctx) {
          const type = args.entity_type
          const id = args.entity_id
          let fields: Record<string, unknown>
          try {
            fields = JSON.parse(args.fields_json) as Record<string, unknown>
          } catch {
            return { title: "update_setting", output: `fields_json 不是合法 JSON：${args.fields_json}` }
          }
          if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
            return { title: "update_setting", output: "fields_json 必须是非空对象" }
          }
          try {
            if (type === "world_entry") {
              const f: { category?: string; title?: string; content?: string } = {}
              if (typeof fields.category === "string") f.category = fields.category
              if (typeof fields.title === "string") f.title = fields.title
              if (typeof fields.content === "string") f.content = fields.content
              await updateWorldEntry(id, f, ctx.directory)
            } else if (type === "plot_thread") {
              const f: { title?: string; status?: string; priority?: string; description?: string } = {}
              if (typeof fields.title === "string") f.title = fields.title
              if (typeof fields.status === "string") f.status = fields.status
              if (typeof fields.priority === "string") f.priority = fields.priority
              if (typeof fields.description === "string") f.description = fields.description
              await updatePlotThread(id, f, ctx.directory)
            } else if (type === "foreshadowing") {
              const f: { content?: string; state?: string; resolvedChapterId?: string | null } = {}
              if (typeof fields.content === "string") f.content = fields.content
              if (typeof fields.state === "string") f.state = fields.state
              if ("resolved_chapter_id" in fields) {
                f.resolvedChapterId = fields.resolved_chapter_id == null ? null : String(fields.resolved_chapter_id)
              }
              await updateForeshadowing(id, f, ctx.directory)
            } else if (type === "relationship") {
              const f: { type?: string; description?: string } = {}
              if (typeof fields.type === "string") f.type = fields.type
              if (typeof fields.description === "string") f.description = fields.description
              await updateRelationship(id, f, ctx.directory)
            } else {
              return { title: "update_setting", output: `不支持的实体类型：${type}` }
            }
            return {
              title: "update_setting",
              output: `已更新 ${type} ${id.slice(0, 8)}：${Object.keys(fields).join(", ")}`,
              metadata: { entity_type: type, entity_id: id, updated: Object.keys(fields) },
            }
          } catch (err) {
            return {
              title: "update_setting",
              output: `更新失败：${err instanceof Error ? err.message : String(err)}`,
            }
          }
        },
      }),
      foreshadow_plant: tool({
        description:
          "埋设一条新伏笔。伏笔必须具体可查（人物/物品/事件/信息），记录内容和埋设所在章节。重复内容（同 novel 内 content 完全相同）不会重复创建，而是返回已有伏笔。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          content: tool.schema.string().describe("伏笔内容（具体、可在未来回收的线索）"),
          planted_chapter_id: tool.schema.string().optional().describe("埋设伏笔的章节 ID（不传则不绑定章节）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          // 同 novel 内按 content 去重
          const [existing] = await db
            .select()
            .from(ForeshadowingTable)
            .where(and(eq(ForeshadowingTable.novel_id, novelId), eq(ForeshadowingTable.content, args.content)))
            .limit(1)
            .all()
          if (existing) {
            return {
              title: "foreshadow_plant（已存在）",
              output: `伏笔已存在，未重复创建：${existing.content.slice(0, 60)}（状态=${existing.state}，ID=${existing.id}）`,
              metadata: { id: existing.id, deduplicated: true },
            }
          }
          const row = await createForeshadowing(novelId, args.content, args.planted_chapter_id ?? null, ctx.directory)
          return {
            title: "foreshadow_plant",
            output: `已埋设伏笔：${row.content.slice(0, 60)}（ID=${row.id}，状态=planted）`,
            metadata: { id: row.id },
          }
        },
      }),
      foreshadow_resolve: tool({
        description:
          "回收/推进伏笔。把伏笔状态改为 hinted（暗示）、resolved（已回收）或 abandoned（废弃）。回收时应明确呼应前文，并传入回收所在章节 ID。",
        args: {
          foreshadowing_id: tool.schema.string().describe("伏笔 ID"),
          state: tool.schema.string().describe("新状态：hinted / resolved / abandoned"),
          resolved_chapter_id: tool.schema
            .string()
            .optional()
            .describe("回收/暗示所在的章节 ID（resolved/hinted 时建议传入）"),
        },
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
      foreshadow_list: tool({
        description:
          "列出小说的伏笔，可按状态过滤（planted/hinted/resolved/abandoned），返回 ID、内容、状态和所在章节。回收伏笔前用它查找伏笔 ID。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          state: tool.schema
            .string()
            .optional()
            .describe("按状态过滤：planted / hinted / resolved / abandoned（不传则返回全部）"),
        },
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
      record_hook: tool({
        description:
          "记录本章使用的钩子类型。每章写完后调用，用于钩子轮换统计，避免连续 4 章以上使用同一类型。钩子类型仅限：foreshadow_plant（埋设伏笔）、face_slap（打脸反转）、power_up（能力升级）、emotional_peak（情感高潮）。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          hook_type: tool.schema.enum(HOOK_TYPES).describe("本章使用的钩子类型"),
          chapter_id: tool.schema.string().optional().describe("关联章节 ID（可选）"),
        },
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
      get_hook_stats: tool({
        description:
          "查看最近钩子使用统计。返回最近若干条钩子记录；若连续 4 次以上使用同一类型会给出轮换警告。写新章前调用以选择差异化的钩子类型。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          recent_count: tool.schema.number().optional().describe("查询最近多少条记录（默认 10）"),
        },
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
      cascade_check: tool({
        description:
          "查询实体变更的影响范围。输入实体类型和 ID，返回所有引用该实体的内容列表（章节/角色/卷纲等）。用于修改设定前评估影响。零 LLM 依赖，纯 DB 查询。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          entity_type: tool.schema
            .string()
            .describe("被修改的实体类型：character/world_entry/plot_thread/foreshadowing/style_guide/volume"),
          entity_id: tool.schema.string().describe("被修改的实体 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const refs = await cascadeCheck(db, novelId, args.entity_type, args.entity_id)
          if (refs.length === 0) {
            return { title: "cascade_check", output: `没有内容引用该实体（${args.entity_type}: ${args.entity_id}）` }
          }
          const lines = refs.map((r) => `- ${r.source_type} ${r.source_id} [${r.ref_field}]：${r.ref_text}`)
          return {
            title: `cascade_check（${refs.length} 处受影响）`,
            output: lines.join("\n"),
            metadata: { count: refs.length, refs },
          }
        },
      }),
      cascade_create_tasks: tool({
        description:
          "为受影响的内容创建统改任务。在修改设定后调用，自动查询所有引用方并创建 pending_updates 记录。每个任务包含触发原因、旧值、新值和优先级。零 LLM 依赖。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          trigger_type: tool.schema.string().describe("触发变更的实体类型"),
          trigger_id: tool.schema.string().describe("触发变更的实体 ID"),
          trigger_field: tool.schema.string().describe("哪个字段变了（如 content/description/title）"),
          old_value: tool.schema.string().describe("旧值"),
          new_value: tool.schema.string().describe("新值"),
          reason: tool.schema.string().describe("人可读的变更原因"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const count = await cascadeCreateTasks(
            db,
            novelId,
            args.trigger_type,
            args.trigger_id,
            args.trigger_field,
            args.old_value,
            args.new_value,
            args.reason,
          )
          return {
            title: "cascade_create_tasks",
            output: count > 0 ? `已创建 ${count} 个统改任务，使用 cascade_list_pending 查看` : "没有需要统改的内容",
            metadata: { count },
          }
        },
      }),
      cascade_list_pending: tool({
        description: "列出待统改任务。返回所有 pending 状态的任务，包含受影响实体、触发原因、优先级。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          status: tool.schema
            .string()
            .optional()
            .describe("任务状态过滤（默认 pending，可选 done/skipped/in_progress）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const tasks = await cascadeListPending(db, novelId, args.status ?? "pending")
          if (tasks.length === 0) {
            return { title: "cascade_list_pending", output: "没有待统改任务" }
          }
          const lines = tasks.map(
            (t) =>
              `- [${t.priority}] ${t.source_type} ${t.source_id}：${t.reason}（触发：${t.trigger_type} ${t.trigger_id}）`,
          )
          return {
            title: `cascade_list_pending（${tasks.length} 个任务）`,
            output: lines.join("\n"),
            metadata: { count: tasks.length, tasks },
          }
        },
      }),
      cascade_resolve: tool({
        description: "标记统改任务完成或跳过。",
        args: {
          task_id: tool.schema.string().describe("任务 ID"),
          status: tool.schema.string().describe("新状态：done 或 skipped"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          if (args.status !== "done" && args.status !== "skipped") {
            return { title: "cascade_resolve", output: "status 必须是 done 或 skipped" }
          }
          const ok = await cascadeResolve(db, args.task_id, args.status)
          return {
            title: "cascade_resolve",
            output: ok ? `任务 ${args.task_id} 已标记为 ${args.status}` : `任务 ${args.task_id} 不存在`,
            metadata: { resolved: ok },
          }
        },
      }),
      cascade_rebuild_refs: tool({
        description:
          "全量重建依赖关系图。扫描所有章节正文、角色描述、卷纲摘要，重新建立 entity_refs 记录。用于首次启用级联系统或批量导入数据后补建依赖。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const result = await cascadeRebuildRefs(db, novelId)
          return {
            title: "cascade_rebuild_refs",
            output: `已重建依赖关系：${result.chapters} 章正文 + ${result.characters} 角色描述 + ${result.volumes} 卷纲摘要`,
            metadata: result,
          }
        },
      }),
      cascade_execute: tool({
        description:
          "批量执行所有待统改任务（Saga 模式）。创建持久化 saga_session，按优先级逐个处理 pending_updates。character/volume 类型自动替换描述中的旧值，chapter 类型标记为需 @reviser 处理。处理完后自动重扫依赖。这是唯一能清除门禁阻断的方式。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          trigger_type: tool.schema.string().optional().describe("可选：只处理特定触发类型的任务"),
          trigger_id: tool.schema.string().optional().describe("可选：只处理特定触发实体的任务"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const result = await cascadeExecute(db, novelId, args.trigger_type, args.trigger_id)

          if (result.status === "no_tasks") {
            return {
              title: "cascade_execute（无任务）",
              output: "没有待统改任务，门禁已解除。",
              metadata: result,
            }
          }

          const chapterTasks = result.steps.filter((s) => s.source_type === "chapter" && s.action === "skipped")
          const lines = [
            `Saga ${result.saga_id.slice(0, 8)} ${result.status}`,
            `总计 ${result.total}：完成 ${result.completed}，跳过 ${result.skipped}，失败 ${result.failed}`,
          ]
          if (chapterTasks.length > 0) {
            lines.push(`待 @reviser 处理的章节任务：${chapterTasks.length} 个`)
            for (const t of chapterTasks.slice(0, 5)) {
              lines.push(`  - 章节 ${t.source_id}：${t.detail}`)
            }
          }
          if (result.failed > 0) {
            const failedSteps = result.steps.filter((s) => s.action === "failed")
            for (const s of failedSteps) {
              lines.push(`  [失败] ${s.source_type} ${s.source_id}：${s.detail}`)
            }
          }

          return {
            title: `cascade_execute（${result.status}）`,
            output: lines.join("\n"),
            metadata: result,
          }
        },
      }),
      cascade_status: tool({
        description: "查询统改状态：pending 任务数、活跃 saga、最近 saga 记录。用于检查门禁是否激活或 saga 进度。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const status = await cascadeGetStatus(db, novelId)

          const lines: string[] = []
          if (status.pending_count > 0) {
            lines.push(`⚠ 门禁激活：${status.pending_count} 个待统改任务，write_chapter/revise_chapter 被拦截`)
          } else {
            lines.push("门禁未激活，可正常写作")
          }
          if (status.has_active_saga && status.active_saga) {
            const s = status.active_saga
            lines.push(
              `活跃 saga ${s.id.slice(0, 8)}：${s.completed_tasks}/${s.total_tasks} 完成，${s.failed_tasks} 失败`,
            )
          }
          if (status.recent_sagas.length > 0) {
            lines.push("最近 saga 记录：")
            for (const s of status.recent_sagas.slice(0, 3)) {
              lines.push(
                `  ${s.id.slice(0, 8)} [${s.status}] ${s.completed_tasks}/${s.total_tasks} -- ${s.trigger_type}:${s.trigger_id}`,
              )
            }
          }

          return {
            title: "cascade_status",
            output: lines.join("\n"),
            metadata: status,
          }
        },
      }),
      deduplicate_characters: tool({
        description:
          "检查并合并小说中同名重复角色。dry_run=true（默认）返回每组重复角色的完整描述全文，供 director 判断合并策略；dry_run=false 执行机械合并：保留 description 最长的记录，拼接其余非重复描述，将 relationships/entity_refs/pending_updates 中的旧角色 ID 重新指向保留的角色，然后删除重复行。注意：机械合并不做语义去重，若各记录描述差异大或格式不同，director 应先在 dry_run 报告中阅读所有描述，自行生成合并后的统一描述并通过 manage_characters 更新保留角色，再执行 dry_run=false 清理重复行。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          dry_run: tool.schema.boolean().describe("true=仅检查不修改，返回完整描述（默认）；false=执行合并"),
          force: tool.schema
            .boolean()
            .describe(
              "dry_run=false 时，跳过长度保护检查强制执行合并（默认 false）。当保留描述比原始描述短时会触发警告并阻止合并，确认信息无丢失后可设 true 强制执行",
            ),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const result = await deduplicateCharacters(ctx.directory, novelId, args.dry_run ?? true, args.force ?? false)

          const lines: string[] = []
          if (result.warnings.length > 0) {
            for (const w of result.warnings) {
              lines.push(`⚠ ${w}`)
            }
            lines.push("")
          }
          if (result.duplicates.length === 0 && result.warnings.length === 0) {
            lines.push("未发现重复角色")
          } else if (result.duplicates.length > 0) {
            lines.push(
              `${result.dry_run ? "[检查]" : "[已执行]"} 发现 ${result.duplicates.length} 组重复角色，共 ${result.total_removed} 条待删除`,
            )
            for (const d of result.duplicates) {
              lines.push("")
              lines.push(`「${d.name}」x${d.count}（保留 ${d.kept_id.slice(0, 8)}）`)
              if (result.dry_run) {
                for (const r of d.records) {
                  const tag = r.id === d.kept_id ? "保留" : "重复"
                  lines.push(`  [${tag}] ${r.id.slice(0, 8)} | role: ${r.role || "(空)"}`)
                  lines.push(`    ${r.description || "(空描述)"}`)
                }
              } else {
                lines.push(`  已删除 ${d.removed_ids.length} 条${d.merged_description ? "（描述已合并）" : ""}`)
              }
            }
          }

          return {
            title: "deduplicate_characters",
            output: lines.join("\n"),
            metadata: result,
          }
        },
      }),
      deduplicate_relationships: tool({
        description:
          "检查并合并小说中重复关系（char_a_id + char_b_id + type 相同）。dry_run=true（默认）返回每组重复关系的完整描述全文；dry_run=false 执行机械合并：保留 description 最长的记录，拼接其余非重复描述，删除重复行。与 deduplicate_characters 类似，若描述差异大，director 应先阅读 dry_run 报告中的所有描述，生成合并描述后更新保留记录，再执行合并。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          dry_run: tool.schema.boolean().describe("true=仅检查不修改，返回完整描述（默认）；false=执行合并"),
          force: tool.schema.boolean().describe("dry_run=false 时，跳过长度保护检查强制执行合并（默认 false）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const result = await deduplicateRelationships(
            ctx.directory,
            novelId,
            args.dry_run ?? true,
            args.force ?? false,
          )

          const lines: string[] = []
          if (result.warnings.length > 0) {
            for (const w of result.warnings) {
              lines.push(`⚠ ${w}`)
            }
            lines.push("")
          }
          if (result.duplicates.length === 0 && result.warnings.length === 0) {
            lines.push("未发现重复关系")
          } else if (result.duplicates.length > 0) {
            lines.push(
              `${result.dry_run ? "[检查]" : "[已执行]"} 发现 ${result.duplicates.length} 组重复关系，共 ${result.total_removed} 条待删除`,
            )
            for (const d of result.duplicates) {
              lines.push("")
              lines.push(
                `${d.char_a_id.slice(0, 8)} ↔ ${d.char_b_id.slice(0, 8)} [${d.type}] x${d.count}（保留 ${d.kept_id.slice(0, 8)}）`,
              )
              if (result.dry_run) {
                for (const r of d.records) {
                  const tag = r.id === d.kept_id ? "保留" : "重复"
                  lines.push(`  [${tag}] ${r.id.slice(0, 8)}`)
                  lines.push(`    ${r.description || "(空描述)"}`)
                }
              } else {
                lines.push(`  已删除 ${d.removed_ids.length} 条`)
              }
            }
          }

          return {
            title: "deduplicate_relationships",
            output: lines.join("\n"),
            metadata: result,
          }
        },
      }),
      description_history: tool({
        description:
          "查看或恢复角色/关系的描述历史。action=list（默认）列出指定实体的所有历史版本，显示新旧描述长度和前 100 字预览；action=restore 恢复指定历史版本（将旧描述写回当前记录，同时归档当前值）。用于找回被意外缩减或丢失的描述内容。",
        args: {
          action: tool.schema.string().describe("list=查看历史版本（默认）；restore=恢复指定版本"),
          entity_type: tool.schema.string().describe("实体类型：character 或 relationship"),
          entity_id: tool.schema.string().describe("实体 ID（角色 ID 或关系 ID）"),
          history_id: tool.schema.string().describe("action=restore 时必填：要恢复的历史记录 ID"),
        },
        async execute(args, ctx) {
          const action = args.action ?? "list"

          if (action === "restore") {
            if (!args.history_id) {
              return { title: "description_history", output: "action=restore 时需要提供 history_id" }
            }
            const result = await restoreDescription(ctx.directory, args.history_id)
            if (!result) {
              return { title: "description_history", output: `历史记录不存在：${args.history_id}` }
            }
            return {
              title: "description_history（已恢复）",
              output: `已恢复 ${result.entity_type} ${result.entity_id.slice(0, 8)} 的 ${result.field} 到历史版本（${result.restored_value.length} 字）。当前值已自动归档，可再次恢复。`,
              metadata: result,
            }
          }

          const history = await listDescriptionHistory(ctx.directory, args.entity_type, args.entity_id)

          if (history.length === 0) {
            return {
              title: "description_history",
              output: `${args.entity_type} ${args.entity_id.slice(0, 8)} 没有描述历史记录`,
            }
          }

          const lines: string[] = []
          lines.push(`${args.entity_type} ${args.entity_id.slice(0, 8)} 的描述历史（${history.length} 条）：`)
          for (const h of history) {
            lines.push("")
            lines.push(`  [${h.id.slice(0, 8)}] ${new Date(h.created_at).toLocaleString("zh-CN")}`)
            lines.push(`    旧: ${h.old_len} 字 | 新: ${h.new_len} 字${h.new_len < h.old_len ? " ⚠ 缩短" : ""}`)
            lines.push(`    旧描述预览: ${h.old_value.slice(0, 100) || "(空)"}...`)
          }
          lines.push("")
          lines.push("要恢复某个版本，使用 action=restore 并传入对应的 history_id")

          return {
            title: "description_history",
            output: lines.join("\n"),
            metadata: { history, count: history.length },
          }
        },
      }),
    },

    /**
     * 运行时 Agent 注册 hook
     * 注册 director 为唯一 primary agent，writer 降为 subagent。
     * director 负责意图识别和路由，writer 负责具体写作执行。
     */
    config: async (input) => {
      input.default_agent = "director"
      // 允许2层嵌套：director(0) -> pipeline(1) -> writer/reviser(2)
      input.subagent_depth = 2
      input.agent = {
        ...input.agent,
        // 禁用编程导向的内置 agent
        build: { disable: true },
        plan: { disable: true },
        // director: 主 agent，用户直接交互的入口
        director: {
          description: directorAgentConfig.description,
          mode: directorAgentConfig.mode,
          prompt: directorAgentConfig.systemPrompt,
          permission: {
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            task: "allow",
            write_chapter: "allow",
            revise_chapter: "allow",
            manage_characters: "allow",
            save_novel_settings: "allow",
            check_novel_settings: "allow",
            cascade_check: "allow",
            cascade_create_tasks: "allow",
            cascade_list_pending: "allow",
            cascade_resolve: "allow",
            cascade_rebuild_refs: "allow",
            cascade_execute: "allow",
            cascade_status: "allow",
            deduplicate_characters: "allow",
            deduplicate_relationships: "allow",
            description_history: "allow",
            generate_master_outline: "allow",
            generate_volume_outline: "allow",
            generate_chapter_outline: "allow",
          },
        },
        // architect: subagent，由 director 调度，生成并持久化小说设定（世界观/角色/伏笔/剧情线索/风格指南/卷/关系）
        architect: {
          description: architectAgent.description,
          mode: architectAgent.mode,
          prompt: architectAgent.systemPrompt,
          permission: {
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            save_novel_settings: "allow",
          },
        },
        // pipeline: subagent，由 director 调度，执行8步写作流水线
        pipeline: {
          description: pipelineAgentConfig.description,
          mode: pipelineAgentConfig.mode,
          prompt: pipelineAgentConfig.systemPrompt,
          permission: {
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            task: "allow",
            read_chapter_outline: "allow",
            assemble_context_snapshot: "allow",
            check_continuity: "allow",
            validate_state_delta: "allow",
            commit_state_delta: "allow",
            read_chapter_content: "allow",
            commit_observer_delta: "allow",
            advance_chapter: "allow",
          },
        },
        // writer: subagent，由 pipeline 调度，生成章节正文
        writer: {
          description: writerAgentConfig.description,
          mode: writerAgentConfig.mode,
          prompt: writerAgentConfig.systemPrompt,
          permission: {
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            write_chapter: "allow",
            revise_chapter: "allow",
            manage_characters: "allow",
          },
        },
        // observer: subagent，由 pipeline 调度，从章节正文提取状态变更
        observer: {
          description: observerAgent.description,
          mode: observerAgent.mode,
          prompt: observerAgent.prompt,
          permission: {
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            read_chapter_content: "allow",
          },
        },
        // reflector: subagent，由 pipeline 调度，校验 observer 输出的 delta
        reflector: {
          description: reflectorAgent.description,
          mode: reflectorAgent.mode,
          prompt: reflectorAgent.prompt,
          permission: {},
        },
        // auditor: subagent，由 pipeline 调度，37 维 LLM 深度审计
        auditor: {
          description: auditorAgent.description,
          mode: auditorAgent.mode,
          prompt: auditorAgent.prompt,
          permission: {
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            read_chapter_content: "allow",
            submit_chapter_review: "allow",
          },
        },
        // reviser: subagent，由 pipeline 调度，修正 auditor 发现的章节问题
        reviser: {
          description: reviserAgent.description,
          mode: reviserAgent.mode,
          prompt: reviserAgent.prompt,
          permission: {
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            revise_chapter: "allow",
          },
        },
      }
    },
  }
}

/** V1 插件模块导出 - 供 opennovel 插件加载器识别 */
export default {
  id: "novel-writer",
  server: NovelWriterPlugin,
} satisfies import("./index.js").PluginModule

// ─── 工具内部辅助函数 ───

/**
 * 计算下一个版本号。版本号从 1 起，按已有版本最大值 +1。
 */
async function nextVersion(db: ReturnType<typeof getDb>, chapterId: string): Promise<number> {
  const rows = await db
    .select({ version: ChapterVersionTable.version })
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, chapterId))
    .orderBy(desc(ChapterVersionTable.version))
    .limit(1)
    .all()
  return (rows[0]?.version ?? 0) + 1
}

/**
 * 统计字数。对中文按非空白字符计数，最贴近网文字数口径。
 */
function countWords(text: string): number {
  let count = 0
  const cjk = text.match(/\p{Script=Han}/gu)
  if (cjk) count += cjk.length
  const tokens = text.match(/[a-zA-Z0-9]+/g)
  if (tokens) count += tokens.length
  return count
}

/**
 * 读取目标字数下限：style_guide.rules.chapter_length，缺省 2500。
 * write_chapter/revise_chapter 用它做字数门禁——不达标拒绝写入。
 */
async function getTargetWordCount(db: ReturnType<typeof getDb>, novelId: string): Promise<number> {
  const [sg] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).all()
  const raw = parseStyleRules(sg?.rules).chapter_length
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2500
}

/**
 * 检测文本与前文章节的重复度（两层检测，任一命中即视为重复）。
 *
 * 1. 50 字符窗口（步长 10 采样）：统计本章有多少比例的片段与所有前文章节
 *    字面完全相同——捕捉"照抄"级重复。
 * 2. 本章开头 300 字与每章前文开头的 6-gram Jaccard 相似度：捕捉"重演"级
 *    重复——AI 改写措辞重演同一场景（如议事厅对质）时，字面窗口不命中，
 *    但开头高频片段高度重合。正常续写的新章节开头与前文开头几乎不共享
 *    6-gram（实测 <0.01），而重演场景约 0.10。
 */
async function checkDuplicateRatio(
  db: ReturnType<typeof getDb>,
  novelId: string,
  content: string,
  chapterOrder: number,
): Promise<{ ratio: number; openingRatio: number; samples: string[]; duplicate: boolean }> {
  const prevChapters = await db
    .select({ order: ChapterTable.order, content: ChapterTable.content })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), lt(ChapterTable.order, chapterOrder)))
    .all()
  const prevContents = prevChapters.map((c) => c.content).filter((c) => c.length > 0)
  if (prevContents.length === 0 || content.length < 50) {
    return { ratio: 0, openingRatio: 0, samples: [], duplicate: false }
  }

  // 1) 50 字符窗口：照抄级重复
  const windowSize = 50
  const step = 10
  const windows = new Set<string>()
  for (let i = 0; i + windowSize <= content.length; i += step) {
    windows.add(content.slice(i, i + windowSize))
  }
  const allPrev = prevContents.join("\n")
  const matched: string[] = []
  for (const w of windows) {
    if (allPrev.includes(w)) matched.push(w)
  }
  const ratio = windows.size > 0 ? matched.length / windows.size : 0

  // 2) 开头 300 字 6-gram Jaccard：场景重演级重复（取与前文章节开头的最大相似度）
  const opening = content.slice(0, 300)
  let openingRatio = 0
  let bestMatchSample = ""
  for (const pc of prevContents) {
    const j = ngramJaccard6(opening, pc.slice(0, 300))
    if (j > openingRatio) {
      openingRatio = j
      bestMatchSample = pc.slice(0, 30)
    }
  }

  const duplicate = ratio > 0.15 || openingRatio > 0.05
  const samples = duplicate
    ? matched.length > 0
      ? matched.slice(0, 3).map((w) => w.slice(0, 30) + "…")
      : [bestMatchSample + "…"]
    : []
  return { ratio, openingRatio, samples, duplicate }
}

/** 6-gram 字符 Jaccard 相似度（用于开头场景重演检测） */
function ngramJaccard6(a: string, b: string): number {
  const set = (s: string) => {
    const out = new Set<string>()
    for (let i = 0; i + 6 <= s.length; i++) out.add(s.slice(i, i + 6))
    return out
  }
  const A = set(a)
  const B = set(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) {
    if (B.has(x)) inter++
  }
  return inter / (A.size + B.size - inter)
}

/**
 * 校验并自动解析 novel_id。LLM agent 可能传入项目 slug 而非 UUID，
 * 此函数先在 novels 表中查找传入值；若不存在且库中恰好只有一本小说，则返回该小说 ID。
 */
async function resolveNovelId(db: ReturnType<typeof getDb>, novelId: string): Promise<string> {
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
function resolveCharRef(
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
