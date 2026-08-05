/**
 * 题材工具库 — 力量体系工具、金手指库、打脸构建器
 *
 * 提供网文创作中常用的题材相关工具函数：
 * - 力量体系验证与导航（validatePowerLevel / getNextLevel / getPowerSystem）
 * - 金手指匹配与模板（matchGoldenFingerToGenre / getGoldenFingerTemplates）
 * - 打脸情节构建（buildFaceSlap — 4拍序列）
 */

import {
  power_system as xuanhuan_power_system,
  golden_finger_types as xuanhuan_golden_finger_types,
  face_slap_templates as xuanhuan_face_slap_templates,
} from "./genres/xuanhuan.js"
import {
  power_system as xianxia_power_system,
  golden_finger_types as xianxia_golden_finger_types,
  face_slap_templates as xianxia_face_slap_templates,
} from "./genres/xianxia.js"
import {
  power_system as dushi_power_system,
  golden_finger_types as dushi_golden_finger_types,
  face_slap_templates as dushi_face_slap_templates,
} from "./genres/dushi.js"
import {
  power_system as lishi_power_system,
  golden_finger_types as lishi_golden_finger_types,
  face_slap_templates as lishi_face_slap_templates,
} from "./genres/lishi.js"
import {
  power_system as kehuan_power_system,
  golden_finger_types as kehuan_golden_finger_types,
  face_slap_templates as kehuan_face_slap_templates,
} from "./genres/kehuan.js"
import {
  power_system as xuanyi_power_system,
  golden_finger_types as xuanyi_golden_finger_types,
  face_slap_templates as xuanyi_face_slap_templates,
} from "./genres/xuanyi.js"
import {
  power_system as yanqing_power_system,
  golden_finger_types as yanqing_golden_finger_types,
  face_slap_templates as yanqing_face_slap_templates,
} from "./genres/yanqing.js"
import {
  power_system as youxi_power_system,
  golden_finger_types as youxi_golden_finger_types,
  face_slap_templates as youxi_face_slap_templates,
} from "./genres/youxi.js"

// ── 类型定义 ──────────────────────────────────────────────────

/** 力量体系类型 */
type PowerSystem = {
  名称: string
  境界: readonly string[] | Record<string, string | readonly string[]>
  描述: string
}

/** 金手指类型条目 */
type GoldenFingerTypeEntry = {
  名称: string
  描述: string
  常见变体: readonly string[]
}

/** 打脸模板条目 */
type FaceSlapTemplate = {
  场景: string
  描述: string
  节奏: string
  关键台词: string
}

/** 题材模板集合 */
type GenreTemplates = {
  power_system: PowerSystem
  golden_finger_types: readonly GoldenFingerTypeEntry[]
  face_slap_templates: readonly FaceSlapTemplate[]
}

// ── 题材映射 ──────────────────────────────────────────────────

const genreMap: Record<string, GenreTemplates> = {
  xuanhuan: {
    power_system: xuanhuan_power_system,
    golden_finger_types: xuanhuan_golden_finger_types,
    face_slap_templates: xuanhuan_face_slap_templates,
  },
  xianxia: {
    power_system: xianxia_power_system,
    golden_finger_types: xianxia_golden_finger_types,
    face_slap_templates: xianxia_face_slap_templates,
  },
  dushi: {
    power_system: dushi_power_system,
    golden_finger_types: dushi_golden_finger_types,
    face_slap_templates: dushi_face_slap_templates,
  },
  lishi: {
    power_system: lishi_power_system,
    golden_finger_types: lishi_golden_finger_types,
    face_slap_templates: lishi_face_slap_templates,
  },
  kehuan: {
    power_system: kehuan_power_system,
    golden_finger_types: kehuan_golden_finger_types,
    face_slap_templates: kehuan_face_slap_templates,
  },
  xuanyi: {
    power_system: xuanyi_power_system,
    golden_finger_types: xuanyi_golden_finger_types,
    face_slap_templates: xuanyi_face_slap_templates,
  },
  yanqing: {
    power_system: yanqing_power_system,
    golden_finger_types: yanqing_golden_finger_types,
    face_slap_templates: yanqing_face_slap_templates,
  },
  youxi: {
    power_system: youxi_power_system,
    golden_finger_types: youxi_golden_finger_types,
    face_slap_templates: youxi_face_slap_templates,
  },
}

// ── 辅助函数 ──────────────────────────────────────────────────

/** 从力量体系中提取所有等级名称（处理数组和对象两种形态） */
function getAllLevels(system: PowerSystem): readonly string[] {
  if (Array.isArray(system.境界)) {
    return system.境界
  }
  // 对象类型（如游戏的多维等级、科幻的多维等级体系）
  // 过滤掉非数组字段（如 角色等级 的描述字符串）
  return Object.values(system.境界)
    .filter((v): v is readonly string[] => Array.isArray(v))
    .flat()
}

