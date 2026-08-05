/**
 * 运行时产物生成模块 — W6-T7
 *
 * 每个章节生成 4 个运行时产物文件，存放在 .novel/runtime/chapter-{n}/ 目录下：
 * 1. intent.md — 章节创作意图（来自 outliner）
 * 2. context.json — 上下文快照（来自 assembleSnapshot）
 * 3. rule-stack.yaml — 活跃规则栈（题材规则 + 写作规则）
 * 4. trace.json — 执行追踪（流水线步骤 + 耗时）
 *
 * 导出：
 * - RuntimeArtifactPaths 类型 — 4 个产物文件的路径
 * - generateRuntimeArtifacts(novelId, chapterId) 函数 — 生成 4 个产物文件
 *
 * 遵循 novel-writer.ts 中的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { join } from "path"
import { mkdir, writeFile } from "fs/promises"
import { eq, and } from "drizzle-orm"
import { getDb, NovelTable, ChapterTable } from "./session-store.js"

import { assembleSnapshot } from "./context.js"

// ─── 类型定义 ───

/** 运行时产物文件路径 */
export type RuntimeArtifactPaths = {
  /** 章节创作意图文件路径 */
  intent: string
  /** 上下文快照文件路径 */
  context: string
  /** 活跃规则栈文件路径 */
  ruleStack: string
  /** 执行追踪文件路径 */
  trace: string
}

// ─── 题材 → 文件模块名映射（与 context.ts 保持一致） ───

const GENRE_MODULE_MAP: Record<string, string> = {
  玄幻: "xuanhuan",
  都市: "dushi",
  仙侠: "xianxia",
  历史: "lishi",
  科幻: "kehuan",
  悬疑: "xuanyi",
  言情: "yanqing",
  游戏: "youxi",
}

// ─── 写作规则（从 writer agent 系统提示词中提取的 25 条规则） ───

const WRITER_RULES: readonly string[] = [
  "【节奏控制】每章必须有明确的起承转合，开篇 300 字内必须抛出钩子，中段保持张力不降，结尾留悬念或高潮余韵。",
  "【钩子法则】每章结束必须埋设至少一个钩子（悬念/反转/升级预告/情感张力），确保读者有'下一章'的冲动。",
  "【声音统一】全文采用统一的第三人称限知视角叙述，不随意切换视角，不出现作者旁白点评。",
  "【描写克制】环境描写不超过 150 字，人物外貌初见时不超过 200 字，动作描写以短句为主，每句不超过 30 字。",
  "【对话密度】对话占比不低于全文 30%，每段对话不超过 3 句，对话必须推动剧情或塑造人物。",
  "【对话标签】对话标签优先使用'道''说''问'，避免'冷笑道''怒吼道'等过度修饰，每 5 段对话最多使用 1 次修饰标签。",
  "【动作驱动】情节推进以动作为主，每 500 字至少包含一个明确的动作节点（战斗/冲突/决策/发现）。",
  "【情感递进】角色情感变化必须有层次，不得跳跃式转变。愤怒需经历不悦→恼怒→暴怒，喜悦需经历意外→欣喜→狂喜。",
  "【伏笔管理】每章至少埋设 1 个可回收伏笔，伏笔必须具体可查（人物/物品/事件/信息），不得模糊笼统。",
  "【伏笔回收】回收伏笔时必须明确呼应前文，标注回收的伏笔 ID 或内容，不可蒙混过关。",
  "【打脸结构】打脸情节必须遵循四拍序列：轻视→冲突→反转→打脸。绝不可省略或颠倒顺序。",
  "【打脸力度】打脸必须有足够的反差感，对手的轻视程度越高，反转后的打脸效果越强。反转必须有理有据（底牌/实力/援军）。",
  "【力量体系】升级过程必须严格遵循该题材的力量体系境界，不得越级或跳级。每次升级需描写突破过程（感悟/天劫/奇遇/丹药）。",
  "【能力展示】新的能力获得后，必须在同一章或下一章展示其效果，不能'只获得不展示'。",
  "【金手指约束】金手指使用必须有代价或限制，每次使用需要付出代价（冷却时间/消耗资源/副作用），不得无限制使用。",
  "【字数控制】每章正文字数严格控制在 2000-3000 字之间，不得低于 2000 字，不得高于 3000 字。",
  "【章节结构】每章必须包含：开篇钩子（100-200 字）→ 发展推进（1200-1800 字）→ 高潮/转折（400-600 字）→ 结尾悬念（100-200 字）。",
  "【爽点密度】每 1000 字至少包含一个爽点（打脸/升级/收获/认可/碾压），确保读者持续获得正向反馈。",
  "【悬念制造】悬念分三种类型：信息悬念（读者知道角色不知道）、角色悬念（读者和角色都不知道）、即时悬念（角色面临直接危险）。每章至少使用一种。",
  "【人物一致性】角色行为必须符合其性格设定和成长轨迹，不得出现性格突变或行为矛盾。性格变化必须有铺垫和触发事件。",
  "【对话辨识度】主要角色对话必须有辨识度，通过语气词、句式长短、称呼习惯等区分，读者不看标签也能分辨谁在说话。",
  "【战斗描写】战斗场景必须包含：双方实力对比→出招描写→局势变化→关键转折→胜负结果。招式名称需符合题材设定，每次战斗最多 3 个关键回合。",
  "【修炼描写】修炼突破场景必须包含：瓶颈状态→突破契机→突破过程→突破后变化。突破过程不少于 200 字。",
  "【情感爆发】情感高潮场景必须在前文有至少 3 处铺垫，爆发时情感层次递进，不能一来就哭。",
  "【禁忌事项】不得出现：政治敏感内容、涉黄描写、过度暴力渲染、种族歧视、历史虚无主义。价值观必须正面向上。",
]

