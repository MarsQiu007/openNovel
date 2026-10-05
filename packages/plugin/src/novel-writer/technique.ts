/** 规范场景词表（唯一事实源）：technique-extract.ts 的 LLM prompt 与 context.ts inferSceneType 输出均已锚定这 7 值 */
export const CANONICAL_SCENE_TYPES: readonly string[] = [
  "action",
  "dialogue",
  "description",
  "suspense",
  "emotion_shift",
  "transition",
  "general",
]

/** 场景标签与规范词表求交（不回退）——检索侧用空交集判定"无规范标签的历史数据" */
export function canonicalSceneIntersection(sceneTypes: string[] | undefined): string[] {
  return (sceneTypes ?? []).filter((scene) => CANONICAL_SCENE_TYPES.includes(scene))
}

/** 入库收敛：求交保留规范值，空交集或缺省回退 ["general"]（normalizeTechnique 用） */
export function toCanonicalSceneTypes(sceneTypes: string[] | undefined): string[] {
  const canonical = canonicalSceneIntersection(sceneTypes)
  return canonical.length > 0 ? canonical : ["general"]
}

export type TechniqueLevel = "paragraph" | "sentence" | "dialogue" | "description" | "transition"

/** 层级枚举清单（校验与遍历用，词表变更只改这一处） */
export const TECHNIQUE_LEVELS: readonly TechniqueLevel[] = [
  "paragraph",
  "sentence",
  "dialogue",
  "description",
  "transition",
]

const TECHNIQUE_LEVEL_SET: ReadonlySet<string> = new Set(TECHNIQUE_LEVELS)

/** 运行时枚举归属校验：兜 JS 直连调用方绕过 schema 传入的非法值 */
export function isTechniqueLevel(value: unknown): value is TechniqueLevel {
  return typeof value === "string" && TECHNIQUE_LEVEL_SET.has(value)
}

/**
 * 层级判据单一事实源：director 学习指引、save/search_techniques 工具描述、
 * 蒸馏与重分类提示词必须引用本常量，不得各自改写（各自缩水是 level 全量 paragraph 的根因）。
 */
export const LEVEL_CRITERIA = `层级回答"技法作用的最小文本单元"，与 scene_types 正交：scene_types 说"什么叙事场景适用"，层级说"作用在多大的文字单位上"。按最小作用单元归类：
- sentence 句子级：单句内生效的技巧——修辞（比喻/通感/排比）、长短句搭配、单句句式节奏。
- dialogue 对话机制级：对话轮次组织——话轮攻防、潜台词、沉默与打断、问答节奏。即使场景标签也是 dialogue，层级维度只管"轮次机制"。
- description 描写组织级：静态描写的取舍编排——观察顺序、细节密度、五感搭配、空间推进。场景标签说"这是描写戏"，层级说"技法管描写的组织结构"。
- transition 过渡衔接级：段间/场景间/时间跳跃的接缝——转场钩子、时间跳跃缓冲、换场首句锚定。
- paragraph 段落级：整段或跨句的宏观组织——详略安排、信息揭露顺序、一段内的推进节奏、情绪积累结构。
判定顺序：先问"只作用于一句话吗"——是则 sentence；管对话轮次则 dialogue；管描写编排则 description；管接缝过渡则 transition；以上都不是、确为整段组织才用 paragraph。paragraph 是结构类技法的归口，不是缺省档——拿不准时回看技法指令描述的操作对象再定。`
export type TechniqueStatus = "unverified" | "verified" | "shadow" | "archived"
/** 内容性质：general=通用写法（入全局库跨书共享）；adult=成人内容（留本书库） */
export type TechniqueScope = "general" | "adult"
/** 技法来源库：book=本书库；global=全局通用技法库 */
export type TechniqueLibrary = "book" | "global"

export interface TechniqueEvidence {
  sourceTitle: string
  sourceLocation: string
  excerpt: string
  annotation: string
}

export interface TechniqueEntry {
  id: string
  name: string
  principle: string
  instruction: string
  sceneTypes: string[]
  level: TechniqueLevel
  evidence: TechniqueEvidence[]
  commonMisuse: string
  confidence: number
  status: TechniqueStatus
  scope: TechniqueScope
  embedding: number[] | null
  usageCount: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface TechniqueQuery {
  sceneType: string
  level?: TechniqueLevel
  contextText: string
  limit?: number
  minConfidence?: number
}

export interface TechniqueFeedback {
  techniqueId: string
  chapterId: string
  score: number
  wasUsed: boolean
  comment: string
  createdAt: number
}

export interface RetrievedTechnique {
  entry: TechniqueEntry
  matchScore: number
  /** 技法所在库：反馈/计数按此路由到对应库 */
  library: TechniqueLibrary
}

export interface ShadowLogEntry {
  id: string
  novelId: string
  chapterNumber: number
  sceneType: string
  queryText: string
  retrievedTechniqueIds: string[]
  retrievedTechniqueNames: string[]
  createdAt: number
}