// ── 力量体系工具 ──────────────────────────────────────────────

/**
 * 验证等级是否在给定题材的力量体系中
 * @param genre 题材名称（英文小写，如 "xuanhuan"）
 * @param level 要验证的等级名称
 * @returns 布尔值，表示该等级是否有效
 */
export function validatePowerLevel(genre: string, level: string): boolean {
  const templates = genreMap[genre]
  if (!templates) return false
  const levels = getAllLevels(templates.power_system)
  return levels.includes(level)
}

/**
 * 获取给定等级的下一个等级
 * @param genre 题材名称
 * @param level 当前等级名称
 * @returns 下一等级名称，若已是最高等级或不存在则返回 null
 */
export function getNextLevel(genre: string, level: string): string | null {
  const templates = genreMap[genre]
  if (!templates) return null
  const levels = getAllLevels(templates.power_system)
  const index = levels.indexOf(level)
  if (index === -1 || index >= levels.length - 1) return null
  return levels[index + 1]
}

/**
 * 获取完整的力量体系
 * @param genre 题材名称
 * @returns 力量体系对象，若题材不存在则返回 null
 */
export function getPowerSystem(genre: string): PowerSystem | null {
  return genreMap[genre]?.power_system ?? null
}

// ── 金手指库 ──────────────────────────────────────────────────

/**
 * 匹配金手指类型到题材
 * 检查给定题材是否支持某种金手指类型
 * @param genre 题材名称
 * @param gfType 金手指类型名称（如 "穿越重生"）
 * @returns 匹配的金手指类型条目，若未找到则返回 null
 */
export function matchGoldenFingerToGenre(genre: string, gfType: string): GoldenFingerTypeEntry | null {
  const templates = genreMap[genre]
  if (!templates) return null
  return templates.golden_finger_types.find((gf) => gf.名称 === gfType) ?? null
}

/**
 * 获取某个题材的金手指模板列表
 * @param genre 题材名称
 * @returns 金手指类型数组，若题材不存在则返回空数组
 */
export function getGoldenFingerTemplates(genre: string): readonly GoldenFingerTypeEntry[] {
  return genreMap[genre]?.golden_finger_types ?? []
}

// ── 打脸构建器 ────────────────────────────────────────────────

/** 打脸序列的一拍 */
export type FaceSlapBeat = {
  /** 拍名（如"轻视"、"冲突"、"反转"、"打脸"） */
  名称: string
  /** 该拍的内容描述 */
  描述: string
  /** 角色该拍的状态/反应 */
  角色状态: string
  /** 对手该拍的状态/反应 */
  对手状态: string
}

/** 完整4拍打脸序列 */
export type FaceSlapSequence = {
  /** 选用的基础打脸模板 */
  基础模板: FaceSlapTemplate | null
  /** 4拍序列：轻视→冲突→反转→打脸 */
  序列: [FaceSlapBeat, FaceSlapBeat, FaceSlapBeat, FaceSlapBeat]
}

/**
 * 构建4拍打脸序列
 *
 * 4拍结构：轻视→冲突→反转→打脸
 * @param genre 题材名称
 * @param character 主角名称
 * @param opponent 对手名称
 * @param context 场景上下文描述
 * @returns 4拍打脸序列
 */
export function buildFaceSlap(genre: string, character: string, opponent: string, context: string): FaceSlapSequence {
  const templates = genreMap[genre]
  const template = templates?.face_slap_templates[0] ?? null

  const sequence: [FaceSlapBeat, FaceSlapBeat, FaceSlapBeat, FaceSlapBeat] = [
    {
      名称: "轻视",
      描述: `${opponent}看不起${character}，认为${character}在${context}中不值一提`,
      角色状态: `${character}隐忍不发，暗自积蓄力量`,
      对手状态: `${opponent}态度傲慢，言语中充满不屑和嘲讽`,
    },
    {
      名称: "冲突",
      描述: `${character}和${opponent}在${context}中正面碰撞，${character}暂时处于下风`,
      角色状态: `${character}奋力抵抗，展现出超乎预期的实力`,
      对手状态: `${opponent}有些惊讶但仍不放在眼里，加大压制力度`,
    },
    {
      名称: "反转",
      描述: `${character}突然展露真实实力或底牌，局势瞬间逆转`,
      角色状态: `${character}不再隐藏，释放全部力量`,
      对手状态: `${opponent}脸色大变，难以置信${character}竟然隐藏了这么多`,
    },
    {
      名称: "打脸",
      描述: `${character}以碾压性的优势击败${opponent}，让所有质疑者目瞪口呆`,
      角色状态: `${character}淡然收手，留下经典台词`,
      对手状态: `${opponent}被彻底打脸，后悔莫及${template !== null ? `，${template.关键台词}` : ""}`,
    },
  ]

  return {
    基础模板: template,
    序列: sequence,
  }
}
