/**
 * 设定收件箱纯逻辑辅助函数单测（setting-review-hub 任务 5.1 验证）。
 */
import { describe, expect, test } from "bun:test"
import type { ReviewInboxItem } from "@opennovel-ai/schema/novel"
import {
  badgeDisplayCount,
  buildBatchOrganizePrompt,
  buildHandoffPrompt,
  formatComparison,
  formatOperationErrors,
  groupInboxItems,
  isMergeableSelection,
  kindLabel,
  parseAfterOverride,
  prettyJson,
  sourceLabel,
} from "./setting-review-inbox-data"

function item(partial: Partial<ReviewInboxItem> & Pick<ReviewInboxItem, "id" | "source">): ReviewInboxItem {
  return {
    kind: "character",
    title: "",
    targetId: null,
    summary: "",
    evidence: "",
    before: "",
    after: "",
    status: "pending",
    createdAt: 0,
    sourceChapterId: null,
    reviewNote: "",
    ...partial,
  }
}

const fakeDict: Record<string, string> = {
  "novel.settings.inbox.kind.candidate.character": "角色候选",
  "novel.settings.inbox.kind.staged.update": "更新草案",
  "novel.settings.inbox.source.candidate": "候选条目",
}
const fakeT = ((key: never) => fakeDict[key as string]) as Parameters<typeof kindLabel>[2]

describe("badgeDisplayCount", () => {
  test("返回待审总数，负数收敛为 0", () => {
    expect(badgeDisplayCount({ total: 7 })).toBe(7)
    expect(badgeDisplayCount({ total: 0 })).toBe(0)
  })
})

describe("groupInboxItems", () => {
  test("按 candidate → conflict → staged 顺序分组，空来源不出现", () => {
    const grouped = groupInboxItems([
      item({ id: "s1", source: "staged" }),
      item({ id: "c1", source: "conflict" }),
      item({ id: "a1", source: "candidate" }),
      item({ id: "a2", source: "candidate" }),
    ])
    expect(grouped.map((group) => group.source)).toEqual(["candidate", "conflict", "staged"])
    expect(grouped[0]?.items.map((i) => i.id)).toEqual(["a1", "a2"])
  })

  test("空列表返回空数组", () => {
    expect(groupInboxItems([])).toEqual([])
  })
})

describe("formatOperationErrors", () => {
  test("errors / formatErrors / error 合并为逐条非空行", () => {
    expect(formatOperationErrors({ errors: ["行1", " "], formatErrors: ["格式错"], error: "兜底" })).toEqual([
      "行1",
      "格式错",
      "兜底",
    ])
    expect(formatOperationErrors({})).toEqual([])
  })
})

describe("prettyJson / formatComparison", () => {
  test("对象 JSON 美化缩进，非对象原样字符串化，解析失败原样返回", () => {
    expect(prettyJson('{"title":"a"}')).toBe('{\n  "title": "a"\n}')
    expect(prettyJson("42")).toBe("42")
    expect(prettyJson("{oops")).toBe("{oops")
    expect(prettyJson("")).toBe("")
  })

  test("两边都为空返回 null（无对照区）", () => {
    expect(formatComparison({ before: "", after: "" })).toBeNull()
  })

  test("候选：旧值空、新值展示 payload", () => {
    const cmp = formatComparison({ before: "", after: '{"title":"藏经阁"}' })
    expect(cmp).not.toBeNull()
    expect(cmp?.beforeText).toBe("")
    expect(cmp?.afterText).toContain('"title": "藏经阁"')
  })
})

describe("kindLabel / sourceLabel", () => {
  test("命中字典返回翻译，缺失回退原始值", () => {
    expect(kindLabel("candidate", "character", fakeT)).toBe("角色候选")
    expect(kindLabel("staged", "update", fakeT)).toBe("更新草案")
    expect(kindLabel("candidate", "unknown_kind", fakeT)).toBe("unknown_kind")
    expect(sourceLabel("candidate", fakeT)).toBe("候选条目")
    expect(sourceLabel("conflict", fakeT)).toBe("conflict")
  })
})

describe("buildHandoffPrompt", () => {
  test("拼入条目证据与备注；备注为空时写「无」", () => {
    const prompt = buildHandoffPrompt({
      novelID: "novel-1",
      item: item({
        id: "p1",
        source: "conflict",
        kind: "number_inconsistency",
        title: "青云门",
        targetId: "entry-9",
        summary: "正文称弟子三千，条目记为八百",
        evidence: "数字不一致",
        sourceChapterId: "chap-3",
      }),
      note: "以正文为准",
    })
    expect(prompt).toContain("小说 ID：novel-1")
    expect(prompt).toContain("青云门")
    expect(prompt).toContain("entry-9")
    expect(prompt).toContain("chap-3")
    expect(prompt).toContain("以正文为准")
    expect(prompt).toContain("resolve_conflict")
    expect(prompt).toContain("禁止虚构 ID")
  })

  test("空备注写「无」", () => {
    const prompt = buildHandoffPrompt({
      novelID: "novel-1",
      item: item({ id: "p1", source: "candidate" }),
      note: "   ",
    })
    expect(prompt).toContain("用户备注：无")
  })
})

describe("buildBatchOrganizePrompt", () => {
  test("批处理编排指令指向 batch 动作与收件箱落点", () => {
    const prompt = buildBatchOrganizePrompt("novel-2")
    expect(prompt).toContain("小说 ID：novel-2")
    expect(prompt).toContain('organize_settings(action="batch")')
    expect(prompt).toContain("新增 N 条待审")
    expect(prompt).toContain("deduplicate_characters(dry_run=true)")
  })
})

describe("parseAfterOverride", () => {
  test("空输入 / 非法 JSON / 非对象分别报原因码", () => {
    expect(parseAfterOverride("")).toEqual({ ok: false, reason: "empty" })
    expect(parseAfterOverride("   ")).toEqual({ ok: false, reason: "empty" })
    expect(parseAfterOverride("{oops")).toEqual({ ok: false, reason: "invalid" })
    expect(parseAfterOverride("[1,2]")).toEqual({ ok: false, reason: "not-object" })
    expect(parseAfterOverride("null")).toEqual({ ok: false, reason: "not-object" })
  })

  test("合法对象返回解析值", () => {
    const parsed = parseAfterOverride(' {"title":"新标题"} ')
    expect(parsed).toEqual({ ok: true, value: { title: "新标题" } })
  })
})

describe("isMergeableSelection", () => {
  test("至少 2 条且全为候选才可合并", () => {
    expect(isMergeableSelection([])).toBe(false)
    expect(isMergeableSelection([item({ id: "a", source: "candidate" })])).toBe(false)
    expect(
      isMergeableSelection([item({ id: "a", source: "candidate" }), item({ id: "b", source: "candidate" })]),
    ).toBe(true)
    expect(
      isMergeableSelection([item({ id: "a", source: "candidate" }), item({ id: "b", source: "staged" })]),
    ).toBe(false)
  })
})
