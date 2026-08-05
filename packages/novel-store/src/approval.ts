/**
 * 人工审批门 — 章节生成后的人工审核关卡
 *
 * 提供 requestApproval / handleApproval 两个函数：
 * - requestApproval: 保存写手内容，返回章节详情供人工审核
 * - handleApproval: 根据审批结果路由到不同处理分支
 *
 * 遵循 chapter-tools.ts 的数据库访问模式。
 */
import { eq } from "drizzle-orm"
import { getDb, ChapterTable } from "./index.js"

// ─── 审批结果类型 ───

/** 审批结果：通过 / 驳回重写 / 人工编辑 */
export type ApprovalResult = "APPROVE" | "REJECT" | "EDIT"

// ─── 审批请求详情 ───

/** 审批请求返回的章节详情，供人工审核展示 */
export interface ApprovalRequest {
  chapterId: string
  novelId: string
  title: string
  content: string
  wordCount: number
  status: string
  order: number
}

// ─── 审批处理结果 ───

/** 审批处理结果，区分不同路由分支 */
export type ApprovalHandleResult =
  | { type: "APPROVED"; chapterId: string; title: string }
  | { type: "REJECTED"; chapterId: string; title: string; reason: string }
  | { type: "EDITING"; chapterId: string; title: string; content: string }

// ─── 公开 API ───

/**
 * 请求人工审批 — 保存写手提交的章节内容，返回章节详情供审核
 * @param chapterId 章节 ID
 * @param content 写手生成的章节内容
 * @returns 章节详情，供人工审核展示
 */
export async function requestApproval(
  chapterId: string,
  content: string,
  directory?: string | null,
): Promise<ApprovalRequest> {
  const db = getDb(directory)
  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) {
    throw new Error(`未找到章节 ${chapterId}`)
  }

  // 保存写手内容，标记为待审核状态
  await db
    .update(ChapterTable)
    .set({
      content,
      word_count: content.length,
      status: "pending_review",
      updated_at: Date.now(),
    })
    .where(eq(ChapterTable.id, chapterId))
    .run()

  return {
    chapterId: chapter.id,
    novelId: chapter.novel_id,
    title: chapter.title,
    content,
    wordCount: content.length,
    status: "pending_review",
    order: chapter.order,
  }
}

/**
 * 处理审批结果 — 根据人工决策路由到不同分支
 * @param chapterId 章节 ID
 * @param result 审批结果：APPROVE（通过）/ REJECT（驳回）/ EDIT（人工编辑）
 * @returns 处理结果，标明最终状态和路由信息
 */
export async function handleApproval(
  chapterId: string,
  result: ApprovalResult,
  directory?: string | null,
): Promise<ApprovalHandleResult> {
  const db = getDb(directory)
  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) {
    throw new Error(`未找到章节 ${chapterId}`)
  }

  switch (result) {
    case "APPROVE": {
      // 通过：标记章节为定稿
      await db
        .update(ChapterTable)
        .set({
          status: "final",
          updated_at: Date.now(),
        })
        .where(eq(ChapterTable.id, chapterId))
        .run()

      return {
        type: "APPROVED",
        chapterId: chapter.id,
        title: chapter.title,
      }
    }

    case "REJECT": {
      // 驳回：重置为草稿状态，发送回写手重写
      await db
        .update(ChapterTable)
        .set({
          status: "rejected",
          updated_at: Date.now(),
        })
        .where(eq(ChapterTable.id, chapterId))
        .run()

      return {
        type: "REJECTED",
        chapterId: chapter.id,
        title: chapter.title,
        reason: "驳回重写：章节内容未通过审核，请写手根据反馈重新撰写",
      }
    }

    case "EDIT": {
      // 人工编辑：返回当前内容，交由人工手动修改
      return {
        type: "EDITING",
        chapterId: chapter.id,
        title: chapter.title,
        content: chapter.content,
      }
    }
  }
}
