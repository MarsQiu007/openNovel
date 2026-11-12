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

/**
 * 导入报告页「AI 整理」编排指令：错别字校对建议 + 设定/角色抽取。
 * 错别字建议只在回复中向用户汇报（章节定位 + 原文/建议对照），
 * 设定/角色抽取经 organize_settings 批处理写入审阅收件箱；
 * 白名单机械修复仅限确定性规则，禁止直改正文与正式设定（对齐设定中心一键整理链路）。
 */
export function buildImportTidyPrompt(input: { novelID: string; title: string; volumeCount: number; chapterCount: number }): string {
  return [
    `小说 ID：${input.novelID}`,
    "",
    `《${input.title}》刚完成书籍导入（${input.volumeCount} 卷 / ${input.chapterCount} 章），请执行导入后整理编排：`,
    "1. 用 list_chapters 拉取章节清单，逐章 read_chapter_content 通读正文，记录错别字与残留格式问题（每条带章节定位与原文/建议对照）；",
    "2. 通读中同步抽取书中的设定、角色与关系线索；",
    '3. 用 lint_settings 与 check_settings_consistency 检查设定库现状，将第 2 步抽取结果经 organize_settings(action="analyze") 汇总并编译版本 2 plan_json（只使用真实条目 ID 与白名单字段），再调用 organize_settings(action="batch") 提交批处理：白名单内确定性机械修复自动执行，其余操作一律写入设定审阅收件箱。',
    "",
    "约束：",
    "- 错别字修正建议只在回复中向用户汇报清单（章节定位 + 原文/建议对照），禁止直接修改章节正文，后续修订须走既有章节审批流；",
    "- 设定/角色抽取产出必须进审阅流（候选→接受后生效），禁止 update_setting / delete_setting 等旁路工具直接修改正式设定；",
    "- 禁止虚构 ID。完成后向用户汇报「新增 N 条待审」、自动执行了哪些修复与错别字建议清单。",
  ].join("\n")
}
