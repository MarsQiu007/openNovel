/**
 * 输入治理模块 — 生成作者意图和当前焦点文档
 *
 * 提供两个函数：
 * - generateAuthorIntent(novelId) — 从小说元数据生成 author_intent.md 内容
 * - generateCurrentFocus(chapterId) — 从当前章节状态生成 current_focus.md 内容
 *
 * 遵循 novel-writer.ts 中的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, and, inArray } from "drizzle-orm"
import {
  getDb,
  NovelTable,
  ChapterTable,
  CharacterTable,
  CharacterStateTable,
  PlotThreadTable,
  ForeshadowingTable,
  ChapterSummaryTable,
} from "./session-store.js"

// ─── 导出函数 ───

/**
 * 从小说元数据生成 author_intent.md 内容
 *
 * 包含：题材、书名、故事梗概、核心冲突、主角设定、金手指
 *
 * @param novelId 小说 ID
 * @returns Markdown 格式的作者意图内容字符串，小说不存在时返回空字符串
 */
export async function generateAuthorIntent(novelId: string, directory?: string | null): Promise<string> {
  const db = getDb(directory)

  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) return ""

  const characters = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()

  const plotThreads = await db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all()

  const openThreads = plotThreads.filter((t) => t.status === "open")
  const mainThreads = openThreads.length > 0 ? openThreads : plotThreads

  const mainCharacters = characters.filter((c) => c.role === "主角" || c.role === " protagonist")
  const supportingCharacters = characters.filter((c) => c.role !== "主角" && c.role !== "protagonist")

  const lines: string[] = []

  lines.push("# 作者意图")
  lines.push("")
  lines.push(`> 生成时间：${new Date().toISOString()}`)
  lines.push(
    `> 小说状态：${novel.status === "draft" ? "草稿" : novel.status === "published" ? "已发布" : novel.status}`,
  )
  lines.push("")

  // 题材
  lines.push("## 题材")
  lines.push("")
  lines.push(novel.genre || "（未设定）")
  lines.push("")

  // 书名
  lines.push("## 书名")
  lines.push("")
  lines.push(novel.title || "（未命名）")
  lines.push("")

  // 故事梗概
  lines.push("## 故事梗概")
  lines.push("")
  if (novel.synopsis) {
    lines.push(novel.synopsis)
  } else {
    lines.push("（尚未撰写梗概）")
  }
  lines.push("")

  // 核心冲突
  lines.push("## 核心冲突")
  lines.push("")
  if (mainThreads.length > 0) {
    const openCount = openThreads.length
    lines.push(`> 共 ${plotThreads.length} 条剧情线索，其中 ${openCount} 条未关闭`)
    lines.push("")
    for (const thread of mainThreads) {
      const statusLabel =
        thread.status === "open" ? "🔴 进行中" : thread.status === "resolved" ? "✅ 已解决" : "⏸️ 暂停"
      lines.push(`### ${thread.title}`)
      lines.push(`- 状态：${statusLabel}`)
      lines.push(`- 优先级：${thread.priority === "high" ? "高" : thread.priority === "low" ? "低" : "中"}`)
      if (thread.description) {
        lines.push(`- 描述：${thread.description}`)
      }
      lines.push("")
    }
  } else {
    lines.push("（尚未设定剧情线索）")
    lines.push("")
  }

  // 主角设定
  lines.push("## 主角设定")
  lines.push("")
  if (mainCharacters.length > 0) {
    for (const char of mainCharacters) {
      lines.push(`### ${char.name}`)
      if (char.role) lines.push(`- 角色定位：${char.role}`)
      if (char.description) lines.push(`- 描述：${char.description}`)
      lines.push("")
    }
  }
  if (supportingCharacters.length > 0) {
    lines.push("### 其他角色")
    for (const char of supportingCharacters) {
      const roleInfo = char.role ? `（${char.role}）` : ""
      const descInfo = char.description ? `：${char.description}` : ""
      lines.push(`- ${char.name}${roleInfo}${descInfo}`)
    }
    lines.push("")
  }
  if (characters.length === 0) {
    lines.push("（尚未设定角色）")
    lines.push("")
  }

  // 金手指
  lines.push("## 金手指")
  lines.push("")
  if (novel.synopsis) {
    // 从梗概中提取可能包含金手指的段落
    lines.push("> 以下内容从故事梗概中提取，可能包含金手指设定：")
    lines.push("")
    lines.push(novel.synopsis)
  } else {
    lines.push("（尚未设定金手指，需在写作过程中补充）")
  }
  lines.push("")

  return lines.join("\n")
}

/**
 * 从当前章节状态生成 current_focus.md 内容
 *
 * 包含：当前章节目标、活跃角色、待解决伏笔、剧情张力
 *
 * @param chapterId 章节 ID
 * @returns Markdown 格式的当前焦点内容字符串，章节不存在时返回空字符串
 */
