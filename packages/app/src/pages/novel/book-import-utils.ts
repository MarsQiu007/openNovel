/**
 * 书籍导入向导纯函数（book-import）：文件名校验与建议书名推导。
 * 独立 .ts 以便单测（app 单测环境无法 import .tsx 组件链）。
 */

/** 支持导入的书稿扩展名（小写比较）。 */
export const IMPORT_SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown"] as const

/** 按扩展名判断是否支持导入（EPUB/DOCX 等明确走「暂不支持」提示，不进解析）。 */
export function isSupportedImportFileName(filename: string): boolean {
  const lower = filename.toLowerCase()
  return IMPORT_SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** 文件名去扩展名作为建议书名（与服务端 suggestedTitle 口径一致；取不到回退原文件名）。 */
export function importFilenameToTitle(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "")
  return base.length > 0 ? base : filename
}
