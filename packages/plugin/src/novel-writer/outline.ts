/**
 * 小说三级大纲系统
 *
 * 提供三级大纲生成功能：
 * - generateMasterOutline — 整体大纲（故事梗概、主线剧情、角色列表、世界观概要）
 * - generateVolumeOutline — 卷大纲（本卷主题、章节列表、关键事件）
 * - generateChapterOutline — 章节大纲（章节目标、关键场景、角色出场）
 *
 * 大纲内容同时写入 DB 记录（volumes / chapters 表）和 Markdown 文件（.novel/outlines/）。
 * 遵循 novel-writer.ts 的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, and } from "drizzle-orm"
import { join } from "path"
import { getDb, NovelTable, VolumeTable, ChapterTable } from "./session-store.js"
import { existsSync, mkdirSync, writeFileSync } from "fs"

// ─── 辅助函数 ───

/** 每卷默认章节数 */
const CHAPTERS_PER_VOLUME = 50

/** 确保 outlines 目录存在 */
function ensureOutlineDir(projectDir: string): string {
  const dir = join(projectDir, ".novel", "outlines")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 根据章节编号计算所属卷号 */
function chapterToVolumeNumber(chapterNumber: number): number {
  return Math.ceil(chapterNumber / CHAPTERS_PER_VOLUME)
}

/** 获取或创建卷记录 */
async function ensureVolume(
  db: ReturnType<typeof getDb>,
  novelId: string,
  novelTitle: string,
  volumeNumber: number,
): Promise<string> {
  const [existing] = await db
    .select()
    .from(VolumeTable)
    .where(and(eq(VolumeTable.novel_id, novelId), eq(VolumeTable.order, volumeNumber)))
    .all()
  if (existing) return existing.id

  const id = crypto.randomUUID()
  const startChapter = (volumeNumber - 1) * CHAPTERS_PER_VOLUME + 1
  const endChapter = volumeNumber * CHAPTERS_PER_VOLUME
  await db
    .insert(VolumeTable)
    .values({
      id,
      novel_id: novelId,
      title: `第${volumeNumber}卷`,
      summary: `《${novelTitle}》第${volumeNumber}卷（第${startChapter}章 - 第${endChapter}章）`,
      order: volumeNumber,
      created_at: Date.now(),
    })
    .run()
  return id
}

// ─── 导出函数 ───

/**
 * 生成整体大纲
 *
 * 从小说元数据生成 master-outline.md 模板，包含：
 * 故事梗概、主线剧情、角色列表、世界观概要。
 * 不写入 DB（整体大纲是小说层面的元信息，不新增表记录）。
 *
 * @param novelId 小说 ID
 * @param projectDir 小说项目目录（包含 .novel/ 的目录）
 * @returns 生成的大纲 Markdown 内容
 */
export async function generateMasterOutline(novelId: string, projectDir: string, content?: string): Promise<string> {
  const db = getDb(projectDir)
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) throw new Error(`小说不存在：${novelId}`)

  const finalContent = content ?? buildMasterOutlineTemplate(novel)
  const dir = ensureOutlineDir(projectDir)
  writeFileSync(join(dir, "master-outline.md"), finalContent)
  return finalContent
}

function buildMasterOutlineTemplate(novel: { title: string; genre: string; status: string; synopsis: string }): string {
  const lines: string[] = []

  lines.push(`# 《${novel.title}》整体大纲`)
  lines.push("")
  lines.push(`> 题材：${novel.genre}`)
  lines.push(`> 状态：${novel.status === "draft" ? "草稿" : novel.status}`)
  lines.push(`> 生成时间：${new Date().toISOString()}`)
  lines.push("")

  // 故事梗概
  lines.push("## 故事梗概")
  lines.push("")
  if (novel.synopsis) {
    lines.push(novel.synopsis)
  } else {
    lines.push("> （请在此填写故事梗概）")
  }
  lines.push("")

  // 主线剧情
  lines.push("## 主线剧情")
  lines.push("")
  lines.push("### 第一幕：开端")
  lines.push("")
  lines.push("> （请描述故事的开端，主角的初始状态和世界观引入）")
  lines.push("")
  lines.push("### 第二幕：发展")
  lines.push("")
  lines.push("> （请描述主角的成长历程、主要冲突和转折点）")
  lines.push("")
  lines.push("### 第三幕：高潮")
  lines.push("")
  lines.push("> （请描述故事的高潮部分，核心冲突的爆发和解决）")
  lines.push("")
  lines.push("### 第四幕：结局")
  lines.push("")
  lines.push("> （请描述故事的结局，主角的最终归宿和世界观收束）")
  lines.push("")

  // 角色列表
  lines.push("## 角色列表")
  lines.push("")
  lines.push("### 主角")
  lines.push("")
  lines.push("| 角色名 | 身份 | 性格 | 成长弧 |")
  lines.push("|--------|------|------|--------|")
  lines.push("| （待填写） | （待填写） | （待填写） | （待填写） |")
  lines.push("")
  lines.push("### 重要配角")
  lines.push("")
  lines.push("| 角色名 | 身份 | 与主角关系 | 作用 |")
  lines.push("|--------|------|------------|------|")
  lines.push("| （待填写） | （待填写） | （待填写） | （待填写） |")
  lines.push("")
  lines.push("### 反派")
  lines.push("")
  lines.push("| 角色名 | 身份 | 动机 | 结局 |")
  lines.push("|--------|------|------|------|")
  lines.push("| （待填写） | （待填写） | （待填写） | （待填写） |")
  lines.push("")

  // 世界观概要
  lines.push("## 世界观概要")
  lines.push("")
  lines.push("### 世界背景")
  lines.push("")
  lines.push("> （请描述故事发生的世界背景，包括时代、地域、社会结构等）")
  lines.push("")
  lines.push("### 力量体系")
  lines.push("")
  lines.push("> （请描述本作的力量体系 / 修炼体系 / 等级设定）")
  lines.push("")
  lines.push("### 重要设定")
  lines.push("")
  lines.push("> （请列出世界观中的重要设定，如特殊规则、种族、组织等）")
  lines.push("")

  return lines.join("\n")
}