export async function generateCurrentFocus(chapterId: string, directory?: string | null): Promise<string> {
  const db = getDb(directory)

  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()
  if (!chapter) return ""

  const [summary] = await db
    .select()
    .from(ChapterSummaryTable)
    .where(eq(ChapterSummaryTable.chapter_id, chapterId))
    .all()

  // 活跃角色：查询该章节的角色状态
  const activeStates = await db
    .select()
    .from(CharacterStateTable)
    .where(and(eq(CharacterStateTable.chapter_id, chapterId), eq(CharacterStateTable.active, 1)))
    .all()

  let activeCharacters: Array<{ name: string; role: string; location: string; mood: string; summary: string }> = []
  if (activeStates.length > 0) {
    const charIds = activeStates.map((s) => s.character_id)
    const chars = await db.select().from(CharacterTable).where(inArray(CharacterTable.id, charIds)).all()
    const charMap = new Map(chars.map((c) => [c.id, c]))
    activeCharacters = activeStates.map((s) => {
      const char = charMap.get(s.character_id)
      return {
        name: char?.name ?? "（未知角色）",
        role: char?.role ?? "",
        location: s.location,
        mood: s.mood,
        summary: s.summary,
      }
    })
  }

  // 待解决伏笔：该小说中状态为 planted 的伏笔
  const foreshadowing = await db
    .select()
    .from(ForeshadowingTable)
    .where(and(eq(ForeshadowingTable.novel_id, chapter.novel_id), eq(ForeshadowingTable.state, "planted")))
    .all()

  // 剧情张力：未关闭的剧情线索
  const plotThreads = await db
    .select()
    .from(PlotThreadTable)
    .where(and(eq(PlotThreadTable.novel_id, chapter.novel_id), eq(PlotThreadTable.status, "open")))
    .all()

  const lines: string[] = []

  lines.push("# 当前焦点")
  lines.push("")
  lines.push(`> 生成时间：${new Date().toISOString()}`)
  lines.push(`> 章节：第 ${chapter.order} 章 · ${chapter.title}`)
  lines.push(
    `> 章节状态：${chapter.status === "draft" ? "草稿" : chapter.status === "published" ? "已发布" : chapter.status}`,
  )
  lines.push(`> 字数：${chapter.word_count}`)
  lines.push("")

  // 当前章节目标
  lines.push("## 当前章节目标")
  lines.push("")
  if (summary?.summary) {
    lines.push(summary.summary)
  } else {
    lines.push(`撰写第 ${chapter.order} 章「${chapter.title}」的内容`)
  }
  lines.push("")
  if (summary?.key_events && Array.isArray(summary.key_events) && summary.key_events.length > 0) {
    lines.push("### 关键事件")
    for (const event of summary.key_events) {
      lines.push(`- ${String(event)}`)
    }
    lines.push("")
  }

  // 活跃角色
  lines.push("## 活跃角色")
  lines.push("")
  if (activeCharacters.length > 0) {
    for (const ac of activeCharacters) {
      const parts: string[] = [`- **${ac.name}**`]
      if (ac.role) parts.push(`（${ac.role}）`)
      if (ac.location) parts.push(`位置：${ac.location}`)
      if (ac.mood) parts.push(`情绪：${ac.mood}`)
      if (ac.summary) parts.push(`状态：${ac.summary}`)
      lines.push(parts.join(" "))
    }
    lines.push("")
  } else {
    lines.push("（当前章节无活跃角色记录）")
    lines.push("")
  }

  // 待解决伏笔
  lines.push("## 待解决伏笔")
  lines.push("")
  if (foreshadowing.length > 0) {
    lines.push(`> 共 ${foreshadowing.length} 条待回收伏笔`)
    lines.push("")
    for (const f of foreshadowing) {
      const plantedInfo = f.planted_chapter_id ? `（埋设章节：${f.planted_chapter_id}）` : ""
      lines.push(`- ${f.content} ${plantedInfo}`)
    }
    lines.push("")
  } else {
    lines.push("（当前无待回收伏笔）")
    lines.push("")
  }

  // 剧情张力
  lines.push("## 剧情张力")
  lines.push("")
  if (plotThreads.length > 0) {
    lines.push(`> 共 ${plotThreads.length} 条进行中的剧情线索`)
    lines.push("")
    for (const thread of plotThreads) {
      const priorityLabel = thread.priority === "high" ? "高" : thread.priority === "low" ? "低" : "中"
      lines.push(`### ${thread.title}`)
      lines.push(`- 优先级：${priorityLabel}`)
      if (thread.description) {
        lines.push(`- 描述：${thread.description}`)
      }
      lines.push("")
    }
  } else {
    lines.push("（当前无进行中的剧情线索）")
    lines.push("")
  }

  return lines.join("\n")
}
