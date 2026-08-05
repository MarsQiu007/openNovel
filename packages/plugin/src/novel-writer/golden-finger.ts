/**
 * 金手指设计 — 7种网文金手指类型定义与3问验证机制
 *
 * 金手指（Golden Finger）是网文中的核心设定，指主角拥有的特殊能力或机遇。
 * 每种金手指定义包含：名称、描述、示例、限制条件。
 * 创建金手指时需回答3个验证问题：来源、限制、代价。
 */
import { Schema } from "effect"

// ── 金手指类型枚举 ──────────────────────────────────────────────

/** 金手指类型标签 — 7种经典网文金手指 */
export const GoldenFingerType = Schema.Literals(["系统类", "穿越类", "重生类", "血脉类", "神器类", "功法类", "异能类"])
export type GoldenFingerType = typeof GoldenFingerType.Type

// ── 7种金手指定义 ────────────────────────────────────────────────

/** 系统类金手指 — 主角获得一个智能系统辅助 */
export class SystemFinger extends Schema.Class<SystemFinger>("SystemFinger")({
  type: Schema.Literal("系统类"),
  name: Schema.String,
  description: Schema.String,
  example: Schema.String,
  constraints: Schema.String,
}) {}

/** 穿越类金手指 — 主角穿越到异世界，携带前世记忆或知识 */
export class TransmigrationFinger extends Schema.Class<TransmigrationFinger>("TransmigrationFinger")({
  type: Schema.Literal("穿越类"),
  name: Schema.String,
  description: Schema.String,
  example: Schema.String,
  constraints: Schema.String,
}) {}

/** 重生类金手指 — 主角重生回到过去，保留未来记忆 */
export class RebirthFinger extends Schema.Class<RebirthFinger>("RebirthFinger")({
  type: Schema.Literal("重生类"),
  name: Schema.String,
  description: Schema.String,
  example: Schema.String,
  constraints: Schema.String,
}) {}

/** 血脉类金手指 — 主角拥有特殊血脉或体质 */
export class BloodlineFinger extends Schema.Class<BloodlineFinger>("BloodlineFinger")({
  type: Schema.Literal("血脉类"),
  name: Schema.String,
  description: Schema.String,
  example: Schema.String,
  constraints: Schema.String,
}) {}

/** 神器类金手指 — 主角获得强大法宝或神器 */
export class ArtifactFinger extends Schema.Class<ArtifactFinger>("ArtifactFinger")({
  type: Schema.Literal("神器类"),
  name: Schema.String,
  description: Schema.String,
  example: Schema.String,
  constraints: Schema.String,
}) {}

/** 功法类金手指 — 主角获得逆天功法或修炼秘籍 */
export class TechniqueFinger extends Schema.Class<TechniqueFinger>("TechniqueFinger")({
  type: Schema.Literal("功法类"),
  name: Schema.String,
  description: Schema.String,
  example: Schema.String,
  constraints: Schema.String,
}) {}

/** 异能类金手指 — 主角觉醒特殊异能或超能力 */
export class SuperpowerFinger extends Schema.Class<SuperpowerFinger>("SuperpowerFinger")({
  type: Schema.Literal("异能类"),
  name: Schema.String,
  description: Schema.String,
  example: Schema.String,
  constraints: Schema.String,
}) {}

// ── 金手指联合类型 ────────────────────────────────────────────────

/** 金手指联合类型 — 7种金手指的并集 */
export const GoldenFinger = Schema.Union([
  SystemFinger,
  TransmigrationFinger,
  RebirthFinger,
  BloodlineFinger,
  ArtifactFinger,
  TechniqueFinger,
  SuperpowerFinger,
])
export type GoldenFinger = typeof GoldenFinger.Type

// ── 3问验证 ──────────────────────────────────────────────────────

/** 验证问题 — 创建金手指时必须回答的问题 */
export class ValidationQuestion extends Schema.Class<ValidationQuestion>("ValidationQuestion")({
  /** 问题内容 */
  question: Schema.String,
  /** 用户回答 */
  answer: Schema.String,
  /** 所属验证类别：来源/限制/代价 */
  category: Schema.Literals(["来源", "限制", "代价"]),
}) {}

/** 3问验证集合 — 一组验证问答 */
export class ValidationSet extends Schema.Class<ValidationSet>("ValidationSet")({
  source: ValidationQuestion,
  limitation: ValidationQuestion,
  cost: ValidationQuestion,
}) {}

// ── 金手指创建请求 ────────────────────────────────────────────────

/** 金手指创建请求 — 包含金手指定义和3问验证答案 */
export class CreateGoldenFingerRequest extends Schema.Class<CreateGoldenFingerRequest>("CreateGoldenFingerRequest")({
  finger: GoldenFinger,
  validation: ValidationSet,
}) {}

// ── 预设金手指模板 ────────────────────────────────────────────────