// ─── 流水线步骤定义 ───

const PIPELINE_STEPS = ["plan", "compose", "write", "audit", "revise", "reflect", "sync", "next"] as const

// ─── 导出函数 ───

/**
 * 生成单章运行时产物
 *
 * 在 .novel/runtime/chapter-{n}/ 目录下创建 4 个产物文件：
 * 1. intent.md — 章节创作意图（从数据库读取章节大纲）
 * 2. context.json — 上下文快照（调用 assembleSnapshot）
 * 3. rule-stack.yaml — 活跃规则栈（题材规则 + 25 条写作规则）
 * 4. trace.json — 执行追踪（8 步流水线步骤 + 耗时）
 *
 * 如果小说或章节不存在，返回 null 而不创建任何文件。
 * 目录不存在时自动创建。
 *
 * @param novelId 小说 ID
 * @param chapterId 章节序号（即 chapter order，用于目录命名和快照组装）
 * @param projectDir 项目根目录（产物将写入 <projectDir>/.novel/runtime/）
 * @returns 产物文件路径，失败时返回 null
 */
export async function generateRuntimeArtifacts(
  novelId: string,
  chapterId: number,
  projectDir: string,
): Promise<RuntimeArtifactPaths | null> {
  const db = getDb(projectDir)

  // 验证小说存在
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) return null

  // 验证章节存在
  const [chapter] = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterId)))
    .all()
  if (!chapter) return null

  // 创建产物目录
  const runtimeDir = join(projectDir, ".novel", "runtime", `chapter-${chapterId}`)
  await mkdir(runtimeDir, { recursive: true })

  const paths: RuntimeArtifactPaths = {
    intent: join(runtimeDir, "intent.md"),
    context: join(runtimeDir, "context.json"),
    ruleStack: join(runtimeDir, "rule-stack.yaml"),
    trace: join(runtimeDir, "trace.json"),
  }

  // ── 1. intent.md — 章节创作意图 ──
  const intentContent = buildIntentMarkdown(novel, chapter)
  await writeFile(paths.intent, intentContent)

  // ── 2. context.json — 上下文快照 ──
  const snapshot = await assembleSnapshot(novelId, chapterId, projectDir)
  await writeFile(paths.context, JSON.stringify(snapshot, null, 2))

  // ── 3. rule-stack.yaml — 活跃规则栈 ──
  const genreRules = await loadGenreRules(novel.genre)
  const ruleStackYaml = buildRuleStackYaml(novel.genre, genreRules)
  await writeFile(paths.ruleStack, ruleStackYaml)

  // ── 4. trace.json — 执行追踪 ──
  const traceContent = buildTraceJson(chapterId)
  await writeFile(paths.trace, traceContent)

  return paths
}

// ─── 产物内容构建函数 ───

