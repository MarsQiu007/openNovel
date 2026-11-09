import { describe, expect, test } from "bun:test"
import { DETECTION_CANDIDATES, detect, type TrajectoryCall } from "../../src/tool-insight/detector.js"
import { issueFingerprint } from "../../src/tool-insight/issue-doc.js"

const call = (overrides: Partial<TrajectoryCall> & { callID: string; tool: string; status: TrajectoryCall["status"] }): TrajectoryCall => ({
  paramKeys: ["chapter_id"],
  ...overrides,
})

describe("轨迹检测六类分类（任务 3.2）", () => {
  test("missing_call：用户报告声明持久化目标但轨迹无对应调用", () => {
    const result = detect({
      trigger: { kind: "missing_call", tool: "" },
      calls: [call({ callID: "c1", tool: "read_setting", status: "success" })],
      expectedTool: "update_chapter",
    })
    expect(result.classification).toBe("unconfirmed")
    expect(result.confirmed).toBe(false)
    expect(result.candidates).toEqual(["agent_misuse", "product_flow"])
    expect(result.fingerprint).toEqual({ tool: "update_chapter", scenario: "missing_call", errorCategory: "user_report", fact: "declared-without-call" })
  })

  test("wrong_tool：另一工具失败后本工具完成目标", () => {
    const result = detect({
      trigger: { kind: "wrong_tool", tool: "search_chapters", errorCategory: "NotFoundError" },
      calls: [
        call({ callID: "c1", tool: "read_chapter_content", status: "failed", errorCategory: "NotFoundError" }),
        call({ callID: "c2", tool: "search_chapters", status: "success" }),
      ],
    })
    expect(result.candidates).toEqual(["agent_misuse", "tool_description_or_params"])
    expect(result.fingerprint.fact).toBe("switch:read_chapter_content->search_chapters")
    expect(result.fingerprint.errorCategory).toBe("NotFoundError")
  })

  test("bad_params：同工具失败后改参数成功", () => {
    const result = detect({
      trigger: { kind: "bad_params", tool: "update_chapter" },
      calls: [
        call({ callID: "c1", tool: "update_chapter", status: "failed", paramKeys: ["content"] }),
        call({ callID: "c2", tool: "update_chapter", status: "success", paramKeys: ["chapter_id", "content"] }),
      ],
    })
    expect(result.candidates).toEqual(["tool_description_or_params", "agent_misuse"])
    expect(result.fingerprint.fact).toBe("params-changed-then-success")
  })

  test("bad_params：参数未变不产生稳定事实", () => {
    const result = detect({
      trigger: { kind: "bad_params", tool: "update_chapter" },
      calls: [
        call({ callID: "c1", tool: "update_chapter", status: "failed", paramKeys: ["content"] }),
        call({ callID: "c2", tool: "update_chapter", status: "success", paramKeys: ["content"] }),
      ],
    })
    expect(result.fingerprint.fact).toBeUndefined()
  })

  test("redundant_repeat：完全相同调用连续重复", () => {
    const result = detect({
      trigger: { kind: "redundant_repeat", tool: "list_chapters" },
      calls: [
        call({ callID: "c1", tool: "list_chapters", status: "success" }),
        call({ callID: "c2", tool: "list_chapters", status: "success" }),
        call({ callID: "c3", tool: "list_chapters", status: "success" }),
      ],
    })
    expect(result.candidates).toEqual(["agent_misuse"])
    // 次数不进指纹：重复 3 次与 4 次同一问题
    expect(result.fingerprint.fact).toBe("same-call-repeated")
    const four = detect({
      trigger: { kind: "redundant_repeat", tool: "list_chapters" },
      calls: [
        call({ callID: "c1", tool: "list_chapters", status: "success" }),
        call({ callID: "c2", tool: "list_chapters", status: "success" }),
        call({ callID: "c3", tool: "list_chapters", status: "success" }),
        call({ callID: "c4", tool: "list_chapters", status: "success" }),
      ],
    })
    expect(four.fingerprint).toEqual(result.fingerprint)
  })

  test("recovery_failed：失败后重试仍失败", () => {
    const result = detect({
      trigger: { kind: "recovery_failed", tool: "update_chapter", errorCategory: "ConflictError" },
      calls: [
        call({ callID: "c1", tool: "update_chapter", status: "failed", errorCategory: "ConflictError" }),
        call({ callID: "c2", tool: "update_chapter", status: "failed", errorCategory: "ConflictError" }),
      ],
    })
    expect(result.candidates).toEqual(["tool_impl_defect", "agent_misuse"])
    expect(result.fingerprint.fact).toBe("retry-still-failed")
  })

  test("recovery_failed：中间成功会重置，不算恢复失败", () => {
    const result = detect({
      trigger: { kind: "recovery_failed", tool: "update_chapter" },
      calls: [
        call({ callID: "c1", tool: "update_chapter", status: "failed" }),
        call({ callID: "c2", tool: "update_chapter", status: "success" }),
        call({ callID: "c3", tool: "update_chapter", status: "failed" }),
      ],
    })
    expect(result.fingerprint.fact).toBeUndefined()
  })

  test("surface_success：核验失败后的固定稳定事实", () => {
    const result = detect({
      trigger: { kind: "surface_success", tool: "update_chapter" },
      calls: [call({ callID: "c1", tool: "update_chapter", status: "success" })],
    })
    expect(result.candidates).toEqual(["tool_result_misread", "tool_impl_defect"])
    expect(result.fingerprint.fact).toBe("verify-failed-after-success")
  })

  test("证据不足：主分类恒未确认且候选属于六类工具问题分类", () => {
    for (const kind of Object.keys(DETECTION_CANDIDATES) as Array<keyof typeof DETECTION_CANDIDATES>) {
      const result = detect({ trigger: { kind, tool: "t" } })
      expect(result.classification).toBe("unconfirmed")
      expect(result.confirmed).toBe(false)
      const allowed = new Set([
        "tool_impl_defect",
        "tool_capability_gap",
        "tool_description_or_params",
        "agent_misuse",
        "tool_result_misread",
        "product_flow",
      ])
      for (const candidate of result.candidates) expect(allowed.has(candidate)).toBe(true)
    }
  })

  test("稳定指纹：模型自由文本、时间、Session、章节名与绝对路径不参与", () => {
    const base = detect({
      trigger: { kind: "recovery_failed", tool: "update_chapter", errorCategory: "ConflictError" },
      calls: [
        call({ callID: "c1", tool: "update_chapter", status: "failed", errorCategory: "ConflictError" }),
        call({ callID: "c2", tool: "update_chapter", status: "failed", errorCategory: "ConflictError" }),
      ],
    })
    // callID 与错误文案不在指纹输入中：换 callID/错误文案形状后指纹一致
    const other = detect({
      trigger: { kind: "recovery_failed", tool: "update_chapter", errorCategory: "ConflictError" },
      calls: [
        call({ callID: "完全不同的会话与调用", tool: "update_chapter", status: "failed", errorCategory: "ConflictError" }),
        call({ callID: "c9", tool: "update_chapter", status: "failed", errorCategory: "ConflictError" }),
      ],
    })
    expect(other.fingerprint).toEqual(base.fingerprint)
    expect(issueFingerprint(base.fingerprint)).toBe(issueFingerprint(other.fingerprint))
    // 指纹不含任何绝对路径形状
    expect(JSON.stringify(base.fingerprint)).not.toMatch(/[A-Za-z]:[\\\\/]/)
  })
})
