/**
 * style-rules-model 纯函数单测（style-editor-structure / chapter-length-range）。
 *
 * 纯 .ts 测试，不 import .tsx（规避本地 bun 1.4.3 的 solid JSX 回归）。
 * 覆盖：常驻字数上下限字段回填/校验/序列化（读取侧宽口径、保存侧严格正整数）、
 * 自由行保留键冲突拦截、归一化后历史数据回填、「其他」区兜底不丢失、
 * 回填-序列化往返一致。
 */
import { describe, expect, test } from "bun:test"
import {
  CHAPTER_LENGTH_KEY,
  CHAPTER_LENGTH_MAX_KEY,
  DEFAULT_CHAPTER_LENGTH,
  OTHER_SECTION_TITLE,
  groupRowsBySection,
  parseLengthFields,
  rowsFromRecord,
  rowsToRecord,
  validateLengthFields,
  validateRows,
  type StyleRuleRow,
} from "./style-rules-model"

describe("parseLengthFields 回填", () => {
  test("合法存量值按原值回显", () => {
    expect(parseLengthFields({ chapter_length: "2000", chapter_length_max: "5000" })).toEqual({
      lower: "2000",
      upper: "5000",
    })
  })

  test("缺键回显缺省：下限 2500、上限空串", () => {
    expect(parseLengthFields({})).toEqual({ lower: DEFAULT_CHAPTER_LENGTH, upper: "" })
    expect(parseLengthFields(undefined)).toEqual({ lower: DEFAULT_CHAPTER_LENGTH, upper: "" })
  })

  test("下限非法存量值按读取侧口径回显 2500（0/-3/abc/空串）", () => {
    for (const value of ["0", "-3", "abc", "", "   "]) {
      expect(parseLengthFields({ chapter_length: value }).lower).toBe(DEFAULT_CHAPTER_LENGTH)
    }
  })

  test("上限非法或 ≤ 下限回显空串（= 不设上限）", () => {
    expect(parseLengthFields({ chapter_length: "2000", chapter_length_max: "abc" }).upper).toBe("")
    expect(parseLengthFields({ chapter_length: "2000", chapter_length_max: "1500" }).upper).toBe("")
    expect(parseLengthFields({ chapter_length: "2000", chapter_length_max: "2000" }).upper).toBe("")
    expect(parseLengthFields({ chapter_length: "2000", chapter_length_max: "" }).upper).toBe("")
  })

  test("空白包夹与浮点按读取侧 Number 口径回显（trim 后数值化、floor）", () => {
    expect(parseLengthFields({ chapter_length: "2000", chapter_length_max: " 5000 " })).toEqual({
      lower: "2000",
      upper: "5000",
    })
    expect(parseLengthFields({ chapter_length: "2500.7" }).lower).toBe("2500")
  })
})

describe("validateLengthFields 保存侧校验", () => {
  test("全合法返回空对象", () => {
    expect(validateLengthFields("2000", "5000")).toEqual({})
    expect(validateLengthFields("2000", "")).toEqual({})
    expect(validateLengthFields(" 2000 ", " 5000 ")).toEqual({})
  })

  test("下限必填：空串/纯空白判 invalid_number", () => {
    expect(validateLengthFields("", "5000")).toEqual({ lower: "invalid_number" })
    expect(validateLengthFields("   ", "5000")).toEqual({ lower: "invalid_number" })
  })

  test("非法输入拦截：0 / -3 / abc / 2e3 / 全角数字均 invalid_number", () => {
    for (const value of ["0", "-3", "abc", "2e3", "２５００"]) {
      expect(validateLengthFields(value, ""), `下限 ${value}`).toEqual({ lower: "invalid_number" })
      expect(validateLengthFields("2000", value), `上限 ${value}`).toEqual({ upper: "invalid_number" })
    }
  })

  test("上限小于下限拦截为 below_lower，等于下限允许保存（读取侧按不设上限降级）", () => {
    expect(validateLengthFields("2000", "1500")).toEqual({ upper: "below_lower" })
    expect(validateLengthFields("2000", "2000")).toEqual({})
  })

  test("上限非法时不判 below_lower（字段级错误独立报告）", () => {
    expect(validateLengthFields("2000", "abc")).toEqual({ upper: "invalid_number" })
    expect(validateLengthFields("abc", "abc")).toEqual({ lower: "invalid_number", upper: "invalid_number" })
  })
})

describe("rowsFromRecord 回填", () => {
  test("排除常驻字数两键，其余按库中顺序转为规则行", () => {
    const rows = rowsFromRecord({ chapter_length: "2500", chapter_length_max: "5000", pacing: "3:1", 章节结构: "四段式" })
    expect(rows).toEqual([
      { key: "pacing", value: "3:1" },
      { key: "章节结构", value: "四段式" },
    ])
    expect(rows.some((row) => row.key === CHAPTER_LENGTH_KEY)).toBe(false)
    expect(rows.some((row) => row.key === CHAPTER_LENGTH_MAX_KEY)).toBe(false)
  })

  test("存量书 rules 含 chapter_length 时规则行排除，直接保存值不变（序列化由字段混入）", () => {
    const original = { chapter_length: "3000", pacing: "3:1" }
    const rows = rowsFromRecord(original)
    expect(rows).toEqual([{ key: "pacing", value: "3:1" }])
    const roundTrip = rowsToRecord(rows, "3000", "")
    expect(roundTrip).toEqual({ chapter_length: "3000", chapter_length_max: "", pacing: "3:1" })
  })

  test("历史嵌套/数组形态经读取侧归一化后为扁平映射，回填不丢内容", () => {
    // 归一化契约（style-rules-pipeline）：{"异能体系":{"等级严格":"…"}} → {"异能体系.等级严格":"…"}；数组 → 索引键
    // JS 对象整数键（数组索引形态）恒排在字符串键之前——「其他」区内 0、1 相对顺序不变即可
    const rows = rowsFromRecord({ "异能体系.等级严格": "先定级后突破", 0: "开场必须有钩子", 1: "结尾留悬念" })
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.key)).toEqual(["0", "1", "异能体系.等级严格"])
  })

  test("undefined 入参回填为空行数组", () => {
    expect(rowsFromRecord(undefined)).toEqual([])
  })
})