/** 7种金手指的预设模板，供创作时参考 */
export const goldenFingerTemplates: readonly GoldenFinger[] = [
  new SystemFinger({
    type: "系统类",
    name: "全能写作系统",
    description: "主角获得一个智能写作辅助系统，可提供剧情建议、角色塑造、文笔优化等功能",
    example: "穿越到异世界的扑街写手，绑定「全能写作系统」，系统可推演剧情走向、优化人物对话",
    constraints: "系统需消耗「灵感值」运行，灵感值通过完成写作任务获取；系统不能直接代笔，只能提供辅助",
  }),
  new TransmigrationFinger({
    type: "穿越类",
    name: "异界知识库",
    description: "主角穿越到异世界，保留现代社会的知识储备和思维模式",
    example: "现代化学工程师穿越到魔法世界，利用化学知识改良炼金术，引发工业革命",
    constraints: "异世界的物理法则可能与地球不同，部分知识需要验证后使用；不能直接使用现代科技物品",
  }),
  new RebirthFinger({
    type: "重生类",
    name: "未来记忆",
    description: "主角重生回到人生关键节点，保留未来数十年的记忆和经验",
    example: "修仙界的大能渡劫失败后重生回少年时期，带着前世修炼经验和秘境记忆重新修炼",
    constraints: "重大历史事件的记忆会随重生次数变模糊；不能向他人透露重生事实，否则会遭天道反噬",
  }),
  new BloodlineFinger({
    type: "血脉类",
    name: "上古神兽血脉",
    description: "主角体内流淌着上古神兽或远古种族的特殊血脉",
    example: "普通少年在觉醒仪式上激活了早已失传的龙族血脉，获得远超常人的修炼天赋和龙族传承",
    constraints: "血脉觉醒需要特殊契机；高阶血脉会引来觊觎者的追杀；血脉之力过度使用会透支生命力",
  }),
  new ArtifactFinger({
    type: "神器类",
    name: "时空之书",
    description: "主角获得一本可以操控时间与空间的古老典籍",
    example: "废柴书生在旧书摊淘到一本泛黄的古书，发现可以消耗精神力进入书中空间，时间流速是外界的十分之一",
    constraints: "神器需要认主才能使用；每次使用消耗大量精神力；神器可能被更强者抢夺或封印",
  }),
  new TechniqueFinger({
    type: "功法类",
    name: "混沌吞天诀",
    description: "主角获得一门可以吞噬万物化为己用的逆天功法",
    example: "灵根残缺的少年在山崖下发现上古大能的修炼洞府，获得失传的「混沌吞天诀」，可以吞噬天地灵气强化自身",
    constraints: "功法修炼需要特殊的体质或机缘；吞噬过程中可能被反噬；功法的逆天效果会引来天劫",
  }),
  new SuperpowerFinger({
    type: "异能类",
    name: "心灵感应",
    description: "主角觉醒可以读取他人思想的心灵系异能",
    example: "抑郁症患者在生死边缘觉醒了心灵感应能力，能听到周围人的内心独白，从此在都市生活中游刃有余",
    constraints: "异能使用过度会导致精神疲劳；无法控制时可能被动接收大量信息；对意志坚定者效果减弱",
  }),
]

// ── 验证函数 ──────────────────────────────────────────────────────

/** 3问验证的默认问题模板 */
export const defaultValidationQuestions = {
  source: { question: "这个金手指的来源是什么？请描述其获得方式、背景故事。", answer: "" },
  limitation: { question: "这个金手指有什么限制？请说明使用条件、副作用或弱点。", answer: "" },
  cost: { question: "使用这个金手指需要付出什么代价？请描述其消耗、风险或隐性成本。", answer: "" },
} as const satisfies Record<string, { question: string; answer: string }>

/**
 * 根据金手指类型生成3问验证问题
 * @param type 金手指类型
 * @returns 三个验证问题（不含答案）
 */
export function getValidationQuestions(
  type: GoldenFingerType,
): readonly [ValidationQuestion, ValidationQuestion, ValidationQuestion] {
  const questions: Record<string, string> = {
    系统类: "这个系统的核心规则是什么？它如何与主角互动？",
    穿越类: "主角穿越的契机是什么？穿越后保留了哪些原有能力？",
    重生类: "主角重生的时间节点是什么？未来记忆的完整度如何？",
    血脉类: "血脉的来历和觉醒条件是什么？血脉有什么特殊能力？",
    神器类: "神器的来历和认主条件是什么？神器的核心能力是什么？",
    功法类: "功法的来历和修炼门槛是什么？功法的核心特点和代价是什么？",
    异能类: "异能的觉醒契机是什么？异能的核心能力和成长路径是什么？",
  }

  const sourceQuestion = questions[type] ?? "这个金手指的来源是什么？"
  return [
    new ValidationQuestion({ question: sourceQuestion, answer: "", category: "来源" }),
    new ValidationQuestion({
      question: "这个金手指有什么限制？请说明使用条件、副作用或弱点。",
      answer: "",
      category: "限制",
    }),
    new ValidationQuestion({
      question: "使用这个金手指需要付出什么代价？请描述其消耗、风险或隐性成本。",
      answer: "",
      category: "代价",
    }),
  ]
}

/**
 * 验证金手指创建请求是否完整
 * @param request 金手指创建请求
 * @returns 如果所有验证问题都已回答返回 true，否则返回 false
 */
export function validateGoldenFingerCreation(request: CreateGoldenFingerRequest): boolean {
  return (
    request.validation.source.answer.trim().length > 0 &&
    request.validation.limitation.answer.trim().length > 0 &&
    request.validation.cost.answer.trim().length > 0
  )
}
