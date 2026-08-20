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
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "fs"
import { eq, desc, and, asc, lt, sql, inArray } from "drizzle-orm"
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
  commitStateWithReport,
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
  PendingSettingTable,
  WorldEntryConflictTable,
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
  readNovelConfig,
  getSoul,
  type WritingMode,
  type SetupMode,
} from "./novel-writer/session-store.js"
import { chooseSoul, fetchGlobalSoul } from "./novel-writer/soul.js"

export { tagNovelSession, getNovelForSession, isNovelSession }

function projectDirFromCtx(directory?: string | null): string {
  const dbPath = getDbPath(directory)
  return join(dirname(dbPath), "..")
}

/**
 * 模式注入逻辑（项目级，与小说是否绑定无关）
 *
 * 从 .novel/config.json 读取 writing_mode / setup_mode，渲染成中文行为规则。
 * 注入位置在 system.transform 开头，先于小说上下文注入执行，
 * 这样后续 dispatch 的 subagent（writer/reviser/auditor/observer 等）也都能看到。
 *
 * 错误策略：读取失败时降级为默认 auto/interactive，永不抛错。
 */
function injectModeContext(directory: string | null | undefined, system: string[]): void {
  // projectDirFromCtx 会基于 directory 反推项目根；directory 为 null/undefined 时返回 process.cwd()
  let projectDir: string
  try {
    projectDir = projectDirFromCtx(directory)
  } catch {
    return
  }

  let mode: { writing_mode: WritingMode; setup_mode: SetupMode }
  try {
    mode = readNovelConfig(projectDir)
  } catch {
    // 文件损坏等异常情况按默认配置走
    mode = { writing_mode: "auto", setup_mode: "interactive" }
  }

  const writingDesc =
    mode.writing_mode === "review"
      ? "每章完成后将章节状态置为 pending_review 并暂停，等用户在阅读页审批后再继续"
      : "写完整章后自动置 final 并推进，无需人工审批"

  const setupDesc =
    mode.setup_mode === "interactive"
      ? "新书初始化必须先与用户讨论并呈现完整方案（书名/类型/梗概/主要角色/世界观要点），用户明确确认后才可落库"
      : "新书初始化无需确认，直接落库"

  const lines: string[] = ["【写作模式与初始化模式（项目级，持久化）】", ""]
  lines.push(`writing_mode: ${mode.writing_mode}`)
  lines.push(`  行为：${writingDesc}。`)
  lines.push(`setup_mode: ${mode.setup_mode}`)
  lines.push(`  行为：${setupDesc}。`)
  lines.push("")
  lines.push("单次覆盖规则（仅作用于本次执行，不修改配置）：")
  lines.push("- 用户本次指令明确说\"写完给我看 / 写完看看 / 写完等我审\" → 本章按 review 处理（review 模式时此覆盖为冗余但允许）")
  lines.push("- 用户本次指令明确说\"直接写 / 直接发 / 不用看\" → 本章按 auto 处理（auto 模式时此覆盖为冗余但允许）")
  lines.push("- 其余情况按配置模式执行")
  lines.push("")
  lines.push("模式切换：通过 update_project_config(target=\"novel\", field=\"writing_mode\"|\"setup_mode\", value=\"...\") 切换；切换后下次写作起生效，本次正在执行的流水线不重读。")

  // unshift 到 system[0] 位置，确保模式契约始终是 system prompt 的 header，
  // 不会被后续注入的【小说写作上下文快照】等段落挤压到尾部、稀释优先级
  system.unshift(lines.join("\n"))
}

/**
 * 灵魂注入：模式契约固定在 system[0]（injectModeContext 已 unshift），
 * 灵魂插到其后（splice 到 index 1），快照仍由 injectSystemContext push 到尾部。
 * 全局灵魂对所有会话生效；小说灵魂仅在解析到 novelId 时参与合并。
 */
async function injectSoul(
  sessionId: string,
  directory: string | null | undefined,
  system: string[],
  client: Parameters<typeof fetchGlobalSoul>[0],
) {
  const novelId = await resolveNovelForSession(sessionId, directory)
  const novelSoul = novelId ? (await getSoul(novelId, directory))?.content : undefined
  const globalSoul = await fetchGlobalSoul(client).catch(() => undefined)
  const soul = chooseSoul(novelSoul, globalSoul)
  if (!soul) return
  system.splice(1, 0, `【灵魂】\n${soul}`)
}

/**
 * 系统提示注入逻辑。从 hook 中提取出来，便于 hook 层捕获 DB 异常后降级：
 * 小说库 schema 损坏等问题不应阻断整条消息，仅跳过上下文注入。
 */
