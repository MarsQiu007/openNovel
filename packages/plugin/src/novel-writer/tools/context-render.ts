/**
 * 系统上下文注入的纯渲染函数。
 *
 * 从 novel-writer.ts 的 inject* 函数拆出（DB 组装 + 文本渲染），V1 hook 与
 * V2 SystemContext 源（context-source.ts）共用同一份实现，保证窗口期双入口
 * 注入文本一致。
 */
import { desc, eq } from "drizzle-orm"
import { instructionLines, styleGuideRuleLines } from "../context.js"
import { assembleWriterSnapshot } from "../recall.js"
import { ChapterTable, getDb, readNovelConfig, type SetupMode, type WritingMode } from "../session-store.js"
import { formatActiveArcs, projectDirFromCtx } from "./shared.js"

type WriterSnapshot = NonNullable<Awaited<ReturnType<typeof assembleWriterSnapshot>>>

/**
 * 渲染写作模式契约段（项目级，与小说是否绑定无关）。
 *
 * 从 .novel/config.json 读取 writing_mode / setup_mode，渲染成中文行为规则。
 * 错误策略：项目目录解析失败返回 undefined（V1 跳过注入）；配置损坏按默认
 * auto/auto 渲染，永不抛错。
 */
export function renderModeSection(directory: string | null | undefined): string | undefined {
  // projectDirFromCtx 会基于 directory 反推项目根；directory 为 null/undefined 时返回 process.cwd()
  let projectDir: string
  try {
    projectDir = projectDirFromCtx(directory)
  } catch {
    return undefined
  }

  let mode: { writing_mode: WritingMode; setup_mode: SetupMode }
  try {
    mode = readNovelConfig(projectDir)
  } catch {
    // 文件损坏等异常情况按默认配置走
    mode = { writing_mode: "auto", setup_mode: "auto" }
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
  return lines.join("\n")
}

/** 灵魂段渲染（全局灵魂对所有会话生效；小说灵魂仅在解析到 novelId 时参与合并）。 */
export function renderSoulSection(soul: string): string {
  return `【灵魂】\n${soul}`
}

/**
 * 组装小说上下文快照（蓝图/角色/线索/伏笔/弧光/风格/世界观/题材规则）。
 * 快照不可用时返回 undefined（未绑定或未初始化）。
 */
export async function loadNovelSnapshot(novelId: string, directory: string | null | undefined) {
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

  return assembleWriterSnapshot(novelId, chapterNumber, directory)
}

/** 将上下文快照序列化为【小说写作上下文快照】注入段。 */
export function renderSnapshotSection(snapshot: WriterSnapshot): string {
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

  lines.push(...formatActiveArcs(snapshot.activeArcs))

  if (snapshot.styleGuide) {
    lines.push("【风格指南】")
    if (snapshot.styleGuide.tone) lines.push(`基调：${snapshot.styleGuide.tone}`)
    if (snapshot.styleGuide.pov) lines.push(`视角：${snapshot.styleGuide.pov}`)
    if (snapshot.styleGuide.tense) lines.push(`时态：${snapshot.styleGuide.tense}`)
    lines.push(...styleGuideRuleLines(snapshot.styleGuide, snapshot.styleGuideTruncated))
    lines.push("")
  }

  if (snapshot.instructions.length > 0 || snapshot.instructionsTruncated) {
    lines.push("【写作规范】（分层：全书 → 卷 → 章，近者优先）")
    lines.push(...instructionLines(snapshot.instructions, snapshot.instructionsTruncated))
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

  return lines.join("\n")
}
