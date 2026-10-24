/**
 * 记忆面板纯函数（memory-panel）：分页步进、状态标签、移交指令拼装。
 * 与组件分离便于单测（同 setting-review-inbox-data.ts 惯例）。
 */
import type { MemoryFactItem, MemoryFactStatus } from "@opennovel-ai/schema/novel"

/** 宽松翻译查找：动态 key 传给 t（同 setting-review-inbox-data.ts 惯例） */
export type Translate = (key: never, params?: Record<string, string | number>) => string

export const MEMORY_PAGE_SIZE = 20

export const MEMORY_STATUS_FILTERS = ["all", "pending", "reviewed", "approved", "stale", "retired"] as const

const STATUS_TAG_VARIANTS: Record<MemoryFactStatus, "warning" | "info" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  reviewed: "info",
  approved: "success",
  stale: "danger",
  retired: "neutral",
}

export function statusTagVariant(status: MemoryFactStatus) {
  return STATUS_TAG_VARIANTS[status]
}

export function statusLabel(status: MemoryFactStatus | "all", t: Translate): string {
  return status === "all"
    ? t("novel.settings.memory.filter.all" as never)
    : t(`novel.settings.memory.status.${status}` as never) || status
}

/** 卡片可批准的前置（server D6：仅 pending/reviewed 直达 approved） */
export function canApprove(item: MemoryFactItem): boolean {
  return item.status === "pending" || item.status === "reviewed"
}

/** retired 留痕只读；其余状态可编辑 text / entity_hint（server D8） */
export function canEdit(item: MemoryFactItem): boolean {
  return item.status !== "retired"
}

/** 仅带合并去向留痕的被并卡可撤销合并（server D5） */
export function canUnmerge(item: MemoryFactItem): boolean {
  return item.status === "retired" && item.retiredInto !== null
}

export function canRetire(item: MemoryFactItem): boolean {
  return item.status !== "retired"
}

/** 出处章展示：有章序显示「第 N 章」，无章（手记无锚点 / 章已删）显示无出处 */
export function chapterRefLabel(item: MemoryFactItem, t: Translate): string {
  return item.chapterOrder !== null
    ? t("novel.settings.memory.chapterRef" as never, { order: item.chapterOrder })
    : t("novel.settings.memory.noChapter" as never)
}

/** 「交给 AI 处理」指令：拼卡片证据 + 用户备注发绑定会话（同收件箱通道，要求用 librarian 工具核实/修正） */
export function buildHandoffPrompt(props: { novelID: string; item: MemoryFactItem; note: string }): string {
  const { novelID, item, note } = props
  const trimmed = note.trim()
  const lines = [
    `小说 ID：${novelID}`,
    "",
    "记忆面板有一张记忆卡需要你复核处理：",
    `- 记忆卡 ID：${item.id}`,
    `- 状态：${item.status}`,
    `- 事实类型：${item.factType}`,
    `- 事实陈述：${item.text}`,
    `- 引句：${item.quote ?? "无"}`,
    `- 出处章节 ID：${item.chapterId ?? "无"}`,
    `- 关联实体：${item.entityHint ?? "无"}`,
    `- 用户备注：${trimmed === "" ? "无" : trimmed}`,
    "",
    "请先用 memory_search / 正文检索核实该卡事实是否仍然成立，再选择合适方式处理：",
    "- 事实有误或已过时：说明判断依据，由作者在面板中修正或作废（不要旁路直接改记忆卡）。",
    "- 事实成立但陈述可改进：给出建议措辞，由作者确认后在面板中保存。",
    "处理完成后向用户汇报结论。禁止虚构 ID。",
  ]
  return lines.join("\n")
}