async function injectSystemContext(sessionId: string, directory: string | null | undefined, system: string[]) {
  // 已绑定会话直接复用；未绑定时若恰好只有一本小说则懒绑定到该会话。
  const novelId = await resolveNovelForSession(sessionId, directory)
  if (!novelId) return

  // 查询当前最新章节序号
  const db = getDb(directory)
  const [latestChapter] = await db
    .select()
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .orderBy(desc(ChapterTable.order))
    .limit(1)
    .all()
  const chapterNumber = latestChapter?.order ?? 0

  // 组装上下文快照
  const snapshot = await assembleSnapshot(novelId, chapterNumber, directory)
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

  if (snapshot.departedCharacters.length > 0) {
    lines.push(`【已退场角色】${snapshot.departedCharacters.join("、")}`)
    lines.push("（后续章节不要再安排这些角色出场，但历史章节中的提及仍然有效）")
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

  if (snapshot.worldEntries.length > 0) {
    const MAX_WORLD_TITLES = 50
    lines.push("【世界观设定】")
    const byCategory = new Map<string, string[]>()
    for (const entry of snapshot.worldEntries.slice(0, MAX_WORLD_TITLES)) {
      const key = entry.category || "未分类"
      byCategory.set(key, [...(byCategory.get(key) ?? []), entry.title])
    }
    for (const [category, titles] of byCategory) {
      lines.push(`${category}：${titles.join("、")}`)
    }
    if (snapshot.worldEntries.length > MAX_WORLD_TITLES) {
      lines.push(`（共 ${snapshot.worldEntries.length} 条，仅列出前 ${MAX_WORLD_TITLES} 条标题）`)
    }
    lines.push('（以上为标题导览；需要某条设定的完整内容时，调用 check_novel_settings(scope="world") 查询）')
    lines.push("")
  }

  if (snapshot.genreRules.length > 0) {
    lines.push("【题材规则】")
    for (const rule of snapshot.genreRules) {
      lines.push(`- ${rule}`)
    }
    lines.push("")
  }

  system.push(lines.join("\n"))
}

/** 会话压缩时的小说上下文注入逻辑，同上支持 hook 层降级。 */
async function injectCompactionContext(sessionId: string, directory: string | null | undefined, context: string[]) {
  // 已绑定会话直接复用；未绑定时若恰好只有一本小说则懒绑定到该会话。
  const novelId = await resolveNovelForSession(sessionId, directory)
  if (!novelId) return

  const db = getDb(directory)

  // P0: 小说蓝图（书名、题材、梗概）
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (novel) {
    context.push(`【小说蓝图】\n书名：${novel.title}\n题材：${novel.genre}\n梗概：${novel.synopsis}`)
  }

  // P1: 活跃角色列表（名称+一句话描述）
  const characters = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()
  if (characters.length > 0) {
    const charLines = characters.map(
      (c) => `- ${c.name}${c.role ? `（${c.role}）` : ""}${c.description ? `：${c.description}` : ""}`,
    )
    context.push(`【活跃角色】\n${charLines.join("\n")}`)
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
    context.push(`【当前卷摘要】\n卷名：${vol.title}\n摘要：${vol.summary}`)
  }
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

      // 模式注入：项目级，无论是否绑定小说都执行；注入到所有 subagent 都能感知
      try {
        injectModeContext(ctx.directory, output.system)
      } catch (error) {
        console.warn(
          "[novel-writer] system.transform hook failed at mode injection:",
          error instanceof Error ? error.message : error,
        )
      }

      try {
        await injectSoul(input.sessionID, ctx.directory, output.system, ctx.clientV2)
      } catch (error) {
        console.warn(
          "[novel-writer] system.transform hook failed at soul injection:",
          error instanceof Error ? error.message : error,
        )
      }

      try {
        await injectSystemContext(input.sessionID, ctx.directory, output.system)
      } catch (error) {
        console.warn(
          "[novel-writer] system.transform hook failed, skipping novel context injection:",
          error instanceof Error ? error.message : error,
        )
      }
    },

    /**
     * 会话压缩 hook
     * 压缩时保留小说上下文（角色、剧情、设定等摘要）。
     */
    "experimental.session.compacting": async (input, output) => {
      output.context = output.context ?? []
      if (!input.sessionID) return

      try {
        await injectCompactionContext(input.sessionID, ctx.directory, output.context)
      } catch (error) {
        console.warn(
          "[novel-writer] session.compacting hook failed, skipping novel context injection:",
          error instanceof Error ? error.message : error,
        )
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
        description:
          "管理小说角色信息。可新增或更新角色（name/role/description/status）。character_id 为空时新增。status 可设为 'active'（活跃）或 'departed'（退场）；退场后后续章节不再安排出场，但历史章节提及仍然有效。主角不能设为 departed。",
        args: {
          character_id: tool.schema.string().describe("角色 ID；传空字符串表示新增角色"),
          update: tool.schema.string().describe("角色更新内容 JSON：{name?,role?,description?,status?,novel_id?}"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          let patch: { name?: string; role?: string; description?: string; status?: string; novel_id?: string }
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

          // 主角保护：不能退场
          if (patch.status === "departed" && existing.role === "protagonist") {
            return {
              title: "manage_characters（已拦截）",
              output: `主角「${existing.name}」不能退场。如需更换主角，请先创建新主角并用 update 将旧主角的 role 改为非主角。`,
            }
          }

          await db
            .update(CharacterTable)
            .set({
              name: patch.name ?? existing.name,
              role: patch.role ?? existing.role,
              description: newDesc,
              ...(patch.status !== undefined ? { status: patch.status } : {}),
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
          // ── P5: 世界观硬约束（writer 必须严格遵守的权威来源） ──
          if (snapshot.worldEntries.length > 0) {
            lines.push("")
            lines.push("═══ 世界观硬约束（P5 权威来源）═══")
            lines.push("⚠️ 以下设定是本章创作的硬约束：等级称谓、力量体系、制度名称、势力名等必须逐字遵循；")
            lines.push("   已列出的概念不得自创变体；未列出的概念如需新增须在 observer 提取时显式 propose 为新 world_entry。")
            for (const w of snapshot.worldEntries) {
              lines.push(`- [${w.category}] ${w.title}`)
              if (w.content) lines.push(`  ${w.content}`)
            }
          }
          if (snapshot.volumeList.length > 0) {
            lines.push("")
            lines.push("═══ 卷纲（章节归属参考）═══")
            for (const v of snapshot.volumeList) {
              lines.push(`- 第${v.order}卷 ${v.title}：${v.summary}`)
            }
          }
          if (snapshot.relationships.length > 0) {
            lines.push("")
            lines.push("═══ 角色关系 ═══")
            for (const r of snapshot.relationships) {
              lines.push(`- ${r.charAName} ↔ ${r.charBName}（${r.type || "未分类"}）：${r.description || "—"}`)
            }
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
          "更新章节标题或状态。用于修改章节标题、推进章节状态。\n" +
          "**审批门禁**：项目 writing_mode=review 时，禁止直接设 status=final（必须走阅读页审批流 — 调 submitApproval 工具）；auto 模式下允许。其他状态（draft/pending_review/rejected/audited/revised/published）按需可设。\n" +
          "正文内容请用 write_chapter/revise_chapter，不要用本工具写正文。",
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

          // 审批门禁：review 模式下禁止直接设 final/published — 必须走审批流
          if (args.status !== undefined) {
            const mode = readNovelConfig(projectDirFromCtx(ctx.directory))
            if (mode.writing_mode === "review" && (args.status === "final" || args.status === "published")) {
              return {
                title: "update_chapter（被门禁拦截）",
                output:
                  `当前项目写作模式为 review，禁止直接设 status=${args.status}。` +
                  `必须先在阅读页提交审批（submitApproval 工具）或用户在阅读页批准/驳回。` +
                  `如需立即结案，请先切换为 auto 模式（update_project_config 改 writing_mode=auto），或用 director 对话让用户改模式。`,
                metadata: { blocked: true, reason: "review_mode_bypass" },
              }
            }
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
      list_chapter_versions: tool({
        description:
          "列出某章节的所有历史版本（按版本号降序）。返回每版的 version 号、字数、创建时间、创建者，以及前 80 字摘要预览。**不返回完整正文**（用 read_chapter_version 读取指定版本）。常用于：发现误改后查看历史、或修订前对比上下文。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          limit: tool.schema.number().optional().describe("最多返回条数，默认 20"),
          offset: tool.schema.number().optional().describe("跳过前 N 条，默认 0（用于分页翻看更早版本）"),
        },
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
          const lines: string[] = [
            `第${chapter.order}章 ${chapter.title} — 共 ${totalCount} 个版本，显示 ${rows.length} 条：`,
          ]
          for (const r of rows) {
            const time = new Date(r.created_at).toLocaleString("zh-CN")
            const summary = r.content.replace(/\s+/g, " ").slice(0, 80)
            const marker = r.version === rows[0].version ? "（最新）" : ""
            lines.push(
              `\n[v${r.version}] ${time} by ${r.created_by} | ${r.word_count} 字${marker}\n  ${summary}…`,
            )
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
      read_chapter_version: tool({
        description:
          "读取章节的指定历史版本的完整正文。默认 read_chapter_content 只读最新版本；想查看历史版本（修订前/驳回前）必须用本工具。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          version: tool.schema.number().int().positive().describe("版本号（整数，从 1 起；用 list_chapter_versions 查到）"),
        },
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
            .where(
              and(eq(ChapterVersionTable.chapter_id, args.chapter_id), eq(ChapterVersionTable.version, args.version)),
            )
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
      diff_chapter_version: tool({
        description:
          "对比某章节任意两个版本的差异（段落级 diff，+ 新增 / - 删除 / 空格 相同）。to_version 默认取最新版本。用于：审批驳回后查看 LLM 改了哪些地方、user 手动修订后看与上一版差异。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          from_version: tool.schema.number().int().positive().describe("起始版本（旧版）"),
          to_version: tool.schema
            .number()
            .int()
            .positive()
            .optional()
            .describe("目标版本（新版），默认取最新版本"),
        },
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
              and(
                eq(ChapterVersionTable.chapter_id, args.chapter_id),
                eq(ChapterVersionTable.version, args.from_version),
              ),
            )
            .all()
          const [toRow] = await db
            .select()
            .from(ChapterVersionTable)
            .where(
              and(
                eq(ChapterVersionTable.chapter_id, args.chapter_id),
                eq(ChapterVersionTable.version, targetVersion),
              ),
            )
            .all()
          if (!fromRow || !toRow) {
            const missing = [
              fromRow ? null : `v${args.from_version}`,
              toRow ? null : `v${targetVersion}`,
            ].filter(Boolean)
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
      restore_chapter_version: tool({
        description:
          "把章节回滚到指定历史版本。**采用追加新版本语义**：不会删除中间任何历史版本，而是把目标 version 的 content 复制为新的 latest version（version 号 = 当前最新 + 1）。同时同步更新 ChapterTable.content 字段。这样：(1) 完整保留所有修订轨迹；(2) review/审批流仍按 latest 工作。",
        args: {
          chapter_id: tool.schema.string().describe("章节 ID"),
          target_version: tool.schema.number().int().positive().describe("要回滚到的目标版本号（用 list_chapter_versions 查到）"),
        },
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
            const report = await commitStateWithReport(novelId, args.chapter_id, delta, db)
            const lines: string[] = [`状态变更已提交，共 ${report.count} 条日志`]
            if (report.pending.length > 0) {
              lines.push(`\n📋 候选区新增 ${report.pending.length} 条（importance=1 或 type_strength=weak，待用户审阅）：`)
              for (const p of report.pending.slice(0, 5)) {
                const tag = p.type_strength ? ` [${p.type_strength}]` : ` [imp=${p.importance}]`
                lines.push(`  - [${p.candidate_type}${tag}] ${p.display_title} (id=${p.id.slice(0, 8)})`)
              }
              if (report.pending.length > 5) lines.push(`  …还有 ${report.pending.length - 5} 条`)
              lines.push(`  → 用 list_pending_settings 查看，accept_pending_setting / reject_pending_setting / merge_pending_settings 管理`)
            }
            if (report.conflicts.length > 0) {
              lines.push(`\n⚠️ 冲突标注 ${report.conflicts.length} 条（不污染 WorldEntryTable.content，已分离到 WorldEntryConflictTable）：`)
              for (const c of report.conflicts.slice(0, 5)) {
                lines.push(`  - [${c.conflict_kind}] ${c.conflict_note.slice(0, 80)}`)
              }
            }
            if (report.discarded > 0) {
              lines.push(`\n🗑️ 临时提及 ${report.discarded} 条（importance=0，不入库）`)
            }
            return {
              title: "commit_observer_delta",
              output: lines.join("\n"),
              metadata: report,
            }
          } catch (err) {
            return {
              title: "commit_observer_delta",
              output: `状态提交失败：${err instanceof Error ? err.message : String(err)}`,
            }
          }
        },
      }),
      list_pending_settings: tool({
        description:
          "列出 pending_settings 候选区。observer 提的 importance=1 设定或 type_strength=weak 关系都先入这里，等用户审阅。director 每章写完后会用本工具列出本章新增的候选，引导用户决定入库 / 拒绝 / 合并。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          status: tool.schema
            .enum(["pending", "accepted", "rejected", "merged"])
            .optional()
            .describe("状态过滤（默认 pending）"),
          candidate_type: tool.schema
            .enum(["character", "world_entry", "relationship", "location"])
            .optional()
            .describe("候选类型过滤（可选）"),
          limit: tool.schema.number().optional().describe("最多返回条数，默认 20"),
          offset: tool.schema.number().optional().describe("跳过前 N 条，默认 0"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const status = args.status ?? "pending"
          const conditions: any[] = [eq(PendingSettingTable.novel_id, novelId), eq(PendingSettingTable.status, status)]
          if (args.candidate_type) conditions.push(eq(PendingSettingTable.candidate_type, args.candidate_type))
          const total = await db
            .select({ c: sql<number>`count(*)` })
            .from(PendingSettingTable)
            .where(and(...conditions))
            .get()
          const totalCount = total?.c ?? 0
          const rows = await db
            .select()
            .from(PendingSettingTable)
            .where(and(...conditions))
            .orderBy(desc(PendingSettingTable.created_at))
            .limit(args.limit ?? 20)
            .offset(args.offset ?? 0)
            .all()
          if (rows.length === 0) {
            return {
              title: "list_pending_settings",
              output: `无 ${status} 候选${args.candidate_type ? `（类型=${args.candidate_type}）` : ""}`,
              metadata: { total: totalCount, returned: 0, items: [] },
            }
          }
          const lines: string[] = [`共 ${totalCount} 条 ${status} 候选，显示 ${rows.length} 条：`]
          for (const r of rows) {
            const tag = r.type_strength ? ` [${r.type_strength}]` : ` [imp=${r.importance}]`
            const time = new Date(r.created_at).toLocaleString("zh-CN")
            const payloadPreview = r.payload_json.length > 60 ? r.payload_json.slice(0, 60) + "…" : r.payload_json
            lines.push(
              `\n[${r.id.slice(0, 8)}] ${time} | ${r.candidate_type}${tag} | ${r.display_title}\n  payload: ${payloadPreview}`,
            )
          }
          return {
            title: "list_pending_settings",
            output: lines.join("\n"),
            metadata: {
              total: totalCount,
              returned: rows.length,
              items: rows.map((r) => ({
                id: r.id,
                candidate_type: r.candidate_type,
                display_title: r.display_title,
                importance: r.importance,
                type_strength: r.type_strength,
                source_chapter_id: r.source_chapter_id,
                created_at: r.created_at,
                payload_json: r.payload_json,
              })),
            },
          }
        },
      }),
      accept_pending_setting: tool({
        description:
          "把候选区的一条 pending 设定正式入库到对应正式表（CharacterTable / WorldEntryTable / RelationshipTable），并把 status 标为 accepted。\n\n**跨 category 同义检测**：accept world_entry 前自动查同 title 的已有 world_entry（任意 category），有则提示合并（仍会执行入库，但 output 会警告「同标题已存在 X 条」）。",
        args: {
          pending_id: tool.schema.string().describe("候选 ID（list_pending_settings 拿）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const [row] = await db.select().from(PendingSettingTable).where(eq(PendingSettingTable.id, args.pending_id)).all()
          if (!row) {
            return { title: "accept_pending_setting", output: `候选不存在：${args.pending_id.slice(0, 8)}` }
          }
          if (row.status !== "pending") {
            return { title: "accept_pending_setting", output: `候选状态为 ${row.status}，不是 pending，不可接受` }
          }
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(row.payload_json) as Record<string, unknown>
          } catch {
            return { title: "accept_pending_setting", output: `payload_json 解析失败：${row.payload_json}` }
          }
          const newId = row.suggested_entity_id || crypto.randomUUID()
          let createdId = ""
          let sameTitleWarning = ""
          try {
            if (row.candidate_type === "character") {
              await db.insert(CharacterTable).values({
                id: newId,
                novel_id: row.novel_id,
                name: String(payload.name ?? row.display_title),
                role: String(payload.role ?? ""),
                description: String(payload.description ?? ""),
                status: "active",
              } as any)
              createdId = newId
            } else if (row.candidate_type === "world_entry") {
              // 跨 category 同义检测
              const sameTitle = await db
                .select({ id: WorldEntryTable.id, category: WorldEntryTable.category })
                .from(WorldEntryTable)
                .where(
                  and(eq(WorldEntryTable.novel_id, row.novel_id), eq(WorldEntryTable.title, String(payload.title ?? ""))),
                )
                .all()
              if (sameTitle.length > 0) {
                const cats = [...new Set(sameTitle.map((s) => s.category))].join(" / ")
                sameTitleWarning = `⚠️ 同标题「${payload.title}」已有 ${sameTitle.length} 条（category: ${cats}）。建议用 merge_pending_settings 合并到现有条目。`
              }
              await db.insert(WorldEntryTable).values({
                id: newId,
                novel_id: row.novel_id,
                category: String(payload.category ?? ""),
                title: String(payload.title ?? row.display_title),
                content: String(payload.content ?? ""),
              } as any)
              createdId = newId
            } else if (row.candidate_type === "location") {
              await db.insert(WorldEntryTable).values({
                id: newId,
                novel_id: row.novel_id,
                category: "地点",
                title: String(payload.name ?? row.display_title),
                content: String(payload.description ?? ""),
              } as any)
              createdId = newId
            } else if (row.candidate_type === "relationship") {
              await db.insert(RelationshipTable).values({
                id: newId,
                novel_id: row.novel_id,
                char_a_id: String(payload.char_a_id ?? ""),
                char_b_id: String(payload.char_b_id ?? ""),
                type: String(payload.type ?? ""),
                description: String(payload.description ?? ""),
              } as any)
              createdId = newId
            } else {
              return { title: "accept_pending_setting", output: `不支持的 candidate_type：${row.candidate_type}` }
            }
            // 标记 accepted
            await db
              .update(PendingSettingTable)
              .set({ status: "accepted", resolved_at: Date.now() })
              .where(eq(PendingSettingTable.id, args.pending_id))
              .run()
            const warnLine = sameTitleWarning ? `\n${sameTitleWarning}` : ""
            return {
              title: "accept_pending_setting",
              output: `已接受 ${row.candidate_type} 候选「${row.display_title}」，入库到正式表（id=${createdId.slice(0, 8)}）${warnLine}`,
              metadata: { pending_id: args.pending_id, created_id: createdId, candidate_type: row.candidate_type, same_title_warning: sameTitleWarning },
            }
          } catch (err) {
            return {
              title: "accept_pending_setting",
              output: `入库失败：${err instanceof Error ? err.message : String(err)}`,
            }
          }
        },
      }),
      reject_pending_setting: tool({
        description: "把候选区的一条 pending 设定标记为 rejected（丢弃）。不会删除记录，只是改 status；用户后续可调 list_pending_settings status=rejected 复查。",
        args: {
          pending_id: tool.schema.string().describe("候选 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const [row] = await db.select().from(PendingSettingTable).where(eq(PendingSettingTable.id, args.pending_id)).all()
          if (!row) {
            return { title: "reject_pending_setting", output: `候选不存在：${args.pending_id.slice(0, 8)}` }
          }
          if (row.status !== "pending") {
            return { title: "reject_pending_setting", output: `候选状态为 ${row.status}，不是 pending，不可拒绝` }
          }
          await db
            .update(PendingSettingTable)
            .set({ status: "rejected", resolved_at: Date.now() })
            .where(eq(PendingSettingTable.id, args.pending_id))
            .run()
          return {
            title: "reject_pending_setting",
            output: `已拒绝 ${row.candidate_type} 候选「${row.display_title}」（id=${args.pending_id.slice(0, 8)}）`,
            metadata: { pending_id: args.pending_id, candidate_type: row.candidate_type, display_title: row.display_title },
          }
        },
      }),
      merge_pending_settings: tool({
        description:
          "合并 N 条候选（≥2）到一条新正式条目。常用于：同一章节 observer 提了多个相似候选项，或 accept 时提示同标题已存在。把所有候选的 payload 按字段合并（取最长 content/description 优先），创建新正式条目后把源候选 status 标为 merged, merged_into=新条目 ID。",
        args: {
          pending_ids: tool.schema
            .array(tool.schema.string())
            .min(2)
            .describe("要合并的候选 ID 列表（≥2 条，必须同 candidate_type）"),
          new_id: tool.schema.string().optional().describe("新正式条目的 ID（不传则自动生成 UUID）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const rows = await db
            .select()
            .from(PendingSettingTable)
            .where(inArray(PendingSettingTable.id, args.pending_ids))
            .all()
          if (rows.length !== args.pending_ids.length) {
            return {
              title: "merge_pending_settings",
              output: `部分候选不存在（找到 ${rows.length}/${args.pending_ids.length} 条）`,
            }
          }
          const ct = rows[0].candidate_type
          if (!rows.every((r) => r.candidate_type === ct)) {
            return {
              title: "merge_pending_settings",
              output: `候选必须同 candidate_type，检测到多种类型混用：${[...new Set(rows.map((r) => r.candidate_type))].join(", ")}`,
            }
          }
          if (rows.some((r) => r.status !== "pending")) {
            return { title: "merge_pending_settings", output: `存在非 pending 状态的候选，不可合并` }
          }
          // 解析所有 payload，合并字段
          const payloads = rows.map((r) => {
            try {
              return { row: r, data: JSON.parse(r.payload_json) as Record<string, unknown> }
            } catch {
              return { row: r, data: {} as Record<string, unknown> }
            }
          })
          const merged: Record<string, unknown> = {}
          for (const p of payloads) {
            for (const [k, v] of Object.entries(p.data)) {
              if (typeof v === "string") {
                if (!merged[k] || (merged[k] as string).length < v.length) merged[k] = v
              } else if (merged[k] === undefined) {
                merged[k] = v
              }
            }
          }
          const createdId = args.new_id || crypto.randomUUID()
          const novelId = rows[0].novel_id
          try {
            if (ct === "character") {
              await db.insert(CharacterTable).values({
                id: createdId,
                novel_id: novelId,
                name: String(merged.name ?? rows[0].display_title),
                role: String(merged.role ?? ""),
                description: String(merged.description ?? ""),
                status: "active",
              } as any)
            } else if (ct === "world_entry" || ct === "location") {
              await db.insert(WorldEntryTable).values({
                id: createdId,
                novel_id: novelId,
                category: ct === "location" ? "地点" : String(merged.category ?? ""),
                title: String(merged.title ?? merged.name ?? rows[0].display_title),
                content: String(merged.content ?? merged.description ?? ""),
              } as any)
            } else if (ct === "relationship") {
              await db.insert(RelationshipTable).values({
                id: createdId,
                novel_id: novelId,
                char_a_id: String(merged.char_a_id ?? ""),
                char_b_id: String(merged.char_b_id ?? ""),
                type: String(merged.type ?? ""),
                description: String(merged.description ?? ""),
              } as any)
            }
            // 标记源候选为 merged
            for (const id of args.pending_ids) {
              await db
                .update(PendingSettingTable)
                .set({ status: "merged", resolved_at: Date.now(), merged_into: createdId })
                .where(eq(PendingSettingTable.id, id))
                .run()
            }
            return {
              title: "merge_pending_settings",
              output: `已合并 ${rows.length} 条 ${ct} 候选到新正式条目（id=${createdId.slice(0, 8)}，display_title=${rows[0].display_title}）`,
              metadata: {
                merged_count: rows.length,
                created_id: createdId,
                candidate_type: ct,
                source_pending_ids: args.pending_ids,
                merged_payload: merged,
              },
            }
          } catch (err) {
            return {
              title: "merge_pending_settings",
              output: `合并失败：${err instanceof Error ? err.message : String(err)}`,
            }
          }
        },
      }),
      init_novel: tool({
        description:
          "初始化一本新书并绑定到当前会话。未绑定书籍的全局对话专用：根据对话中讨论好的书籍创意创建小说记录（书名/类型/简介），创建后当前会话自动成为该书的主会话，随后可直接使用 save_novel_settings 保存设定、generate_master_outline 生成总纲等写作工具。若当前会话已绑定书籍则返回已有绑定，不重复创建。",
        args: {
          title: tool.schema.string().describe("书名"),
          genre: tool.schema.string().describe("类型，必须是：玄幻/都市/仙侠/历史/科幻/悬疑/言情/游戏 之一"),
          synopsis: tool.schema.string().describe("一句话简介或故事梗概"),
        },
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
          const id = crypto.randomUUID()
          const now = Date.now()
          await db
            .insert(NovelTable)
            .values({
              id,
              title: args.title,
              genre: args.genre,
              synopsis: args.synopsis,
              status: "draft",
              created_at: now,
              updated_at: now,
            })
            .run()
          await tagNovelSession(ctx.sessionID, id, ctx.directory)
          return {
            title: "init_novel",
            output: `已创建书籍《${args.title}》（id: ${id}，类型：${args.genre}）并绑定到当前会话。下一步建议：用 save_novel_settings 保存世界观/角色等设定，再用 generate_master_outline 生成整体大纲。`,
            metadata: { novelId: id },
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
            output:
              `已保存 ${count} 条设定${errors.length > 0 ? "，错误：" + errors.join("; ") : ""}\n` +
              `💡 建议：保存设定后调用 check_settings_consistency 验证设定内部自洽性（避免不同条目定义同一概念但数字/术语不一致）`,
            metadata: { count, errors },
          }
        },
      }),
      create_relationship: tool({
        description:
          "建立两个角色之间的单条关系。char_a 和 char_b 都可以是角色名（需在本小说内唯一）或角色 UUID；type 必填，描述关系类型（如 friend/enemy/mentor/亲人/师徒/宿敌）。这是单条创建入口，比 save_novel_settings 批量模式更直接；如需批量创建或多条设定一起落库，请用 save_novel_settings。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
          char_a: tool.schema.string().describe("角色 A 的名称或 UUID"),
          char_b: tool.schema.string().describe("角色 B 的名称或 UUID"),
          type: tool.schema.string().describe("关系类型（如 friend/enemy/mentor/亲人/师徒/宿敌）"),
          description: tool.schema.string().optional().describe("关系的详细说明（可选）"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)

          const resolveChar = async (
            input: string,
            label: string,
          ): Promise<{ id: string } | { error: string }> => {
            const trimmed = input.trim()
            if (!trimmed) return { error: `${label}：不能为空` }
            if (trimmed.length === 36 && trimmed.includes("-")) {
              const [row] = await db
                .select({ id: CharacterTable.id })
                .from(CharacterTable)
                .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.id, trimmed)))
                .limit(1)
                .all()
              return row ? { id: row.id } : { error: `${label}：ID "${trimmed}" 不属于本小说或不存在` }
            }
            const rows = await db
              .select({ id: CharacterTable.id })
              .from(CharacterTable)
              .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.name, trimmed)))
              .all()
            if (rows.length === 1) return { id: rows[0].id }
            if (rows.length > 1) {
              return { error: `${label}：姓名 "${trimmed}" 匹配到 ${rows.length} 个角色，存在歧义，请使用 UUID` }
            }
            return { error: `${label}：姓名 "${trimmed}" 未匹配到任何角色` }
          }

          const a = await resolveChar(args.char_a, "char_a")
          if ("error" in a) return { title: "create_relationship", output: a.error }
          const b = await resolveChar(args.char_b, "char_b")
          if ("error" in b) return { title: "create_relationship", output: b.error }
          if (a.id === b.id) {
            return { title: "create_relationship", output: "char_a 和 char_b 不能是同一角色" }
          }
          if (!args.type.trim()) {
            return { title: "create_relationship", output: "type 不能为空" }
          }

          const id = crypto.randomUUID()
          await db
            .insert(RelationshipTable)
            .values({
              id,
              novel_id: novelId,
              char_a_id: a.id,
              char_b_id: b.id,
              type: args.type.trim(),
              description: (args.description ?? "").trim(),
            })
            .run()

          return {
            title: "create_relationship",
            output: `已建立关系 [${id.slice(0, 8)}] ${args.char_a.trim()} — ${args.type.trim()} → ${args.char_b.trim()}`,
            metadata: { relationship_id: id },
          }
        },
      }),
      check_relationships: tool({
        description:
          "全局关系完整性检查（不绑定章节）。检测自指关系、悬空引用、重复关系、对称冗余、孤立角色、空类型、非标准类型、空描述、敌友矛盾等问题。仅报告不修改；如需修复请用 update_settings / delete_settings。这是结构性检查，不是叙事连续性；如需章节级连续性请用 check_continuity（其中包含关系类型一致 / 敌友转变有因 / 亲密度变化 / 信任度变化 4 维）。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)

          const characters = await db
            .select({ id: CharacterTable.id, name: CharacterTable.name })
            .from(CharacterTable)
            .where(eq(CharacterTable.novel_id, novelId))
            .all()
          const relationships = await db
            .select()
            .from(RelationshipTable)
            .where(eq(RelationshipTable.novel_id, novelId))
            .all()

          const charById = new Map(characters.map((c) => [c.id, c]))
          type Issue = {
            severity: "FAIL" | "WARN"
            dimension: string
            detail: string
            ids?: string[]
          }
          const issues: Issue[] = []

          if (relationships.length === 0 && characters.length > 0) {
            issues.push({
              severity: "WARN",
              dimension: "no_relationships",
              detail: "本小说尚无任何关系",
            })
          }

          const validTypes = new Set([
            "亲情",
            "友情",
            "爱情",
            "敌对",
            "师徒",
            "同门",
            "盟友",
            "仇敌",
            "主仆",
            "竞争",
            "合作",
            "陌生人",
            "同学",
            "同事",
            "邻居",
            "family",
            "friend",
            "romantic",
            "enemy",
            "mentor",
            "ally",
            "rival",
            "master_servant",
            "competition",
            "cooperation",
            "stranger",
            "classmate",
          ])

          const charRelCount = new Map<string, number>()
          for (const c of characters) charRelCount.set(c.id, 0)

          // 收集"对方向"关系列表：用于对称冗余和重复检测
          const forwardList = new Map<string, string[]>() // key = "a||b"，value = relationship id 列表（保持插入顺序）
          const reportedSymmetric = new Set<string>() // 已经报过对称冗余的对

          for (const rel of relationships) {
            charRelCount.set(rel.char_a_id, (charRelCount.get(rel.char_a_id) ?? 0) + 1)
            charRelCount.set(rel.char_b_id, (charRelCount.get(rel.char_b_id) ?? 0) + 1)

            // 1. 自指
            if (rel.char_a_id === rel.char_b_id) {
              const name = charById.get(rel.char_a_id)?.name ?? rel.char_a_id
              issues.push({
                severity: "FAIL",
                dimension: "self_loop",
                detail: `自指关系 [${rel.id.slice(0, 8)}]：「${name}」指向自身`,
                ids: [rel.id],
              })
            }

            // 2. 悬空引用
            if (!charById.has(rel.char_a_id)) {
              issues.push({
                severity: "FAIL",
                dimension: "dangling_reference",
                detail: `悬空引用 [${rel.id.slice(0, 8)}]：char_a_id "${rel.char_a_id.slice(0, 8)}…" 不在本小说角色列表中`,
                ids: [rel.id],
              })
            }
            if (!charById.has(rel.char_b_id)) {
              issues.push({
                severity: "FAIL",
                dimension: "dangling_reference",
                detail: `悬空引用 [${rel.id.slice(0, 8)}]：char_b_id "${rel.char_b_id.slice(0, 8)}…" 不在本小说角色列表中`,
                ids: [rel.id],
              })
            }

            // 3. 对称冗余（A→B 与 B→A 同时存在）
            if (rel.char_a_id !== rel.char_b_id) {
              const reverseKey = `${rel.char_b_id}||${rel.char_a_id}`
              const reverseIds = forwardList.get(reverseKey) ?? []
              const symmetricPair = [rel.char_a_id, rel.char_b_id].sort().join("||")
              if (reverseIds.length > 0 && !reportedSymmetric.has(symmetricPair)) {
                const aName = charById.get(rel.char_a_id)?.name ?? rel.char_a_id.slice(0, 8)
                const bName = charById.get(rel.char_b_id)?.name ?? rel.char_b_id.slice(0, 8)
                const allIds = [...reverseIds, rel.id]
                issues.push({
                  severity: "WARN",
                  dimension: "symmetric_redundancy",
                  detail: `对称冗余：「${aName}」↔「${bName}」双向关系均存在 [${allIds.map((id) => id.slice(0, 8)).join(", ")}]，建议合并为单条或确认是否需要双向记录`,
                  ids: allIds,
                })
                reportedSymmetric.add(symmetricPair)
              }
            }

            // 4. 重复（A→B 多次）
            const pairKey = `${rel.char_a_id}||${rel.char_b_id}`
            const list = forwardList.get(pairKey) ?? []
            list.push(rel.id)
            forwardList.set(pairKey, list)

            // 5. 空类型
            if (rel.type === "") {
              issues.push({
                severity: "FAIL",
                dimension: "empty_type",
                detail: `空类型 [${rel.id.slice(0, 8)}]：未指定关系类型`,
                ids: [rel.id],
              })
            } else if (!validTypes.has(rel.type)) {
              issues.push({
                severity: "WARN",
                dimension: "non_standard_type",
                detail: `非标准类型 [${rel.id.slice(0, 8)}]：「${rel.type}」不在常见关系类型白名单中`,
                ids: [rel.id],
              })
            }

            // 6. 空描述
            if (rel.description === "") {
              issues.push({
                severity: "WARN",
                dimension: "empty_description",
                detail: `空描述 [${rel.id.slice(0, 8)}]：type="${rel.type}" 缺少说明`,
                ids: [rel.id],
              })
            }
          }

          // 重复（同方向 A→B 出现多次）
          for (const [pairKey, ids] of forwardList) {
            if (ids.length > 1) {
              const [aId, bId] = pairKey.split("||")
              const aName = charById.get(aId!)?.name ?? aId!.slice(0, 8)
              const bName = charById.get(bId!)?.name ?? bId!.slice(0, 8)
              issues.push({
                severity: "FAIL",
                dimension: "duplicate",
                detail: `重复关系：「${aName}」→「${bName}」出现 ${ids.length} 次 [${ids.map((id) => id.slice(0, 8)).join(", ")}]`,
                ids,
              })
            }
          }

          // 孤立角色
          const orphans: string[] = []
          for (const [id, count] of charRelCount) {
            if (count === 0) {
              orphans.push(charById.get(id)?.name ?? id.slice(0, 8))
            }
          }
          if (orphans.length > 0) {
            issues.push({
              severity: "WARN",
              dimension: "orphan_character",
              detail: `${orphans.length} 个角色无任何关系：${orphans.slice(0, 10).join("、")}${orphans.length > 10 ? "…" : ""}`,
            })
          }

          // 敌友矛盾
          const hostileTypes = new Set(["敌对", "仇敌", "enemy"])
          const friendlyTypes = new Set([
            "亲情",
            "友情",
            "爱情",
            "师徒",
            "同门",
            "盟友",
            "family",
            "friend",
            "romantic",
            "mentor",
            "ally",
          ])
          const typeByPair = new Map<string, Set<string>>()
          for (const rel of relationships) {
            const key = [rel.char_a_id, rel.char_b_id].sort().join("||")
            const set = typeByPair.get(key) ?? new Set<string>()
            set.add(rel.type)
            typeByPair.set(key, set)
          }
          const conflicts: string[] = []
          for (const [key, types] of typeByPair) {
            const hasHostile = [...types].some((t) => hostileTypes.has(t))
            const hasFriendly = [...types].some((t) => friendlyTypes.has(t))
            if (hasHostile && hasFriendly) {
              const [aId, bId] = key.split("||")
              conflicts.push(`${charById.get(aId!)?.name ?? aId!.slice(0, 8)} ↔ ${charById.get(bId!)?.name ?? bId!.slice(0, 8)}`)
            }
          }
          if (conflicts.length > 0) {
            issues.push({
              severity: "WARN",
              dimension: "hostile_friendly_conflict",
              detail: `${conflicts.length} 对角色关系同时存在敌对与友好类型：${conflicts.slice(0, 5).join("；")}${conflicts.length > 5 ? "…" : ""}`,
            })
          }

          // 输出报告
          const fails = issues.filter((i) => i.severity === "FAIL")
          const warns = issues.filter((i) => i.severity === "WARN")
          const lines: string[] = []
          lines.push("## 关系完整性检查报告")
          lines.push("")
          lines.push(`- 角色数：${characters.length}`)
          lines.push(`- 关系数：${relationships.length}`)
          lines.push(`- FAIL：${fails.length}  WARN：${warns.length}`)
          lines.push("")
          if (issues.length === 0) {
            lines.push("未发现问题。")
          } else {
            if (fails.length > 0) {
              lines.push("### FAIL（需处理）")
              for (const i of fails) lines.push(`- **${i.dimension}**：${i.detail}`)
              lines.push("")
            }
            if (warns.length > 0) {
              lines.push("### WARN（建议处理）")
              for (const i of warns) lines.push(`- **${i.dimension}**：${i.detail}`)
              lines.push("")
            }
            lines.push("修复方式：用 list_settings 拿到 entity_id，再用 update_settings / delete_settings 修改或删除。")
          }

          return {
            title: "check_relationships",
            output: lines.join("\n"),
            metadata: {
              fail_count: fails.length,
              warn_count: warns.length,
              character_count: characters.length,
              relationship_count: relationships.length,
              issues: issues.map((i) => ({
                severity: i.severity,
                dimension: i.dimension,
                detail: i.detail,
                ids: i.ids ?? [],
              })),
            },
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
      check_settings_consistency: tool({
        description:
          "扫描小说设定内部的自相矛盾（intra-setting consistency）。检查 worldEntries / characters / relationships 内部和跨条目的冲突，输出 WARN/FAIL 级别问题列表，供 director 在 save_novel_settings 后或人工审查设定时使用。**不是**审计章节与设定的对照（那个由 37 维审计/auditor 负责）。检查项：(1) 同 category 下标题完全重复的条目；(2) 同 category 下数字冲突（如一条说『12 神主』另一条说『10 神主』）；(3) 跨 category 引用但关键词冲突（如社会制度定义神主数量与势力定义神主数量不一致）。语义级矛盾需 LLM 审计最终判断。",
        args: {
          novel_id: tool.schema.string().describe("小说 ID"),
        },
        async execute(args, ctx) {
          const db = getDb(ctx.directory)
          const novelId = await resolveNovelId(db, args.novel_id)
          const issues: Array<{ severity: "WARN" | "FAIL"; kind: string; message: string; entries: string[] }> = []

          // ── 1) 拉所有 worldEntries / characters / relationships ──
          const worldEntries = await db
            .select()
            .from(WorldEntryTable)
            .where(eq(WorldEntryTable.novel_id, novelId))
            .all()
          const characters = await db
            .select()
            .from(CharacterTable)
            .where(eq(CharacterTable.novel_id, novelId))
            .all()
          const relationships = await db
            .select()
            .from(RelationshipTable)
            .where(eq(RelationshipTable.novel_id, novelId))
            .all()

          // ── 2) 同 category 下标题完全重复 ──
          const titleCount = new Map<string, typeof worldEntries>()
          for (const w of worldEntries) {
            const key = `${w.category}::${w.title.trim()}`
            const arr = titleCount.get(key) ?? []
            arr.push(w)
            titleCount.set(key, arr)
          }
          for (const [key, dup] of titleCount) {
            if (dup.length > 1) {
              issues.push({
                severity: "FAIL",
                kind: "duplicate_title",
                message: `同 category 同标题存在 ${dup.length} 条重复条目：${key}`,
                entries: dup.map((d) => `[${d.id.slice(0, 8)}] ${d.title}`),
              })
            }
          }

          // ── 3) 数字冲突：扫描内容里的"X 个/位/名/条 + 名词"短语 ──
          // 只检测"明确量词"的定义型短语（如"12 位神主"），不检测"X万年""X万亿"
          // 这类"不同子项的不同数值"（如 5万年/10万年 是不同境界的寿元），不算冲突。
          // 判定逻辑：跨条目出现"X+量词+同一短主词"且数字不同 → 视为总量定义冲突
          //
          // 简化策略：只抽取"恰好 2 字"主词（最稳的实词头），
          // 并要求主词后必须是**非中文边界**（标点/空白/换行/英文/数字）以避免贪婪匹配吞字。
          // 3+ 字长词（如"元婴期探索者"）归一化困难，**先 drop**（避免误报）。
          // 这意味着当前实现只捕获最明显的冲突；语义级冲突需 LLM 审计。
          const numberPhraseMap = new Map<
            string,
            Array<{ entryId: string; title: string; phrase: string; number: number }>
          >()
          // 主词恰好 2 字，且后面必须是"非中文边界"（标点/空白/换行/英文/数字/结束）
          const numRegex = /(\d+)\s*(个|位|名|条|种|重|层)\s*([一-龥]{2})(?:[，。！？；：、\s()\[\]【】（）《》「」『』""''\n]|$)/g
          for (const w of worldEntries) {
            const text = w.title + "\n" + (w.content ?? "")
            let m: RegExpExecArray | null
            while ((m = numRegex.exec(text))) {
              const number = parseInt(m[1]!, 10)
              const noun = m[3]!
              if (number < 2 || number > 10000) continue
              const key = noun
              const arr = numberPhraseMap.get(key) ?? []
              arr.push({ entryId: w.id, title: w.title, phrase: m[0], number })
              numberPhraseMap.set(key, arr)
            }
          }
          // 同一短主词出现不同数字 → 提示（不直接 FAIL，因为可能不同语境）
          // 例：「12 位神主」vs「10 位神主在蓝星立国」可能是总数 vs 立国数，不一定冲突
          // 改标 WARN 并附 LLM 审计建议，避免启发式扫描的误报阻塞工作流
          for (const [noun, occurrences] of numberPhraseMap) {
            if (occurrences.length < 2) continue
            const uniqueNums = [...new Set(occurrences.map((o) => o.number))]
            if (uniqueNums.length > 1) {
              issues.push({
                severity: "WARN",
                kind: "number_inconsistency",
                message: `"${noun}"在不同条目中出现不同数字（${uniqueNums.join(" vs ")}）— 可能不同语境（如总数 vs 子集），建议 LLM 审计确认是否真有冲突`,
                entries: occurrences.map((o) => `[${o.entryId.slice(0, 8)}] ${o.title}: "${o.phrase}"`),
              })
            }
          }

          // ── 4) 角色表：同 name 不同 id（疑似重名） ──
          const nameCount = new Map<string, typeof characters>()
          for (const c of characters) {
            const arr = nameCount.get(c.name.trim()) ?? []
            arr.push(c)
            nameCount.set(c.name.trim(), arr)
          }
          for (const [name, dup] of nameCount) {
            if (dup.length > 1) {
              issues.push({
                severity: "WARN",
                kind: "duplicate_character_name",
                message: `同名称「${name}」存在 ${dup.length} 个角色记录，建议确认是否同人`,
                entries: dup.map((c) => `[${c.id.slice(0, 8)}] ${c.name}（${c.role}）`),
              })
            }
          }

          // ── 5) 关系表：自引用 (char_a == char_b) ──
          for (const r of relationships) {
            if (r.char_a_id === r.char_b_id) {
              issues.push({
                severity: "WARN",
                kind: "self_relationship",
                message: `关系记录自引用：char_a == char_b（${r.type}：${r.description}）`,
                entries: [`[${r.id.slice(0, 8)}]`],
              })
            }
          }

          // ── 汇总输出 ──
          if (issues.length === 0) {
            return {
              title: "check_settings_consistency",
              output: `设定自洽性检查通过（${worldEntries.length} worldEntries + ${characters.length} 角色 + ${relationships.length} 关系），未发现明显矛盾`,
              metadata: { novel_id: novelId, issue_count: 0 },
            }
          }
          const failCount = issues.filter((i) => i.severity === "FAIL").length
          const warnCount = issues.filter((i) => i.severity === "WARN").length
          const lines: string[] = []
          lines.push(`⚠️ 设定自洽性检查发现 ${issues.length} 个问题（FAIL ${failCount} / WARN ${warnCount}）：`)
          for (const i of issues) {
            lines.push(`\n[${i.severity}] ${i.kind}: ${i.message}`)
            for (const e of i.entries) lines.push(`  - ${e}`)
          }
          return {
            title: "check_settings_consistency",
            output: lines.join("\n"),
            metadata: { novel_id: novelId, issue_count: issues.length, fail_count: failCount, warn_count: warnCount, issues },
          }
        },
      }),
      delete_setting: tool({
        description:
          "删除小说设定。支持删除 character/world_entry/plot_thread/foreshadowing/volume/relationship 类型的记录。删除前建议先用 list_settings 获取 entity_id，再用 cascade_check 检查影响范围。注意：角色（character）删除有保护--主角不能删除；已在章节正文中出场的角色不能硬删除（会破坏叙事连续性），应改用 update_setting 将 status 设为 'departed' 让角色退场。",
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
            const msg = err instanceof Error ? err.message : String(err)
            let output = `删除失败：${msg}`
            if (msg === "PROTAGONIST_CANNOT_BE_DELETED") {
              output = `主角不能删除。如需更换主角，请先创建新主角并用 update_setting 将旧主角的 role 改为非主角，再退场或删除。`
            } else if (msg === "CHARACTER_APPEARED_IN_CHAPTERS") {
              output = `此角色已在章节正文中出场，不能硬删除（会破坏叙事连续性）。请改用 update_setting 将 status 设为 "departed" 让角色退场：退场后后续章节不再安排出场，但历史章节中的提及仍然有效。`
            }
            return { title: "delete_setting", output }
          }
        },
      }),
      update_setting: tool({
        description:
          "更新已有的小说设定记录。支持 world_entry（修改 category/title/content）、plot_thread（修改 title/status/priority/description，status 设为 closed 会自动记录关闭时间）、foreshadowing（修改 content/state/resolved_chapter_id，state 可为 planted/hinted/resolved/abandoned）、relationship（修改 type/description）。用 list_settings 获取 entity_id 后再更新。\n\n副作用（设定修改会级联到已写章节）：\n- world_entry.title 改名：自动重建 EntityRef 引用追踪；旧标题若已被章节正文引用，会在 PendingUpdate 表创建级联任务，提示 director/用户是否要统改这些章节的对应称谓。\n- world_entry.content 大改（如改爵位体系/境界名等关键定义）：同样会触发引用了该条目的章节的级联任务。\n- 其他类型修改不触发级联（仅引用关系可能变化，scanReferences 在下次 commit 时重建）。",
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
          const db = getDb(ctx.directory)
          // 引用追踪 + 级联副作用
          let cascadeSummary: { affected_chapters: number; tasks_created: number; old_title?: string; new_title?: string; old_content_head?: string; new_content_head?: string } | null = null
          // 设定修改历史归档：每个真实变化的字段都记一条 description_history
          const historyEntries: Array<{ field: string; old_len: number; new_len: number }> = []
          try {
            if (type === "world_entry") {
              // 1) 拿旧值，用于比对 + 构造 cascade reason + 归档
              const oldRow = await db
                .select()
                .from(WorldEntryTable)
                .where(eq(WorldEntryTable.id, id))
                .get()
              if (!oldRow) {
                return { title: "update_setting", output: `world_entry 不存在：${id.slice(0, 8)}` }
              }
              const f: { category?: string; title?: string; content?: string } = {}
              if (typeof fields.category === "string") f.category = fields.category
              if (typeof fields.title === "string") f.title = fields.title
              if (typeof fields.content === "string") f.content = fields.content
              await updateWorldEntry(id, f, ctx.directory)

              // 2) 重建本 world_entry 在所有 chapter_versions.content 中的引用追踪
              //    新 title / 新 content 重新 scan（EntityRefTable 里本 world_entry 的旧引用作废）
              const newContent = (f.content ?? oldRow.content) ?? ""
              await scanReferences(db, oldRow.novel_id, "world_entry", id, "content", newContent)

              // 3) 每个真实变化的字段 → 归档到 description_history
              if (f.category !== undefined && f.category !== oldRow.category) {
                await archiveDescription(ctx.directory, oldRow.novel_id, "world_entry", id, oldRow.category, f.category, "category")
                historyEntries.push({ field: "category", old_len: oldRow.category.length, new_len: f.category.length })
              }
              if (f.title !== undefined && f.title !== oldRow.title) {
                await archiveDescription(ctx.directory, oldRow.novel_id, "world_entry", id, oldRow.title, f.title, "title")
                historyEntries.push({ field: "title", old_len: oldRow.title.length, new_len: f.title.length })
              }
              if (f.content !== undefined && f.content !== (oldRow.content ?? "")) {
                await archiveDescription(ctx.directory, oldRow.novel_id, "world_entry", id, oldRow.content ?? "", f.content, "content")
                historyEntries.push({ field: "content", old_len: (oldRow.content ?? "").length, new_len: f.content.length })
              }

              // 4) title 或 content 变化 → 触发章节级联（影响已写正文的连贯性）
              const titleChanged = typeof f.title === "string" && f.title !== oldRow.title
              const contentChanged = typeof f.content === "string" && f.content !== oldRow.content
              if (titleChanged || contentChanged) {
                const oldVal = titleChanged ? oldRow.title : (oldRow.content ?? "").slice(0, 80)
                const newVal = titleChanged ? (f.title as string) : (f.content as string).slice(0, 80)
                const reason = titleChanged
                  ? `world_entry 标题由「${oldRow.title}」改为「${f.title}」，可能影响已写章节中对该条目的称谓`
                  : `world_entry「${oldRow.title}」内容有大幅修改，已写章节可能与新设定不一致`
                const tasksCreated = await cascadeCreateTasks(
                  db,
                  oldRow.novel_id,
                  "world_entry",
                  id,
                  titleChanged ? "title" : "content",
                  oldVal,
                  newVal,
                  reason,
                )
                // 实际受影响的章节数（去重）—— cascadeCreateTasks 内部已 dedup，仅作展示
                const affectedRefs = await cascadeCheck(db, oldRow.novel_id, "world_entry", id)
                const affectedChapters = new Set(affectedRefs.filter((r) => r.source_type === "chapter").map((r) => r.source_id)).size
                cascadeSummary = {
                  affected_chapters: affectedChapters,
                  tasks_created: tasksCreated,
                  old_title: titleChanged ? oldRow.title : undefined,
                  new_title: titleChanged ? (f.title as string) : undefined,
                  old_content_head: contentChanged ? (oldRow.content ?? "").slice(0, 40) : undefined,
                  new_content_head: contentChanged ? (f.content as string).slice(0, 40) : undefined,
                }
              }
            } else if (type === "plot_thread") {
              const oldRow = await db
                .select()
                .from(PlotThreadTable)
                .where(eq(PlotThreadTable.id, id))
                .get()
              if (!oldRow) {
                return { title: "update_setting", output: `plot_thread 不存在：${id.slice(0, 8)}` }
              }
              const f: { title?: string; status?: string; priority?: string; description?: string } = {}
              if (typeof fields.title === "string") f.title = fields.title
              if (typeof fields.status === "string") f.status = fields.status
              if (typeof fields.priority === "string") f.priority = fields.priority
              if (typeof fields.description === "string") f.description = fields.description
              await updatePlotThread(id, f, ctx.directory)
              // 归档每个真实变化的字段
              for (const field of ["title", "status", "priority", "description"] as const) {
                if (f[field] === undefined) continue
                const newVal = f[field] as string
                const oldVal = (oldRow[field] ?? "") as string
                if (newVal === oldVal) continue
                await archiveDescription(ctx.directory, oldRow.novel_id, "plot_thread", id, oldVal, newVal, field)
                historyEntries.push({ field, old_len: oldVal.length, new_len: newVal.length })
              }
            } else if (type === "foreshadowing") {
              const oldRow = await db
                .select()
                .from(ForeshadowingTable)
                .where(eq(ForeshadowingTable.id, id))
                .get()
              if (!oldRow) {
                return { title: "update_setting", output: `foreshadowing 不存在：${id.slice(0, 8)}` }
              }
              const f: { content?: string; state?: string; resolvedChapterId?: string | null } = {}
              if (typeof fields.content === "string") f.content = fields.content
              if (typeof fields.state === "string") f.state = fields.state
              if ("resolved_chapter_id" in fields) {
                f.resolvedChapterId = fields.resolved_chapter_id == null ? null : String(fields.resolved_chapter_id)
              }
              await updateForeshadowing(id, f, ctx.directory)
              // 归档 content / state
              if (f.content !== undefined && f.content !== (oldRow.content ?? "")) {
                await archiveDescription(ctx.directory, oldRow.novel_id, "foreshadowing", id, oldRow.content ?? "", f.content, "content")
                historyEntries.push({ field: "content", old_len: (oldRow.content ?? "").length, new_len: f.content.length })
              }
              if (f.state !== undefined && f.state !== oldRow.state) {
                await archiveDescription(ctx.directory, oldRow.novel_id, "foreshadowing", id, oldRow.state, f.state, "state")
                historyEntries.push({ field: "state", old_len: oldRow.state.length, new_len: f.state.length })
              }
            } else if (type === "relationship") {
              const oldRow = await db
                .select()
                .from(RelationshipTable)
                .where(eq(RelationshipTable.id, id))
                .get()
              if (!oldRow) {
                return { title: "update_setting", output: `relationship 不存在：${id.slice(0, 8)}` }
              }
              const f: { type?: string; description?: string } = {}
              if (typeof fields.type === "string") f.type = fields.type
              if (typeof fields.description === "string") f.description = fields.description
              await updateRelationship(id, f, ctx.directory)
              // 归档 type / description
              if (f.type !== undefined && f.type !== (oldRow.type ?? "")) {
                await archiveDescription(ctx.directory, oldRow.novel_id, "relationship", id, oldRow.type ?? "", f.type, "type")
                historyEntries.push({ field: "type", old_len: (oldRow.type ?? "").length, new_len: f.type.length })
              }
              if (f.description !== undefined && f.description !== (oldRow.description ?? "")) {
                await archiveDescription(ctx.directory, oldRow.novel_id, "relationship", id, oldRow.description ?? "", f.description, "description")
                historyEntries.push({ field: "description", old_len: (oldRow.description ?? "").length, new_len: f.description.length })
              }
            } else {
              return { title: "update_setting", output: `不支持的实体类型：${type}` }
            }
            // 拼接级联提示 + 历史归档提示
            let cascadeLine = ""
            if (cascadeSummary) {
              const parts: string[] = []
              if (cascadeSummary.tasks_created > 0) {
                parts.push(
                  `已为 ${cascadeSummary.tasks_created} 个引用章节创建级联任务（在 cascade_list_pending 中可见）`,
                )
              } else if (cascadeSummary.affected_chapters > 0) {
                parts.push(
                  `检测到 ${cascadeSummary.affected_chapters} 个章节引用此条目，但已存在同类级联任务，未重复创建`,
                )
              } else if (cascadeSummary.old_title || cascadeSummary.old_content_head) {
                parts.push(`暂无章节引用此条目，无级联任务`)
              }
              if (cascadeSummary.old_title && cascadeSummary.new_title) {
                parts.push(`称谓：${cascadeSummary.old_title} → ${cascadeSummary.new_title}`)
              }
              if (parts.length > 0) cascadeLine = `\n⚠️ 级联提醒：${parts.join("；")}`
            }
            let historyLine = ""
            if (historyEntries.length > 0) {
              historyLine = `\n📜 历史归档：${historyEntries.length} 个字段已记录（${historyEntries.map((h) => `${h.field}: ${h.old_len}→${h.new_len}字`).join("，")}）；用 description_history 工具查看/恢复历史版本`
            }
            return {
              title: "update_setting",
              output: `已更新 ${type} ${id.slice(0, 8)}：${Object.keys(fields).join(", ")}${cascadeLine}${historyLine}`,
              metadata: { entity_type: type, entity_id: id, updated: Object.keys(fields), cascade: cascadeSummary, history_archived: historyEntries },
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
          "查看或恢复任意设定字段的修改历史。action=list（默认）列出指定实体的所有历史版本，显示字段名/新旧值长度/前 100 字预览；action=restore 恢复指定历史版本（将旧值写回当前记录，同时归档当前值）。覆盖 character / world_entry / plot_thread / foreshadowing / relationship 5 种实体，每种实体的可恢复字段由 update_setting 的 fields 决定（character.description, world_entry.{category|title|content}, plot_thread.{title|status|priority|description}, foreshadowing.{content|state}, relationship.{type|description}）。用于找回被误改/缩减/丢失的设定内容。",
        args: {
          action: tool.schema.string().describe("list=查看历史版本（默认）；restore=恢复指定版本"),
          entity_type: tool.schema
            .string()
            .describe("实体类型：character / world_entry / plot_thread / foreshadowing / relationship"),
          entity_id: tool.schema.string().describe("实体 ID"),
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
              output: `${args.entity_type} ${args.entity_id.slice(0, 8)} 暂无历史记录`,
            }
          }

          const lines: string[] = []
          lines.push(`${args.entity_type} ${args.entity_id.slice(0, 8)} 的历史记录（${history.length} 条）：`)
          for (const h of history) {
            lines.push("")
            lines.push(`  [${h.id.slice(0, 8)}] field=${h.field} | ${new Date(h.created_at).toLocaleString("zh-CN")}`)
            lines.push(`    旧: ${h.old_len} 字 | 新: ${h.new_len} 字${h.new_len < h.old_len ? " ⚠ 缩短" : ""}`)
            lines.push(`    旧值预览: ${h.old_value.slice(0, 100) || "(空)"}...`)
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
      check_project_config: tool({
        description:
          "一键拉取项目配置文件的关键字段概览。读取 opennovel.json（model/small_model/default_agent/username/share/autoupdate/logLevel）和 .novel/config.json（name/created_at/version/writing_mode/setup_mode），供 director 路由'改模型配置/改项目名称/查看当前配置/切换写作模式'类指令使用。仅查询不修改，文件不存在或字段不在白名单时跳过。",
        args: {},
        async execute(_args, ctx) {
          return readProjectConfig(projectDirFromCtx(ctx.directory))
        },
      }),
      update_project_config: tool({
        description:
          "更新项目配置文件的白名单字段。target=opennovel 时改 opennovel.json，支持 model（provider/model 格式）、small_model、default_agent、username、share、autoupdate、logLevel；target=novel 时改 .novel/config.json，支持 name、version、writing_mode（auto 自动 / review 审核）、setup_mode（interactive 确认 / auto 自动）。改前自动备份原文件到 <file>.bak；拒绝改 provider/mcp/permission/plugin/agent.*.permission 等敏感字段（防止越权改认证信息或权限）。",
        args: {
          target: tool.schema
            .enum(["opennovel", "novel"])
            .describe("目标配置文件：opennovel=opennovel.json，novel=.novel/config.json"),
          field: tool.schema.string().describe("要修改的字段名（受白名单限制，见 description）"),
          value: tool.schema
            .string()
            .describe(
              "新值。字符串字段（model/name 等）直接传字符串；enum/boolean 字段传 JSON 字面量如 true / \"auto\" / \"DEBUG\"",
            ),
        },
        async execute(args, ctx) {
          return writeProjectConfig(
            projectDirFromCtx(ctx.directory),
            args.target as "opennovel" | "novel",
            args.field,
            args.value,
          )
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
            create_relationship: "allow",
            check_relationships: "allow",
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
            list_chapter_versions: "allow",
            read_chapter_version: "allow",
            diff_chapter_version: "allow",
            restore_chapter_version: "allow",
            generate_master_outline: "allow",
            generate_volume_outline: "allow",
            generate_chapter_outline: "allow",
            check_project_config: "allow",
            update_project_config: "allow",
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
            create_relationship: "allow",
            check_relationships: "allow",
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
            check_settings_consistency: "allow",
            validate_state_delta: "allow",
            commit_state_delta: "allow",
            read_chapter_content: "allow",
            commit_observer_delta: "allow",
            advance_chapter: "allow",
            // 模式分支：review 模式置 pending_review、auto 模式置 final
            update_chapter: "allow",
            // 驳回后重写指定章节
            revise_chapter: "allow",
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
 * 段落级 diff。用最长公共子序列（LCS）对齐两段按行/段切分的内容，
 * 输出 same / add / remove 三种操作的数组，供 diff_chapter_version 工具使用。
 *
 * - 同一段：标记 same（输出空格前缀）
 * - 仅旧版本有：标记 remove（- 前缀）
 * - 仅新版本有：标记 add（+ 前缀）
 *
 * 简化版：跳过 block move（顺序敏感），LCS 对齐保证相同段落不被误标 add/remove。
 * 对章节正文来说，正文很少整体 block move，常见模式是「保留大部分 + 改几段」，
 * 这种模式下 LCS 准确率足够。
 */
type DiffOp = { kind: "same" | "add" | "remove"; text: string }

function computeParagraphDiff(a: string[], b: string[]): DiffOp[] {
  const m = a.length
  const n = b.length
  // 1) dp[i][j] = LCS length of a[0..i-1], b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  // 2) 反向回溯生成 diff
  const out: DiffOp[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ kind: "same", text: a[i - 1] })
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ kind: "remove", text: a[i - 1] })
      i--
    } else {
      out.push({ kind: "add", text: b[j - 1] })
      j--
    }
  }
  while (i > 0) {
    out.push({ kind: "remove", text: a[i - 1] })
    i--
  }
  while (j > 0) {
    out.push({ kind: "add", text: b[j - 1] })
    j--
  }
  return out.reverse()
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

// ─── 项目配置工具辅助（check_project_config / update_project_config） ───

const PROVIDER_MODEL_PATTERN = /^[\w.-]+\/[\w.-]+$/

/** opennovel.json 中允许 agent 读取/修改的字段（白名单） */
const OPENNOVEL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "model", label: "默认模型" },
  { key: "small_model", label: "小模型" },
  { key: "default_agent", label: "默认 agent" },
  { key: "username", label: "用户名" },
  { key: "share", label: "分享策略" },
  { key: "autoupdate", label: "自动更新" },
  { key: "logLevel", label: "日志级别" },
]

/** .novel/config.json 中允许 agent 读取/修改的字段 */
const NOVEL_CONFIG_FIELDS: Array<{ key: string; label: string }> = [
  { key: "name", label: "项目名称" },
  { key: "created_at", label: "创建时间" },
  { key: "version", label: "版本" },
  { key: "writing_mode", label: "写作模式" },
  { key: "setup_mode", label: "初始化模式" },
]

type FieldSpec = {
  parseJson: boolean
  validate: (value: unknown) => string | null
}

/** 校验函数：返回 null 表示通过，返回字符串表示错误原因 */
const OPENNOVEL_FIELD_SPECS: Record<string, FieldSpec> = {
  model: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && PROVIDER_MODEL_PATTERN.test(v)
        ? null
        : "必须是 'provider/model' 格式（如 anthropic/claude-sonnet-4-5）",
  },
  small_model: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && PROVIDER_MODEL_PATTERN.test(v)
        ? null
        : "必须是 'provider/model' 格式",
  },
  default_agent: {
    parseJson: false,
    validate: (v) => (typeof v === "string" && v.length > 0 ? null : "必须是非空字符串"),
  },
  username: {
    parseJson: false,
    validate: (v) => (typeof v === "string" ? null : "必须是字符串"),
  },
  share: {
    parseJson: true,
    validate: (v) =>
      v === "manual" || v === "auto" || v === "disabled" ? null : "必须是 manual / auto / disabled 之一",
  },
  autoupdate: {
    parseJson: true,
    validate: (v) =>
      typeof v === "boolean" || v === "notify" ? null : "必须是 true / false / \"notify\" 之一",
  },
  logLevel: {
    parseJson: true,
    validate: (v) =>
      v === "DEBUG" || v === "INFO" || v === "WARN" || v === "ERROR"
        ? null
        : "必须是 DEBUG / INFO / WARN / ERROR 之一",
  },
}

const NOVEL_CONFIG_FIELD_SPECS: Record<string, FieldSpec> = {
  name: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && v.length > 0 && v.length <= 100 ? null : "必须是 1-100 字符的字符串",
  },
  version: {
    parseJson: false,
    validate: (v) =>
      typeof v === "string" && /^\d+\.\d+\.\d+/.test(v) ? null : "必须是语义化版本字符串（如 1.0.0）",
  },
  writing_mode: {
    parseJson: true,
    validate: (v) => (v === "auto" || v === "review" ? null : "必须是 auto（自动）/ review（审核）之一"),
  },
  setup_mode: {
    parseJson: true,
    validate: (v) =>
      v === "interactive" || v === "auto" ? null : "必须是 interactive（确认）/ auto（自动）之一",
  },
}

type ProjectConfigSpec = {
  resolvePath: (projectDir: string) => string
  fields: Record<string, FieldSpec>
}

const PROJECT_CONFIG_SPECS: Record<string, ProjectConfigSpec> = {
  opennovel: {
    resolvePath: (projectDir) => {
      const found = findOpennovelConfig(projectDir)
      return found ?? join(projectDir, "opennovel.json")
    },
    fields: OPENNOVEL_FIELD_SPECS,
  },
  novel: {
    resolvePath: (projectDir) => join(projectDir, ".novel", "config.json"),
    fields: NOVEL_CONFIG_FIELD_SPECS,
  },
}

/**
 * 在项目根目录查找 opennovel 配置文件。优先 opennovel.jsonc（带注释），
 * 其次 opennovel.json。都不存在返回 undefined。
 *
 * 工具不读 .jsonc 注释（plugin 包不依赖 jsonc-parser），如果 .jsonc 含注释
 * 解析会失败，工具会报告并拒绝写入——让用户手工去掉注释或转纯 .json。
 */
function findOpennovelConfig(projectDir: string): string | undefined {
  const jsonc = join(projectDir, "opennovel.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = join(projectDir, "opennovel.json")
  if (existsSync(json)) return json
  return undefined
}

function formatConfigValue(value: unknown): string {
  if (value === undefined) return "（未设置）"
  if (value === null) return "null"
  if (typeof value === "string") return value.length > 80 ? value.slice(0, 80) + "…" : value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 读取项目配置（opennovel.json + .novel/config.json）白名单字段，组装展示文本。
 * 由 check_project_config 工具调用。文件不存在或 JSON 损坏时返回提示，不抛异常。
 */
export function readProjectConfig(projectDir: string): {
  title: string
  output: string
  metadata: {
    opennovel_path: string | undefined
    novel_config_path: string
    novel_config_exists: boolean
  }
} {
  const sections: string[] = []

  const opennovelPath = findOpennovelConfig(projectDir)
  if (opennovelPath) {
    try {
      const raw = readFileSync(opennovelPath, "utf-8")
      const data = JSON.parse(raw) as Record<string, unknown>
      sections.push(`## opennovel.json（${opennovelPath}）`)
      let shown = 0
      for (const field of OPENNOVEL_FIELDS) {
        if (field.key in data) {
          sections.push(`- ${field.label}：${formatConfigValue(data[field.key])}`)
          shown++
        }
      }
      if (shown === 0) sections.push("- （白名单字段均为空，使用默认值）")
    } catch (err) {
      sections.push(`## opennovel.json（解析失败）`)
      sections.push(
        `- ⚠ ${opennovelPath} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else {
    sections.push(`## opennovel.json（未找到）`)
    sections.push("- 项目根目录没有 opennovel.json / opennovel.jsonc")
  }

  const novelConfigPath = join(projectDir, ".novel", "config.json")
  sections.push("")
  if (existsSync(novelConfigPath)) {
    try {
      const raw = readFileSync(novelConfigPath, "utf-8")
      const data = JSON.parse(raw) as Record<string, unknown>
      sections.push(`## .novel/config.json（${novelConfigPath}）`)
      let shown = 0
      for (const field of NOVEL_CONFIG_FIELDS) {
        if (field.key in data) {
          sections.push(`- ${field.label}：${formatConfigValue(data[field.key])}`)
          shown++
        }
      }
      if (shown === 0) sections.push("- （白名单字段均为空）")
    } catch (err) {
      sections.push(`## .novel/config.json（解析失败）`)
      sections.push(
        `- ⚠ ${novelConfigPath} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else {
    sections.push(`## .novel/config.json（未找到）`)
    sections.push("- 项目未通过 initNovelProject 初始化")
  }

  return {
    title: "check_project_config",
    output: sections.join("\n"),
    metadata: {
      opennovel_path: opennovelPath,
      novel_config_path: novelConfigPath,
      novel_config_exists: existsSync(novelConfigPath),
    },
  }
}

/**
 * 更新项目配置白名单字段，写入前自动备份原文件。由 update_project_config 工具调用。
 * 拒绝写入白名单外的字段（防越权改 provider/mcp/permission 等敏感配置）。
 */
export function writeProjectConfig(
  projectDir: string,
  target: "opennovel" | "novel",
  field: string,
  rawValue: string,
): {
  title: string
  output: string
  metadata?: {
    target: string
    field: string
    old_value: unknown
    new_value: unknown
    file: string
    had_original: boolean
  }
} {
  const spec = PROJECT_CONFIG_SPECS[target]
  if (!spec) {
    return { title: "update_project_config", output: `不支持的 target：${target}` }
  }
  const fieldSpec = spec.fields[field]
  if (!fieldSpec) {
    const allowed = Object.keys(spec.fields).join("、")
    return {
      title: "update_project_config",
      output: `target=${target} 不支持字段 "${field}"。允许的字段：${allowed}`,
    }
  }

  let parsed: unknown
  if (fieldSpec.parseJson) {
    try {
      parsed = JSON.parse(rawValue)
    } catch {
      return {
        title: "update_project_config",
        output: `字段 ${field} 需要合法的 JSON 字面量：${rawValue}`,
      }
    }
  } else {
    parsed = rawValue
  }
  const validationError = fieldSpec.validate(parsed)
  if (validationError) {
    return { title: "update_project_config", output: `字段 ${field} 校验失败：${validationError}` }
  }

  const filePath = spec.resolvePath(projectDir)
  mkdirSync(dirname(filePath), { recursive: true })

  let data: Record<string, unknown> = {}
  let hadOriginal = false
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8")
      data = JSON.parse(raw) as Record<string, unknown>
      hadOriginal = true
    } catch (err) {
      return {
        title: "update_project_config",
        output: `${filePath} 不是合法 JSON，拒绝覆盖以防损坏：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  const oldValue = data[field]
  data[field] = parsed

  if (hadOriginal) {
    try {
      const backupPath = filePath + ".bak"
      // 备份走 fsync — 断电时不留半截 .bak
      const backupFd = openSync(backupPath, "w")
      try {
        writeSync(backupFd, readFileSync(filePath))
        fsyncSync(backupFd)
      } finally {
        closeSync(backupFd)
      }
    } catch (err) {
      return {
        title: "update_project_config",
        output: `备份原文件失败：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  try {
    // 主文件走 fsync — 断电时不留半截 JSON，避免 user 配的 model / writing_mode 静默丢失
    const fd = openSync(filePath, "w")
    try {
      writeSync(fd, JSON.stringify(data, null, 2) + "\n")
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    return {
      title: "update_project_config",
      output: `写入失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return {
    title: "update_project_config",
    output: [
      `已更新 ${target}.${field}`,
      `旧值：${formatConfigValue(oldValue)}`,
      `新值：${formatConfigValue(parsed)}`,
      `文件：${filePath}`,
      hadOriginal ? `备份：${filePath}.bak` : "（首次写入，无备份）",
    ].join("\n"),
    metadata: {
      target,
      field,
      old_value: oldValue,
      new_value: parsed,
      file: filePath,
      had_original: hadOriginal,
    },
  }
}