/**
 * 生成卷大纲
 *
 * 创建 volumes 表记录，并生成 volume-{n}.md 模板，包含：
 * 本卷主题、章节列表、关键事件。
 *
 * @param novelId 小说 ID
 * @param volumeNumber 卷号（从 1 开始）
 * @param projectDir 小说项目目录（包含 .novel/ 的目录）
 * @returns 生成的卷大纲 Markdown 内容
 */
export async function generateVolumeOutline(
  novelId: string,
  volumeNumber: number,
  projectDir: string,
  content?: string,
  title?: string,
): Promise<string> {
  const db = getDb(projectDir)
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) throw new Error(`小说不存在：${novelId}`)

  const volumeId = await ensureVolume(db, novelId, novel.title, volumeNumber)
  const volumeTitle = title ?? `第${volumeNumber}卷`

  if (title) {
    await db.update(VolumeTable).set({ title: volumeTitle }).where(eq(VolumeTable.id, volumeId)).run()
  }

  const startChapter = (volumeNumber - 1) * CHAPTERS_PER_VOLUME + 1
  const endChapter = volumeNumber * CHAPTERS_PER_VOLUME

  const lines: string[] = []

  lines.push(`# 《${novel.title}》${volumeTitle} 大纲`)
  lines.push("")
  lines.push(`> 卷 ID：${volumeId}`)
  lines.push(`> 章节范围：第${startChapter}章 - 第${endChapter}章`)
  lines.push(`> 生成时间：${new Date().toISOString()}`)
  lines.push("")

  // 本卷主题
  lines.push("## 本卷主题")
  lines.push("")
  lines.push("> （请描述本卷的核心主题和叙事目标）")
  lines.push("")
  lines.push("### 主题句")
  lines.push("")
  lines.push("> （用一句话概括本卷的主题）")
  lines.push("")
  lines.push("### 情感基调")
  lines.push("")
  lines.push("> （请描述本卷的整体情感基调，如热血、悬疑、温情等）")
  lines.push("")

  // 章节列表
  lines.push("## 章节列表")
  lines.push("")
  lines.push("| 章节 | 标题 | 核心事件 | 字数目标 |")
  lines.push("|------|------|----------|----------|")
  for (let i = startChapter; i <= endChapter; i++) {
    lines.push(`| 第${i}章 | （待填写） | （待填写） | （待填写） |`)
  }
  lines.push("")

  // 关键事件
  lines.push("## 关键事件")
  lines.push("")
  lines.push("### 本卷必写事件")
  lines.push("")
  lines.push("> （请列出本卷必须发生的关键事件，确保剧情推进）")
  lines.push("")
  lines.push("1. （待填写）")
  lines.push("2. （待填写）")
  lines.push("3. （待填写）")
  lines.push("")
  lines.push("### 本卷伏笔")
  lines.push("")
  lines.push("> （请列出本卷需要埋设的伏笔及预期回收章节）")
  lines.push("")
  lines.push("| 伏笔内容 | 埋设章节 | 预期回收卷/章 |")
  lines.push("|----------|----------|---------------|")
  lines.push("| （待填写） | （待填写） | （待填写） |")
  lines.push("")
  lines.push("### 本卷角色弧光")
  lines.push("")
  lines.push("> （请描述本卷中主要角色的成长变化）")
  lines.push("")
  lines.push("| 角色 | 起点状态 | 终点状态 | 关键转折 |")
  lines.push("|------|----------|----------|----------|")
  lines.push("| （主角） | （待填写） | （待填写） | （待填写） |")
  lines.push("")

  const finalContent = content ?? lines.join("\n")
  const dir = ensureOutlineDir(projectDir)
  writeFileSync(join(dir, `volume-${volumeNumber}.md`), finalContent)
  return finalContent
}

/**
 * 生成章节大纲
 *
 * 创建 chapters 表记录（如不存在），并生成 chapter-{n}.md 模板，包含：
 * 章节目标、关键场景、角色出场。
 * 自动创建所属卷记录（如不存在）。
 *
 * @param novelId 小说 ID
 * @param chapterNumber 章节编号（从 1 开始）
 * @param projectDir 小说项目目录（包含 .novel/ 的目录）
 * @returns 生成的章节大纲 Markdown 内容
 */
