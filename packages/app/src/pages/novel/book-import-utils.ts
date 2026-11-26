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
 * （分章校验 → 逐章纠错/设定/技法单读三产出 → 书籍简介 → 汇总汇报），
 * 持久化推进、断点续跑、挂起恢复；各阶段产出走既有审阅/入库闭环
 * （错别字建议只汇报、设定候选进审阅收件箱、技法 unverified 入库）。
 */
/** AI 拆章建队指令（narrative-unit-split）：director 按预估章数建 N+1 队列并逐章组章推进。 */
export function buildAiSplitPrompt(input: {
  novelID: string
  title: string
  estimatedChapters: number
}) {
  return [
    `小说 ID：${input.novelID}`,
    "",
    `《${input.title}》以 AI 拆章方式导入完成（整书原文已存档，当前无正文章节），请执行 AI 拆章编排（工作队列流程）：`,
    `1. 用 list_chapters 核对该书当前无正文章节；按预估章数 ${input.estimatedChapters} 声明「AI 组章」单元，收尾「简介与汇总」单元一个，调用 workrun(action="create", goal=?, items=[...]) 建队；`,
    "2. 逐章推进：claim 领取单元 → 用拆章工具从存档游标处取句流窗口并 dispatch @cutter 组章（章末句/章题/章内分段点）→ 执行器校验落章并推进游标 → dispatch @cleaner 单读全章产出修复后全文、设定与技法 → 修复后文本直写该章、设定自动入库合并、技法按学习口径入库 → complete_item 并 progress 记录（含修复对照与设定入库轨迹）；",
    "3. 全书处理完而单元未用完时剩余单元直接跳过；预估不足时由收尾单元继续组章至游标到底，再生成书籍简介（update_novel）与全书汇总（预估/实际章数偏差、修复对照统计、设定入库与合并清单），最后 finish。",
    "",
    "约束：",
    "- 单章组章/清洗失败最多重试 2 次，连续 5 章失败暂停队列并提示检查 cutter/cleaner 模型配置；MUST NOT 静默改用脚本拆分；",
    "- 清洗只修确定性错误（明显错别字、重复行、页眉页脚水印、段落错乱），人名/术语等歧义内容不动；修复后章字数与原章偏差超 10% 拒绝本次修复并降级为仅分段与噪声清理；修复对照写进度笔记；",
    "- 设定信息足够即自动入库（organize_settings），后续同主体补充自动合并，不走审阅收件箱；技法沿用 save_technique unverified 口径，同名合并保留既有 status 与 confidence。",
  ].join("\n")
}

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
    "1. 按「导入整理（工作队列）」流程创建导入整理队列：分章结构校验打头，每章一个章节整理单元（纠错→设定→技法，单读三产出），书籍简介生成与汇总汇报殿后；",
    "2. 逐章推进至全部完成，最后产出全书整理汇总（纠错建议分布、设定候选待审数、技法新学/合并/拒绝、分章校验异常与简介确认）。",
    "",
    "约束（与导入整理流程一致）：",
    "- 队列目标写明书名与产出；同会话已有 active 队列时不重复建队，先完成或挂起既有队列；",
    "- 纠错只产出建议清单（章节定位 + 原文/建议对照），禁止直改章节正文，修订走章节审批流；",
    "- 设定/技法抽取走既有审阅与入库闭环（设定审阅收件箱、技法库 unverified），禁止 update_setting / delete_setting 等旁路直改正式设定。",
  ].join("\n")
}
