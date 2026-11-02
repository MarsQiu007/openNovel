// 按 source.callID 配对 Judged 与人审结论（Asked → Replied 链）计算裁判一致率。
// 纯函数：不订阅事件、不碰 store，调用方（审批面板数据层）传入会话事件流即可。
// 配对链：Judged.source.callID → Asked.source.callID → Replied.requestID（Asked.id）。
// wire 事件最小投影，避免拖入 sdk 生成类型链。

export interface JudgedProperties {
  readonly sessionID: string
  readonly action: string
  readonly decision: "allow" | "deny" | "ask"
  readonly mode: "judge-shadow" | "judge"
  readonly reason?: string
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
}

export interface AskedProperties {
  readonly id: string
  readonly sessionID: string
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
}

export interface RepliedProperties {
  readonly sessionID: string
  readonly requestID: string
  readonly reply: "once" | "always" | "reject"
}

export type PermissionJudgeEvent =
  | { readonly type: "permission.v2.judged"; readonly properties: JudgedProperties }
  | { readonly type: "permission.v2.asked"; readonly properties: AskedProperties }
  | { readonly type: "permission.v2.replied"; readonly properties: RepliedProperties }

export interface JudgePairing {
  readonly callID: string
  readonly sessionID: string
  readonly judge: { readonly decision: "allow" | "deny" | "ask"; readonly mode: "judge-shadow" | "judge"; readonly reason?: string }
  readonly human?: { readonly effect: "allow" | "deny"; readonly reply: "once" | "always" | "reject" }
}

export interface JudgeAgreement {
  /** 裁判与人审都有结论的配对数 */
  readonly paired: number
  /** 判定一致（allow/deny 相同）数 */
  readonly agreed: number
  /** 判定相反数 */
  readonly disagreed: number
  /** 裁判判 ask 但人审已给结论数（ fail-closed 样本，不计入一致/分歧） */
  readonly judgeUndecided: number
  /** 无 source.callID 或链不到人审结论的 Judged 数 */
  readonly orphanJudged: number
  /** 配对明细，按 callID 去重（同 callID 多次裁判取最后一次） */
  readonly pairs: readonly JudgePairing[]
}

const humanEffect = (reply: "once" | "always" | "reject"): "allow" | "deny" =>
  reply === "reject" ? "deny" : "allow"

export function pairJudgeEvents(events: readonly PermissionJudgeEvent[]): JudgeAgreement {
  const askedByCallID = new Map<string, AskedProperties>()
  const repliedByRequestID = new Map<string, RepliedProperties>()
  for (const event of events) {
    if (event.type === "permission.v2.asked" && event.properties.source)
      askedByCallID.set(event.properties.source.callID, event.properties)
    if (event.type === "permission.v2.replied")
      repliedByRequestID.set(event.properties.requestID, event.properties)
  }

  let paired = 0
  let agreed = 0
  let disagreed = 0
  let judgeUndecided = 0
  let orphanJudged = 0
  const byCallID = new Map<string, JudgePairing>()

  for (const event of events) {
    if (event.type !== "permission.v2.judged") continue
    const judged = event.properties
    if (!judged.source) {
      orphanJudged++
      continue
    }
    const asked = askedByCallID.get(judged.source.callID)
    const replied = asked ? repliedByRequestID.get(asked.id) : undefined
    if (!replied) {
      orphanJudged++
      continue
    }
    const human = { effect: humanEffect(replied.reply), reply: replied.reply }
    byCallID.set(judged.source.callID, {
      callID: judged.source.callID,
      sessionID: judged.sessionID,
      judge: { decision: judged.decision, mode: judged.mode, reason: judged.reason },
      human,
    })
    if (judged.decision === "ask") {
      judgeUndecided++
      continue
    }
    paired++
    if (human.effect === judged.decision) agreed++
    else disagreed++
  }

  return { paired, agreed, disagreed, judgeUndecided, orphanJudged, pairs: Array.from(byCallID.values()) }
}