export async function generateChapterOutline(
  novelId: string,
  chapterNumber: number,
  projectDir: string,
  content?: string,
  title?: string,
): Promise<string> {
  const db = getDb(projectDir)
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) throw new Error(`小说不存在：${novelId}`)

  const volumeNumber = chapterToVolumeNumber(chapterNumber)
  const volumeId = await ensureVolume(db, novelId, novel.title, volumeNumber)

  const chapterTitle = title ?? `第${chapterNumber}章`

  const [existingChapter] = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterNumber)))
    .all()

  let chapterId: string
  if (existingChapter) {
    chapterId = existingChapter.id
    if (title && title !== existingChapter.title) {
      await db
        .update(ChapterTable)
        .set({ title: chapterTitle, volume_id: volumeId, status: "outline", updated_at: Date.now() })
        .where(eq(ChapterTable.id, chapterId))
        .run()
    }
  } else {
    chapterId = crypto.randomUUID()
    const now = Date.now()
    await db
      .insert(ChapterTable)
      .values({
        id: chapterId,
        novel_id: novelId,
        volume_id: volumeId,
        title: chapterTitle,
        content: "",
        word_count: 0,
        status: "outline",
        order: chapterNumber,
        created_at: now,
        updated_at: now,
      })
      .run()
  }

  const lines: string[] = []

  lines.push(`# 《${novel.title}》${chapterTitle} 大纲`)
  lines.push("")
  lines.push(`> 章节 ID：${chapterId}`)
  lines.push(`> 所属卷：第${volumeNumber}卷`)
  lines.push(`> 生成时间：${new Date().toISOString()}`)
  lines.push("")

  // 章节目标
  lines.push("## 章节目标")
  lines.push("")
  lines.push("### 剧情目标")
  lines.push("")
  lines.push("> （请描述本章需要完成的剧情推进目标）")
  lines.push("")
  lines.push("### 情感目标")
  lines.push("")
  lines.push("> （请描述本章希望带给读者的情感体验）")
  lines.push("")
  lines.push("### 信息目标")
  lines.push("")
  lines.push("> （请列出本章需要向读者传递的关键信息，如世界观揭示、伏笔暗示等）")
  lines.push("")

  // 关键场景
  lines.push("## 关键场景")
  lines.push("")
  lines.push("### 场景一：开场")
  lines.push("")
  lines.push("- **地点**：（待填写）")
  lines.push("- **时间**：（待填写）")
  lines.push("- **出场角色**：（待填写）")
  lines.push("- **场景概要**：（待填写）")
  lines.push("- **字数预估**：（待填写）")
  lines.push("")
  lines.push("### 场景二：发展")
  lines.push("")
  lines.push("- **地点**：（待填写）")
  lines.push("- **时间**：（待填写）")
  lines.push("- **出场角色**：（待填写）")
  lines.push("- **场景概要**：（待填写）")
  lines.push("- **字数预估**：（待填写）")
  lines.push("")
  lines.push("### 场景三：高潮 / 转折")
  lines.push("")
  lines.push("- **地点**：（待填写）")
  lines.push("- **时间**：（待填写）")
  lines.push("- **出场角色**：（待填写）")
  lines.push("- **场景概要**：（待填写）")
  lines.push("- **字数预估**：（待填写）")
  lines.push("")
  lines.push("### 场景四：收尾")
  lines.push("")
  lines.push("- **地点**：（待填写）")
  lines.push("- **时间**：（待填写）")
  lines.push("- **出场角色**：（待填写）")
  lines.push("- **场景概要**：（待填写）")
  lines.push("- **字数预估**：（待填写）")
  lines.push("")

  // 角色出场
  lines.push("## 角色出场")
  lines.push("")
  lines.push("| 角色 | 出场场景 | 作用 | 状态变化 |")
  lines.push("|------|----------|------|----------|")
  lines.push("| （主角） | （待填写） | （待填写） | （待填写） |")
  lines.push("| （待填写） | （待填写） | （待填写） | （待填写） |")
  lines.push("")
  lines.push("### 角色对话要点")
  lines.push("")
  lines.push("> （请列出本章关键对话的核心内容）")
  lines.push("")
  lines.push("1. （待填写）")
  lines.push("2. （待填写）")
  lines.push("")

  // 打脸设计（如适用）
  lines.push("## 打脸设计（如适用）")
  lines.push("")
  lines.push("> 4 拍结构：轻视 → 冲突 → 反转 → 打脸")
  lines.push("")
  lines.push("1. **轻视**：（待填写）")
  lines.push("2. **冲突**：（待填写）")
  lines.push("3. **反转**：（待填写）")
  lines.push("4. **打脸**：（待填写）")
  lines.push("")

  const finalContent = content ?? lines.join("\n")
  const dir = ensureOutlineDir(projectDir)
  writeFileSync(join(dir, `chapter-${chapterNumber}.md`), finalContent)
  return finalContent
}
