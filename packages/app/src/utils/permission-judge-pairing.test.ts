import { describe, expect, test } from "bun:test"
import { pairJudgeEvents, type PermissionJudgeEvent } from "./permission-judge-pairing"

const asked = (id: string, callID: string): PermissionJudgeEvent => ({
  type: "permission.v2.asked",
  properties: {
    id,
    sessionID: "ses_test",
    source: { type: "tool", messageID: "msg_1", callID },
  },
})

const replied = (requestID: string, reply: "once" | "always" | "reject"): PermissionJudgeEvent => ({
  type: "permission.v2.replied",
  properties: { sessionID: "ses_test", requestID, reply },
})

const judged = (
  callID: string | undefined,
  decision: "allow" | "deny" | "ask",
  reason?: string,
): PermissionJudgeEvent => ({
  type: "permission.v2.judged",
  properties: {
    sessionID: "ses_test",
    action: "bash",
    decision,
    mode: "judge-shadow",
    reason,
    source: callID === undefined ? undefined : { type: "tool", messageID: "msg_1", callID },
  },
})

describe("pairJudgeEvents", () => {
  test("配对命中且判定一致", () => {
    const result = pairJudgeEvents([
      asked("per_1", "call_1"),
      judged("call_1", "allow", "只读命令"),
      replied("per_1", "once"),
    ])
    expect(result.paired).toBe(1)
    expect(result.agreed).toBe(1)
    expect(result.disagreed).toBe(0)
    expect(result.orphanJudged).toBe(0)
    expect(result.pairs).toEqual([
      {
        callID: "call_1",
        sessionID: "ses_test",
        judge: { decision: "allow", mode: "judge-shadow", reason: "只读命令" },
        human: { effect: "allow", reply: "once" },
      },
    ])
  })

  test("人审 reject 记为分歧", () => {
    const result = pairJudgeEvents([
      asked("per_1", "call_1"),
      judged("call_1", "allow"),
      replied("per_1", "reject"),
    ])
    expect(result.paired).toBe(1)
    expect(result.agreed).toBe(0)
    expect(result.disagreed).toBe(1)
  })

  test("人审 always 与裁判 deny 判定相反", () => {
    const result = pairJudgeEvents([
      asked("per_1", "call_1"),
      judged("call_1", "deny", "会删除工程目录"),
      replied("per_1", "always"),
    ])
    expect(result.disagreed).toBe(1)
    expect(result.pairs[0]?.human).toEqual({ effect: "allow", reply: "always" })
  })

  test("裁判 ask 计入 judgeUndecided 不计入一致分歧", () => {
    const result = pairJudgeEvents([
      asked("per_1", "call_1"),
      judged("call_1", "ask", "不确定"),
      replied("per_1", "once"),
    ])
    expect(result.paired).toBe(0)
    expect(result.judgeUndecided).toBe(1)
    expect(result.agreed).toBe(0)
    expect(result.disagreed).toBe(0)
  })

  test("孤儿事件：无 source 或链不到人审结论", () => {
    const result = pairJudgeEvents([
      judged(undefined, "allow"),
      judged("call_orphan", "allow"),
      asked("per_1", "call_1"),
      judged("call_1", "allow"),
    ])
    expect(result.orphanJudged).toBe(3)
    expect(result.paired).toBe(0)
  })

  test("同 callID 多次裁判取最后一次", () => {
    const result = pairJudgeEvents([
      asked("per_1", "call_1"),
      judged("call_1", "allow"),
      judged("call_1", "deny", "改判"),
      replied("per_1", "once"),
    ])
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]?.judge.decision).toBe("deny")
    expect(result.disagreed).toBe(1)
  })

  test("空事件流", () => {
    expect(pairJudgeEvents([])).toEqual({
      paired: 0,
      agreed: 0,
      disagreed: 0,
      judgeUndecided: 0,
      orphanJudged: 0,
      pairs: [],
    })
  })
})