/**
 * 构建章节意图 Markdown
 *
 * 从数据库读取章节信息，格式化为意图文档。
 * 包含章节标题、状态、字数、大纲内容等信息。
 */
function buildIntentMarkdown(
  novel: { title: string; genre: string },
  chapter: { title: string; order: number; status: string; word_count: number; content: string },
): string {
  const lines: string[] = []

  lines.push(`# 第${chapter.order}章 创作意图`)
  lines.push("")
  lines.push(`> 小说：《${novel.title}》`)
  lines.push(`> 题材：${novel.genre}`)
  lines.push(`> 章节：${chapter.title}`)
  lines.push(`> 状态：${chapter.status}`)
  lines.push(`> 字数：${chapter.word_count}`)
  lines.push(`> 生成时间：${new Date().toISOString()}`)
  lines.push("")

  lines.push("## 章节目标")
  lines.push("")
  lines.push("### 剧情目标")
  lines.push("")
  lines.push("> （本章需要完成的剧情推进目标）")
  lines.push("")
  lines.push("### 情感目标")
  lines.push("")
  lines.push("> （本章希望带给读者的情感体验）")
  lines.push("")
  lines.push("### 信息目标")
  lines.push("")
  lines.push("> （本章需要向读者传递的关键信息，如世界观揭示、伏笔暗示等）")
  lines.push("")

  if (chapter.content.length > 0) {
    lines.push("## 章节大纲")
    lines.push("")
    lines.push(chapter.content)
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * 构建规则栈 YAML
 *
 * 将题材规则和写作规则格式化为 YAML 文档。
 * 包含题材信息、题材规则列表和 25 条写作规则。
 */
function buildRuleStackYaml(genre: string, genreRules: string[]): string {
  const lines: string[] = []

  lines.push("# 活跃规则栈")
  lines.push(`# 生成时间：${new Date().toISOString()}`)
  lines.push("")
  lines.push(`genre: ${genre}`)
  lines.push("")

  lines.push("# 题材规则")
  lines.push("genre_rules:")
  if (genreRules.length === 0) {
    lines.push("  - （无特定题材规则）")
  }
  for (const rule of genreRules) {
    lines.push(`  - ${escapeYamlValue(rule)}`)
  }
  lines.push("")

  lines.push("# 写作规则（25 条）")
  lines.push("writer_rules:")
  for (let i = 0; i < WRITER_RULES.length; i++) {
    lines.push(`  - rule_${i + 1}: ${escapeYamlValue(WRITER_RULES[i])}`)
  }

  return lines.join("\n")
}

/**
 * 构建执行追踪 JSON
 *
 * 生成包含 8 步流水线步骤的追踪骨架。
 * 所有步骤初始状态为 pending，耗时 0。
 * 实际流水线执行时可通过写入此文件更新各步骤状态。
 */
function buildTraceJson(chapterNumber: number): string {
  const steps = PIPELINE_STEPS.map((step) => ({
    step,
    status: "pending",
    message: "",
    elapsedMs: 0,
  }))

  const trace = {
    chapterNumber,
    generatedAt: new Date().toISOString(),
    steps,
  }

  return JSON.stringify(trace, null, 2)
}

// ─── 辅助函数 ───

/**
 * 加载题材模板的规则
 *
 * 从题材模板文件中动态导入 rules 数组。
 * 如果题材不在映射表中或导入失败，返回空数组。
 *
 * @param genre 中文题材名
 * @returns 规则字符串数组
 */
async function loadGenreRules(genre: string): Promise<string[]> {
  const moduleName = GENRE_MODULE_MAP[genre]
  if (!moduleName) return []

  try {
    const mod = (await import(`./genres/${moduleName}.js`)) as { rules?: readonly string[] }
    if (mod.rules && Array.isArray(mod.rules)) {
      return mod.rules.map(String)
    }
  } catch {
    // 题材模板文件不存在或导入失败，返回空数组
  }

  return []
}

/**
 * 转义 YAML 字符串值中的特殊字符
 *
 * 处理包含冒号、引号、换行等特殊字符的字符串，
 * 确保生成的 YAML 格式正确。
 */
function escapeYamlValue(value: string): string {
  // 如果包含特殊字符，用双引号包裹并转义内部双引号
  if (value.includes(":") || value.includes("#") || value.includes("'") || value.includes("\n")) {
    return `"${value.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
  }
  return value
}
