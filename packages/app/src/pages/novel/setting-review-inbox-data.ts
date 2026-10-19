/**
 * 设定收件箱 — 纯逻辑辅助函数（从组件抽出便于单测）。
 *
 * 覆盖：来源分组、徽标计数、操作错误逐条格式化、旧值/新值对照、
 * 来源/类型标签、审阅备注「交给 AI 处理」指令拼装、AI 一键整理批处理指令、
 * 编辑后接受 JSON 解析与批量合并选择校验。
 */
import type { ReviewInboxCounts, ReviewInboxItem } from "@opennovel-ai/schema/novel"

/** 收件箱三个来源的固定展示顺序 */
export const REVIEW_INBOX_SOURCE_ORDER = ["candidate", "conflict", "staged"] as const
export type ReviewInboxSourceKey = (typeof REVIEW_INBOX_SOURCE_ORDER)[number]

/** 收件箱每页条数（加载更多按此步进） */
export const REVIEW_INBOX_PAGE_SIZE = 20

/** 徽标显示待审总数；调用方以 > 0 决定是否渲染徽标（清零不显示） */
export function badgeDisplayCount(counts: Pick<ReviewInboxCounts, "total">): number {
  return Math.max(0, counts.total)
}

/** 按来源分组并保持 candidate → conflict → staged 顺序，空来源不出现 */
export function groupInboxItems(
  items: readonly ReviewInboxItem[],
): { source: ReviewInboxSourceKey; items: ReviewInboxItem[] }[] {
  return REVIEW_INBOX_SOURCE_ORDER.flatMap((source) => {
    const group = items.filter((item) => item.source === source)
    return group.length > 0 ? [{ source, items: group }] : []
  })
}

/** 操作失败时的逐条错误行：errors / formatErrors 逐条在前，兜底 error 最后，全部缺失返回空数组 */
export function formatOperationErrors(result: {
  error?: string
  errors?: readonly string[]
  formatErrors?: readonly string[]
}): string[] {
  const lines = [...(result.errors ?? []), ...(result.formatErrors ?? [])]
  if (result.error) lines.push(result.error)
  return lines.filter((line) => line.trim() !== "")
}

/** 展示用 JSON 文本：空串原样返回；可解析的对象/数组美化缩进，其余原样 */
export function prettyJson(raw: string): string {
  if (raw.trim() === "") return ""
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === "object") return JSON.stringify(parsed, null, 2)
    return String(parsed)
  } catch {
    return raw
  }
}

/**
 * 旧值/新值对照：两边都为空（如冲突未生成草案）返回 null 表示无对照区；
 * 候选旧值为空串由组件渲染「新增」占位。
 */
export function formatComparison(
  item: Pick<ReviewInboxItem, "before" | "after">,
): { beforeText: string; afterText: string } | null {
  const beforeText = prettyJson(item.before)
  const afterText = prettyJson(item.after)
  if (beforeText === "" && afterText === "") return null
  return { beforeText, afterText }
}

/** 宽松翻译查找：动态 key 传给 t（key 缺失时运行时返回 undefined） */
export type Translate = (key: never) => string

/** 类型标签 key 缺失时回退原始 kind 值 */
export function kindLabel(source: string, kind: string, t: Translate): string {
  return t(`novel.settings.inbox.kind.${source}.${kind}` as never) || kind
}

/** 来源标签；未知来源回退原始值 */
export function sourceLabel(source: string, t: Translate): string {
  return t(`novel.settings.inbox.source.${source}` as never) || source
}

/** 条目审阅备注「交给 AI 处理」：把条目证据与备注拼成发给绑定会话的指令 */
export function buildHandoffPrompt(props: { novelID: string; item: ReviewInboxItem; note: string }): string {
  const { novelID, item, note } = props
  const trimmed = note.trim()
  const lines = [
    `小说 ID：${novelID}`,
    "",
    "设定收件箱有一条待审条目需要你复核处理：",
    `- 来源：${item.source}（kind：${item.kind}）`,
    `- 标题：${item.title}`,
    `- 目标条目 ID：${item.targetId ?? "无"}`,
    `- 摘要：${item.summary}`,
    `- 证据：${item.evidence}`,
  ]
  if (item.sourceChapterId) lines.push(`- 来源章节 ID：${item.sourceChapterId}`)
  lines.push(
    `- 用户备注：${trimmed === "" ? "无" : trimmed}`,
    "",
    "请先核实相关条目现状，再选择合适工具处理：",
    "- 候选类：用 merge_pending_settings 合并；若证据表明不应收录，说明理由即可（收件箱内可直接拒绝）。",
    "- 冲突类：用 resolve_conflict 生成草案或保留现状，并说明判断依据。",
    '- 暂存草案类：接受/拒绝需在收件箱操作；若备注要求修改草案内容，用 organize_settings(action="stage") 产出修正后的新草案替代。',
    "处理完成后向用户汇报结果。禁止虚构 ID，禁止使用旁路工具直接修改正式设定。",
  )
  return lines.join("\n")
}

/** AI 一键整理：批处理编排指令（lint → 一致性 → 去重扫描 → analyze → batch），落点为收件箱 */
export function buildBatchOrganizePrompt(novelID: string): string {
  return [
    `小说 ID：${novelID}`,
    "",
    "请对以上小说执行批处理整理编排：先用 lint_settings 获取确定性结构问题，再用 check_settings_consistency 检查一致性，deduplicate_characters(dry_run=true) 与 deduplicate_relationships(dry_run=true) 扫描重复（只扫不改），organize_settings(action=\"analyze\") 汇总整理分析；综合以上发现编译版本 2 plan_json（只使用真实条目 ID 与白名单字段），调用 organize_settings(action=\"batch\") 提交批处理：白名单内机械修复自动执行，其余操作写入设定收件箱待审。完成后向用户汇报「新增 N 条待审」并说明自动执行了哪些修复。",
    "不要猜测或改写 novel_id，不要使用 update_setting / delete_setting 等旁路工具直接修改，禁止虚构 ID。",
  ].join("\n")
}

/** JSON 兼容值（结构与 client 生成类型的 JsonValue 一致；JSON.parse 的对象产物按构造满足） */
export type JsonPlain = null | boolean | number | string | readonly JsonPlain[] | { readonly [key: string]: JsonPlain }

/** 编辑后接受：把用户输入解析为 after 覆盖对象；必须是非空 JSON 对象，错误用原因码交给组件翻译 */
export function parseAfterOverride(
  raw: string,
): { ok: true; value: { readonly [key: string]: JsonPlain } } | { ok: false; reason: "empty" | "invalid" | "not-object" } {
  const text = raw.trim()
  if (text === "") return { ok: false, reason: "empty" }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: "invalid" }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not-object" }
  }
  return { ok: true, value: parsed as { readonly [key: string]: JsonPlain } }
}

/** 批量合并选择校验：至少 2 条且全部为候选条目 */
export function isMergeableSelection(items: readonly ReviewInboxItem[]): boolean {
  return items.length >= 2 && items.every((item) => item.source === "candidate")
}
