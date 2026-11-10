/**
 * 工具改进日志证据层测试：稳定 ID、字段白名单脱敏、长度上限、正文例外双授权。
 */
import { describe, expect, test } from "bun:test"
import {
  createContentException,
  createUlid,
  deriveCallOccurrenceID,
  deriveEvidenceID,
  deriveTurnOccurrenceID,
  grantContentModelUse,
  modelVisibleContent,
  redactSummary,
  redactToolCalled,
  redactToolFailed,
  redactToolSuccess,
  TOOL_INSIGHT_SUMMARY_MAX_CHARS,
  type ToolInsightContentException,
} from "../../src/tool-insight/evidence"

const ULID_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/

describe("createUlid", () => {
  test("形状合法且跨调用不重复", () => {
    const seen = new Set<string>()
    for (let index = 0; index < 500; index++) {
      const id = createUlid()
      expect(id).toMatch(ULID_PATTERN)
      seen.add(id)
    }
    expect(seen.size).toBe(500)
  })

  test("时间前缀按给定毫秒编码，跨重启不重用", () => {
    const id = createUlid(1730000000000)
    const restored = Array.from(id.slice(0, 10)).reduce(
      (acc, char) => acc * 32 + "0123456789ABCDEFGHJKMNPQRSTVWXYZ".indexOf(char),
      0,
    )
    expect(restored).toBe(1730000000000)
    expect(createUlid(1730000000000)).not.toBe(id)
  })
})

describe("派生 ID", () => {
  test("自动证据 ID 确定性派生且区分项目与证据种类", () => {
    const base = { projectID: "proj-1", eventID: "evt_1", kind: "tool_failed" as const }
    expect(deriveEvidenceID(base)).toBe(deriveEvidenceID({ ...base }))
    expect(deriveEvidenceID(base)).not.toBe(deriveEvidenceID({ ...base, eventID: "evt_2" }))
    expect(deriveEvidenceID(base)).not.toBe(deriveEvidenceID({ ...base, kind: "tool_success" as const }))
    // 跨项目同 callID 不串线
    expect(deriveEvidenceID(base)).not.toBe(deriveEvidenceID({ ...base, projectID: "proj-2" }))
  })

  test("发生实例 ID：单次调用按 callID 稳定，turn 按 assistantMessageID+目标 稳定", () => {
    const call = { projectID: "p", sessionID: "s", callID: "c1", fingerprint: "fp" }
    expect(deriveCallOccurrenceID(call)).toBe(deriveCallOccurrenceID(call))
    expect(deriveCallOccurrenceID(call)).not.toBe(deriveCallOccurrenceID({ ...call, callID: "c2" }))

    const turn = { projectID: "p", sessionID: "s", assistantMessageID: "m1", goal: "保存章节", fingerprint: "fp" }
    expect(deriveTurnOccurrenceID(turn)).toBe(deriveTurnOccurrenceID(turn))
    expect(deriveTurnOccurrenceID(turn)).not.toBe(deriveTurnOccurrenceID({ ...turn, goal: "保存设定" }))
  })
})

describe("字段白名单脱敏", () => {
  test("tool_called 只保留参数键集合与非内容枚举，完整参数不落盘", () => {
    const fields = redactToolCalled("update_chapter", {
      chapter_id: "ch-1",
      mode: "replace",
      content: "第一千章 正文原文……",
      api_key: "sk-should-not-appear",
    })
    expect(fields.tool).toBe("update_chapter")
    expect(fields.paramKeys).toEqual(["api_key", "chapter_id", "content", "mode"])
    const serialized = JSON.stringify(fields)
    expect(serialized).not.toContain("正文原文")
    expect(serialized).not.toContain("sk-should-not-appear")
    // mode 属安全枚举键
    expect(fields.paramEnums).toEqual({ mode: "replace" })
  })

  test("tool_failed 保留错误类型/错误码与脱敏摘要，密钥与绝对路径不落盘", () => {
    const fields = redactToolFailed("write_file", new Error('failed to write D:\\books\\原书\\第一千章.md: api_key=abcd1234'))
    expect(fields.tool).toBe("write_file")
    expect(fields.errorType).toBe("Error")
    const serialized = JSON.stringify(fields)
    expect(serialized).not.toContain("abcd1234")
    expect(serialized).not.toContain("D:\\books")
    expect(String(fields.errorDigest)).toContain("<path:")
    expect(String(fields.errorDigest)).toContain("api_key=<redacted>")
  })

  test("tool_success 不保存 result/content 原文，只保留类别与核验标识", () => {
    const fields = redactToolSuccess("update_chapter", ["D:/books/novel.db", "out.log"], ["chapter_version"])
    expect(fields.success).toBe(true)
    const serialized = JSON.stringify(fields)
    expect(serialized).not.toContain("D:/books")
    expect(fields.outputKinds).toEqual(["db", "log"])
    expect(fields.statusKeys).toEqual(["chapter_version"])
  })

  test("摘要超长按上限截断", () => {
    const long = "x".repeat(1000)
    const summary = redactSummary(long)
    expect(summary.length).toBeLessThanOrEqual(TOOL_INSIGHT_SUMMARY_MAX_CHARS + 10)
    expect(summary).toContain("截断")
  })
})

describe("正文例外与双授权", () => {
  const fragment = "第三卷 第十七章 开头片段……"

  function exception(): ToolInsightContentException {
    return createContentException({ text: fragment, retainedAt: 1730000000000 })
  }

  test("仅本地保留时片段对模型不可见", () => {
    const exc = exception()
    expect(exc.shareWarning).toBe(true)
    expect(exc.retainedAt).toBe(1730000000000)
    expect(exc.grants).toEqual([])
    expect(modelVisibleContent(exc, { purpose: "organize", subjectDigest: "any" })).toBeUndefined()
  })

  test("授权片段按用途与摘要绑定，跨用途/跨案例/跨模型不生效", () => {
    const exc = exception()
    const grant = grantContentModelUse(exc, {
      purpose: "organize",
      subjectDigest: "digest-1",
      providerID: "anthropic",
      modelID: "claude-2",
    })
    expect(grant.id).toMatch(/^cgr_/)
    expect(modelVisibleContent(exc, { purpose: "organize", subjectDigest: "digest-1" })).toBe(fragment)
    expect(modelVisibleContent(exc, { purpose: "organize", subjectDigest: "digest-2" })).toBeUndefined()
    expect(modelVisibleContent(exc, { purpose: "retest", subjectDigest: "digest-1" })).toBeUndefined()
    expect(
      modelVisibleContent(exc, {
        purpose: "organize",
        subjectDigest: "digest-1",
        providerID: "openai",
        modelID: "gpt-9",
      }),
    ).toBeUndefined()
  })
})
