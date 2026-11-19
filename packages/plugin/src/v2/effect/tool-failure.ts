/**
 * 工具失败类别词表（design D2/D4）：写作工具的业务失败以稳定 ASCII name
 * 充当错误类别，宿主结算链与观测面仅透传命中词表的 name；词表外一律
 * 未分类，运行时类型名（"Error"/"TypeError"/Effect 类 tag 等）不得冒充类别。
 */
export const ToolErrorCategories = [
  "not_found",
  "param_error",
  "state_conflict",
  "gate_blocked",
  "content_rejected",
  "internal",
] as const
export type ToolErrorCategory = (typeof ToolErrorCategories)[number]

export const isToolErrorCategory = (value: unknown): value is ToolErrorCategory =>
  typeof value === "string" && (ToolErrorCategories as readonly string[]).includes(value)

/**
 * 构造携带稳定类别的工具失败错误（调用方 `throw toolFailure(...)`）：
 * name 即词表类别，宿主按词表提取 name/code 透传到失败事件；code 为可选
 * 细分类别码（如 chapter_not_found），仅随命中词表的类别一起透传。
 */
export const toolFailure = (category: ToolErrorCategory, message: string, extras?: { readonly code?: string }): Error => {
  const error = new Error(message)
  error.name = category
  if (extras?.code !== undefined) (error as { code?: string }).code = extras.code
  return error
}
