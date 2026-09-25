import { and, eq } from "drizzle-orm"
import { ChapterTable, getDb, WorldEntryTable } from "@opennovel-ai/novel-store"

/**
 * 批注目标注册表：服务端权威，登记可批注的（目标类型, 字段）组合。
 * targetType / field 词汇与手动编辑目录的实体/字段词汇一致；
 * 新增批注面 = 注册表加一项 + UI 接入，不加表不加端点。
 */
export interface AnnotationTargetField {
  // 锚点校验错误消息中的作用域标签（章节/设定）
  scopeLabel: string
  // 与对应阅读器一致的分段规则
  splitParagraphs: (content: string) => string[]
  // 解析目标文本；目标不存在或不属于当前 novel 时返回 null
  loadContent: (novelId: string, targetId: string, directory: string) => string | null
}

export const AnnotationTargets: Record<string, Record<string, AnnotationTargetField>> = {
  chapter: {
    content: {
      scopeLabel: "章节",
      // 与 chapter-reader 的分段规则保持一致
      splitParagraphs: (content) => content.split(/\n\n+/).filter(Boolean),
      loadContent: (novelId, targetId, directory) => {
        const db = getDb(directory)
        const chapter = db
          .select()
          .from(ChapterTable)
          .where(and(eq(ChapterTable.id, targetId), eq(ChapterTable.novel_id, novelId)))
          .get()
        return chapter?.content ?? null
      },
    },
  },
  world_entry: {
    content: {
      scopeLabel: "设定",
      // 与 world-reader 的分段规则保持一致
      splitParagraphs: (content) =>
        content
          .split(/\n+/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean),
      loadContent: (novelId, targetId, directory) => {
        const db = getDb(directory)
        const entry = db
          .select()
          .from(WorldEntryTable)
          .where(and(eq(WorldEntryTable.id, targetId), eq(WorldEntryTable.novel_id, novelId)))
          .get()
        return entry?.content ?? null
      },
    },
  },
}

export function resolveAnnotationTarget(targetType: string, field: string) {
  return AnnotationTargets[targetType]?.[field]
}

// 执行轮次不区分字段：用该目标类型下任一已注册字段的解析器做存在性校验
export function resolveAnnotationTargetType(targetType: string) {
  const byField = AnnotationTargets[targetType]
  return byField ? Object.values(byField)[0] : undefined
}
