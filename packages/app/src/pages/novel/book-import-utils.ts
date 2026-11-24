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
 * 导入报告页「AI 整理」建队指令：让 director 创建导入整理工作队列
 * （固定分章先体检确认重切 → 分章校验 → 逐章纠错/设定/技法单读三产出 → 书籍简介 → 汇总汇报），
 * 持久化推进、断点续跑、挂起恢复；各阶段产出走既有审阅/入库闭环
 * （错别字建议只汇报、设定候选进审阅收件箱、技法 unverified 入库）。
 */
export function buildImportPipelinePrompt(input: {
  novelID: string
  title: string
  volumeCount: number
  chapterCount: number
}) {
  return [
    `小说 ID：${input.novelID}`,
    "",
    `《${input.title}》刚完成书籍导入（${input.volumeCount} 卷 / ${input.chapterCount} 章），请执行导入后整理编排（工作队列流程）：`,
    "1. 若 list_chapters 返回 fixed_split 固定分章标记，先做建队前分章体检：分批分析相邻章边界，产出重切方案并等我确认；我确认应用后再建队，我拒绝或无需调整时直接建队；",
    "2. 按「导入整理（工作队列）」流程创建导入整理队列：分章结构校验打头，每章一个章节整理单元（纠错→设定→技法，单读三产出），书籍简介生成与汇总汇报殿后；",
    "3. 逐章推进至全部完成，最后产出全书整理汇总（纠错建议分布、设定候选待审数、技法新学/合并/拒绝、分章校验异常与简介确认）。",
    "",
    "约束（与导入整理流程一致）：",
    "- 队列目标写明书名与产出；同会话已有 active 队列时不重复建队，先完成或挂起既有队列；",
    "- 纠错只产出建议清单（章节定位 + 原文/建议对照），禁止直改章节正文，修订走章节审批流；",
    "- 设定/技法抽取走既有审阅与入库闭环（设定审阅收件箱、技法库 unverified），禁止 update_setting / delete_setting 等旁路直改正式设定。",
  ].join("\n")
}