describe("groupRowsBySection 分区", () => {
  test("键名精确匹配建议表归组，未匹配键落「其他」且内容完整", () => {
    const rows: StyleRuleRow[] = [
      { key: "pacing", value: "3:1" },
      { key: "对话比例", value: "4:6" },
      { key: "异能体系.等级严格", value: "先定级后突破" },
    ]
    const grouped = groupRowsBySection(rows)
    const byTitle = new Map(grouped.map((group) => [group.title, group.rows]))
    expect(byTitle.get("叙事节奏")).toEqual([{ key: "pacing", value: "3:1" }])
    expect(byTitle.get("对话与描写")).toEqual([{ key: "对话比例", value: "4:6" }])
    expect(byTitle.get(OTHER_SECTION_TITLE)).toEqual([{ key: "异能体系.等级严格", value: "先定级后突破" }])
  })

  test("「其他」区恒在（供添加自定义键），内容分区仅在非空时出现", () => {
    const grouped = groupRowsBySection([{ key: "pacing", value: "3:1" }])
    const titles = grouped.map((group) => group.title)
    expect(titles).toContain("叙事节奏")
    expect(titles).toContain(OTHER_SECTION_TITLE)
    expect(titles).not.toContain("对话与描写")
  })

  test("章节结构分区不再建议 chapter_length / 章节字数（由常驻字段承载）", () => {
    const section = groupRowsBySection([{ key: "chapter_structure", value: "四段式" }]).find((g) => g.title === "章节结构")
    expect(section).toBeDefined()
    // chapter_length 与 章节字数 键落「其他」而非章节结构分区
    const grouped = groupRowsBySection([
      { key: "chapter_length", value: "2500" },
      { key: "章节字数", value: "3000" },
    ])
    const byTitle = new Map(grouped.map((group) => [group.title, group.rows.map((r) => r.key)]))
    expect(byTitle.get(OTHER_SECTION_TITLE)).toEqual(["chapter_length", "章节字数"])
  })
})

describe("validateRows 校验", () => {
  test("空键行被拦截", () => {
    const issues = validateRows([{ key: "", value: "x" }, { key: "pacing", value: "3:1" }])
    expect(issues.get(0)).toBe("empty_key")
    expect(issues.has(1)).toBe(false)
  })

  test("重复键行被拦截（含与首行重复的判定），不静默覆盖", () => {
    const issues = validateRows([
      { key: "pacing", value: "3:1" },
      { key: "节奏", value: "快" },
      { key: "pacing", value: "2:1" },
    ])
    expect(issues.has(0)).toBe(false)
    expect(issues.get(2)).toBe("duplicate_key")
  })

  test("自由行命中常驻字数两键判保留键冲突拦截", () => {
    const issues = validateRows([{ key: CHAPTER_LENGTH_KEY, value: "2500" }, { key: CHAPTER_LENGTH_MAX_KEY, value: "5000" }])
    expect(issues.get(0)).toBe("reserved_key")
    expect(issues.get(1)).toBe("reserved_key")
  })

  test("值为空串合法（清空值是合法意图），仅键参与校验", () => {
    const issues = validateRows([{ key: "pacing", value: "" }])
    expect(issues.size).toBe(0)
  })
})

describe("rowsToRecord 序列化与往返一致", () => {
  test("常驻字段值以字符串混入两键", () => {
    const rows: StyleRuleRow[] = [{ key: "pacing", value: "3:1" }]
    expect(rowsToRecord(rows, "2000", "5000")).toEqual({
      chapter_length: "2000",
      chapter_length_max: "5000",
      pacing: "3:1",
    })
    expect(rowsToRecord(rows, "2500", "")).toEqual({
      chapter_length: "2500",
      chapter_length_max: "",
      pacing: "3:1",
    })
  })

  test("保存后重开回显：序列化 → 回填往返一致（空上限保持空串）", () => {
    const saved = rowsToRecord([{ key: "pacing", value: "3:1" }], "2000", "5000")
    expect(parseLengthFields(saved)).toEqual({ lower: "2000", upper: "5000" })

    const savedNoUpper = rowsToRecord([{ key: "pacing", value: "3:1" }], "2500", "")
    expect(parseLengthFields(savedNoUpper)).toEqual({ lower: "2500", upper: "" })
  })

  test("自由行键不污染常驻字段：常驻字段序列化不受自由行影响", () => {
    // 即使自由行里出现同名键（保存前会被 validateRows 拦截），序列化以字段值为准（两键在自由行展开之后混入）
    const rows: StyleRuleRow[] = [{ key: CHAPTER_LENGTH_KEY, value: "9999" }, { key: "pacing", value: "3:1" }]
    const record = rowsToRecord(rows, "2000", "5000")
    expect(record[CHAPTER_LENGTH_KEY]).toBe("2000")
    // 此形态仅在绕过校验时产生；正常保存路径自由行命中两键已被拦截
  })

  test("删除行后序列化不含该键（配合 server 端整体替换语义实现删除落库）", () => {
    const rows = rowsFromRecord({ pacing: "3:1", 章节结构: "四段式" }).filter((row) => row.key !== "章节结构")
    expect(rowsToRecord(rows, "2500", "")).toEqual({ chapter_length: "2500", chapter_length_max: "", pacing: "3:1" })
  })
})
