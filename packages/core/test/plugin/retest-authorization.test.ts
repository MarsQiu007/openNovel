/**
 * 任务 5.2：复测执行授权注册表与确认入参校验测试。
 *
 * 注册表是进程级纯内存结构：签发→逐次消费→绑定校验（跨会话/跨案例/换模型/
 * 换白名单/超次数/跨插件均拒绝）。每个用例前清空注册表保持隔离。
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { RetestAuthorization } from "@opennovel-ai/core/plugin/retest-authorization"

const MODEL = { providerID: "test", modelID: "test-model" }
const TOOLS = ["update_chapter"]

function issue(over: Partial<Parameters<typeof RetestAuthorization.issue>[0]> = {}) {
  return RetestAuthorization.issue({
    sessionID: "ses_origin",
    caseDigest: "digest-a",
    runs: 2,
    model: MODEL,
    expectedTools: TOOLS,
    ...over,
  })
}

const consume = (over: Partial<Parameters<typeof RetestAuthorization.consume>[0]> = {}) =>
  RetestAuthorization.consume({
    id: "ret_missing",
    pluginID: "plugin-a",
    sessionID: "ses_origin",
    caseDigest: "digest-a",
    model: MODEL,
    expectedTools: TOOLS,
    ...over,
  })

beforeEach(() => {
  RetestAuthorization.resetForTests()
})

describe("确认入参校验", () => {
  test("运行次数限 1–20 整数：零/负数/非整数/超过 20 拒绝", () => {
    const base = { question: "复测？", fixVersion: "0.1.24", caseDigest: "digest-a", expectedTools: TOOLS }
    for (const runs of [0, -1, 1.5, 21, Number.NaN]) {
      expect(RetestAuthorization.validateConfirmInput({ ...base, runs })).toBe(false)
    }
    expect(RetestAuthorization.validateConfirmInput({ ...base, runs: 1 })).toBe(true)
    expect(RetestAuthorization.validateConfirmInput({ ...base, runs: 20 })).toBe(true)
  })

  test("空修复版本/空摘要/空问题/空白名单拒绝", () => {
    const base = { question: "复测？", fixVersion: "0.1.24", caseDigest: "digest-a", expectedTools: TOOLS, runs: 3 }
    expect(RetestAuthorization.validateConfirmInput({ ...base, fixVersion: "  " })).toBe(false)
    expect(RetestAuthorization.validateConfirmInput({ ...base, caseDigest: "" })).toBe(false)
    expect(RetestAuthorization.validateConfirmInput({ ...base, question: "" })).toBe(false)
    expect(RetestAuthorization.validateConfirmInput({ ...base, expectedTools: [] })).toBe(false)
    expect(RetestAuthorization.validateConfirmInput({ ...base, expectedTools: ["update_chapter", " "] })).toBe(false)
  })
})

describe("授权消费绑定校验", () => {
  test("签发后逐次消费成功并扣减次数；未知授权拒绝（伪造授权）", () => {
    const issued = issue({ runs: 2 })
    expect(consume({ id: issued.id })).toEqual({ ok: true, remaining: 1 })
    expect(consume({ id: issued.id })).toEqual({ ok: true, remaining: 0 })
    expect(consume({ id: issued.id })).toEqual({ ok: false, reason: "exhausted" })
    expect(consume({ id: "ret_forged" })).toEqual({ ok: false, reason: "unknown-authorization" })
  })

  test("跨会话/跨案例/换模型/换白名单均拒绝，授权不因失败消费被扣减", () => {
    const issued = issue({ runs: 3 })
    expect(consume({ id: issued.id, sessionID: "ses_other" })).toEqual({ ok: false, reason: "session-mismatch" })
    expect(consume({ id: issued.id, caseDigest: "digest-b" })).toEqual({ ok: false, reason: "case-changed" })
    expect(consume({ id: issued.id, model: { providerID: "test", modelID: "other-model" } })).toEqual({
      ok: false,
      reason: "model-changed",
    })
    expect(consume({ id: issued.id, expectedTools: ["update_chapter", "list_chapters"] })).toEqual({
      ok: false,
      reason: "tools-changed",
    })
    expect(RetestAuthorization.lookup(issued.id)?.runsRemaining).toBe(3)
  })

  test("首次消费绑定请求插件，跨插件复用拒绝；同插件可继续消费", () => {
    const issued = issue({ runs: 2 })
    expect(consume({ id: issued.id, pluginID: "plugin-a" })).toEqual({ ok: true, remaining: 1 })
    expect(consume({ id: issued.id, pluginID: "plugin-b" })).toEqual({ ok: false, reason: "plugin-mismatch" })
    expect(consume({ id: issued.id, pluginID: "plugin-a" })).toEqual({ ok: true, remaining: 0 })
    expect(RetestAuthorization.lookup(issued.id)?.pluginID).toBe("plugin-a")
  })
})
