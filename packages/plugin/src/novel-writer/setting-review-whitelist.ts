/**
 * 分级自动化白名单（setting-review-hub design D3）——单一事实源。
 *
 * 白名单内的 organize 计划操作可免收件箱确认直接执行（落库 + description_history 留痕）；
 * 其余操作（合并、删除、语义改写、标题变更、跨实体变更）必须暂存进收件箱等待用户确认。
 * 边界只认确定性证据：纯格式修复要求去除空白与 Markdown 标记后文本等价（不增删事实），
 * 分类归一要求「非标准分类 → 标准分类」。
 */

import type { OrganizeEntity, OrganizeOperation, OrganizeUpdateOperation } from "./setting-reorganization.js"
import { validateWorldCategory } from "./world-category.js"

export type AutoExecutionClass = "format" | "category"

/** 各实体类型的纯文本字段（与 generatePlanFromIssues 的格式修复落点一致） */
const TEXT_FIELD: Record<OrganizeEntity["entity_type"], "content" | "description"> = {
  world_entry: "content",
  foreshadowing: "content",
  character: "description",
  plot_thread: "description",
  relationship: "description",
}

/** 去除 Markdown 标记与全部空白，用于「不增删事实」的等价比较 */
function stripFormatting(text: string): string {
  return text
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1") // 链接保留文本
    .replace(/[#*`>~_]+/g, "") // 标题 / 加粗 / 斜体 / 引用 / 代码标记
    .replace(/^[ \t]{0,3}(?:-|\+|\d+\.)[ \t]+/gm, "") // 列表标记
    .replace(/\s+/g, "") // 空白与分段差异
}

/** 纯格式修复：update + 仅改本类型的纯文本字段 + 变更不增删事实 */
export function isFormatOnlyUpdate(operation: OrganizeUpdateOperation, before: OrganizeEntity): boolean {
  if (operation.entity_type !== before.entity_type) return false
  const field = TEXT_FIELD[operation.entity_type]
  const keys = Object.keys(operation.fields)
  if (keys.length !== 1 || keys[0] !== field) return false
  const after = operation.fields[field]
  if (typeof after !== "string") return false
  return stripFormatting(after) === stripFormatting(before[field])
}

/** 分类归一：world_entry update + 仅改 category + 非标准分类归一到标准分类 */
export function isCategoryNormalizeUpdate(operation: OrganizeUpdateOperation, before: OrganizeEntity): boolean {
  if (operation.entity_type !== "world_entry" || before.entity_type !== "world_entry") return false
  const keys = Object.keys(operation.fields)
  if (keys.length !== 1 || keys[0] !== "category") return false
  const after = operation.fields.category
  if (typeof after !== "string") return false
  return validateWorldCategory(before.category) !== null && validateWorldCategory(after) === null
}

/** 白名单判定：返回级别则可自动执行，null 表示必须进收件箱待审 */
export function classifyAutoExecution(
  operation: OrganizeOperation,
  before: OrganizeEntity,
): AutoExecutionClass | null {
  if (operation.action !== "update") return null
  if (isCategoryNormalizeUpdate(operation, before)) return "category"
  if (isFormatOnlyUpdate(operation, before)) return "format"
  return null
}
