/**
 * style-rules-model 纯函数单测（style-editor-structure）。
 *
 * 纯 .ts 测试，不 import .tsx（规避本地 bun 1.4.3 的 solid JSX 回归）。
 * 覆盖：归一化后历史数据回填、「其他」区兜底不丢失、三类校验拦截、
 * 回填-序列化往返一致、篇幅限制复选框混入语义。
 */
import { describe, expect, test } from "bun:test"
import {
  LENGTH_LIMIT_KEY,
  OTHER_SECTION_TITLE,
  groupRowsBySection,
  rowsFromRecord,
  rowsToRecord,
  validateRows,
  type StyleRuleRow,
} from "./style-rules-model"

describe("rowsFromRecord 回填", () => {
  test("排除保留键，其余按库中顺序转为规则行", () => {
    const rows = rowsFromRecord({ chapter_length_limit: "true", pacing: "3:1", 章节字数: "3000" })
    expect(rows).toEqual([
      { key: "pacing", value: "3:1" },
      { key: "章节字数", value: "3000" },
    ])
    expect(rows.some((row) => row.key === LENGTH_LIMIT_KEY)).toBe(false)
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

  test("保留键行被拦截", () => {
    const issues = validateRows([{ key: LENGTH_LIMIT_KEY, value: "true" }])
    expect(issues.get(0)).toBe("reserved_key")
  })

  test("值为空串合法（清空值是合法意图），仅键参与校验", () => {
    const issues = validateRows([{ key: "pacing", value: "" }])
    expect(issues.size).toBe(0)
  })
})

describe("rowsToRecord 序列化与往返一致", () => {
  test("复选框状态以字符串混入保留键", () => {
    const rows: StyleRuleRow[] = [{ key: "pacing", value: "3:1" }]
    expect(rowsToRecord(rows, true)[LENGTH_LIMIT_KEY]).toBe("true")
    expect(rowsToRecord(rows, false)[LENGTH_LIMIT_KEY]).toBe("false")
  })

  test("回填 → 序列化往返一致（复选框状态独立往返）", () => {
    const original = { chapter_length_limit: "true", pacing: "3:1", "异能体系.等级严格": "先定级后突破" }
    const rows = rowsFromRecord(original)
    const roundTrip = rowsToRecord(rows, original[LENGTH_LIMIT_KEY] === "true")
    expect(roundTrip).toEqual(original)
  })

  test("删除行后序列化不含该键（配合 server 端整体替换语义实现删除落库）", () => {
    const rows = rowsFromRecord({ pacing: "3:1", 章节字数: "3000" }).filter((row) => row.key !== "章节字数")
    expect(rowsToRecord(rows, false)).toEqual({ chapter_length_limit: "false", pacing: "3:1" })
  })
})
