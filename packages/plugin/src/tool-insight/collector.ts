/**
 * 事件证据采集器（任务 3.1）：订阅 V2 会话事件流，把失败、轨迹形状与真实状态
 * 落成脱敏证据并入问题文档。
 *
 * 归属与关联：
 * - 会话→项目归属只认 `session.next.created` 观察值（有界映射）；未见 created 的
 *   会话无法归属本项目，不采集。日志根按当前设置每次解析，目录变更只影响新证据。
 * - callID 只在同项目、同会话内关联，映射键 `projectID + sessionID + callID`。
 * - provider turn 以 `step.started` 的 assistantMessageID 开启、`step.ended/failed`
 *   关闭；触发时刻 turn 仍开放时先落证据（客观证据先行），turn 关闭后补齐完整轨迹。
 *   宿主按事件类型分订阅流投递，跨流不保证先序：tool.* 可能先于同 turn 的
 *   step.started 到达，下一 turn 的 step.started 也可能先于上一 turn 迟到的
 *   tool.* 处理（慢落盘放大流间延迟）。窗口按 session+turn 复合键隔离、按事件自带
 *   assistantMessageID 懒建，迟到 step.started 只合并回填 agent/model；任一 turn 的
 *   迟到事件都落回自己 turn 的窗口，跨 turn 交错不丢轨迹判定。
 *
 * 落盘与建档分工：
 * - tool.failed 恒落 tool_failed 证据并按「单次调用问题」（call 级发生实例）建档；
 * - 六类轨迹形状（无意义重复、恢复失败、改参成功、换工具成功、表面成功）在归纳
 *   命中时落 trajectory 证据并按「turn 轨迹问题」（turn 级发生实例）建档；
 *   同一轮内「先发后收」的批量并行形态（D6 发出序配对）不参与重复/恢复/表面成功归纳。
 * - 注册了核验适配器的工具成功时做只读真实状态核验，恒落 real_state 证据；
 *   核验失败再按表面成功建档——正常成功只存证据，不产生任何问题文档。
 * - turn 关闭时对本 turn 落过失败证据的调用补齐 trajectory 证据：证据追加进同一
 *   call 级文档，发生实例不变，出现次数不重复计数。
 *
 * 开关按事件逐次经窄解析器读取（不使用过期快照）；未启用、内部会话事件、无法
 * 归属的事件一律静默跳过。任何落盘失败都只警告，不阻断事件流。
 */
import { Effect, Scope, Stream } from "effect"
import { readToolInsightJsonl, type ToolInsightPaths } from "@opennovel-ai/novel-store"
import { appendEvidenceUnderLock, appendSignalUnderLock } from "./evidence-store.js"
import {
  deriveCallOccurrenceID,
  deriveEvidenceID,
  deriveTurnOccurrenceID,
  isRecord,
  redactParamIdentifiers,
  redactSummary,
  redactToolFailed,
  type ToolInsightEvidence,
} from "./evidence.js"
import { detect, type DetectionKind, type TrajectoryCall } from "./detector.js"
import { isInternalEvent } from "./filter.js"
import { openToolInsightGate } from "./gate.js"
import { issueFingerprint, type ToolInsightFingerprintInput } from "./issue-doc.js"
import { ingestEvidenceIssue } from "./issue-store.js"
import {
  createToolInsightOwnership,
  type ToolInsightOwnership,
  type ToolInsightSessionOwnership,
} from "./ownership.js"
import {
  classifyNegativePrompt,
  deriveSignalID,
  deriveSignalOccurrenceID,
} from "./signal-store.js"
import { findToolInsightVerifyAdapter } from "./verify.js"
import { isToolErrorCategory } from "../v2/effect/tool-failure.js"
import type { PluginContext } from "../v2/effect/context.js"

/** 反复修改信号的兴趣工具：连续成功达到阈值提示同目标反复修改 */
const REVISION_TOOLS = new Set(["revise_chapter", "restore_chapter_version", "update_chapter"])
const REVISION_STREAK_THRESHOLD = 3

/** 有界窗口上限：超限淘汰最早条目，不保存无限 Map */
const MAX_SESSIONS = 512
const MAX_CALLS = 1024
/** 存活 turn 窗口全局上限（跨会话合计；每会话通常 1-2 个活跃窗口） */
const MAX_TURNS = 128
const MAX_CALLS_PER_TURN = 32

const callKey = (projectID: string, sessionID: string, callID: string): string => `${projectID}\u0000${sessionID}\u0000${callID}`
const turnKey = (sessionID: string, turnID: string): string => `${sessionID}\u0000${turnID}`

interface CallInfo {
  tool: string
  paramKeys: string[]
  turnID?: string
  agent?: string
  model?: string
  /** 成功时提取的核验标识（ID 类标量） */
  verifyIdentifiers?: Record<string, string>
  /** 脱敏标识符摘要（D10）：ID 形态参数键的短标识值，失败证据与 paramKeys 并存 */
  identifiers?: Record<string, string>
  /** 进程内单调发出序号：批量兄弟配对的时序信号（D6） */
  issueSeq: number
  /** 发出时同工具已有兄弟调用在途：批量「先发后收」成员标记 */
  batchIssued: boolean
}

interface TurnWindow {
  turnID: string
  agent?: string
  model?: string
  calls: TrajectoryCall[]
  /** 本 turn 已落盘失败证据的 callID → 失败类别：turn 关闭时按它用一致指纹补齐轨迹 */
  failedCalls: Map<string, string>
  /** 同工具未完成 callID → 发出序号：批量兄弟配对（D6） */
  inFlightByTool: Map<string, Map<string, number>>
  /** step.ended/failed 已处理过补齐：跨流重复 settle 不重复落补齐轨迹 */
  settled?: boolean
}

export interface CollectorState {
  onCreated(properties: { sessionID: string; projectID: string; directory: string }): Promise<void>
  onPromptAdmitted(
    properties: { sessionID: string; messageID: string; prompt: { text: string } },
    envelopeID: string,
  ): Promise<void>
  onStepStarted(properties: { sessionID: string; assistantMessageID: string; agent: string; model: { id: string } }): Promise<void>
  /** envelopeID：宿主事件信封 ID（跨重启不重用），落盘证据的派生 ID 以它为种子 */
  onStepSettled(properties: { sessionID: string; assistantMessageID: string }, envelopeID: string): Promise<void>
  onToolCalled(properties: { sessionID: string; assistantMessageID: string; callID: string; tool: string; input: unknown }, envelopeID: string): Promise<void>
  onToolSuccess(properties: { sessionID: string; assistantMessageID: string; callID: string; structured: unknown }, envelopeID: string): Promise<void>
  onToolFailed(properties: { sessionID: string; assistantMessageID: string; callID: string; error: unknown }, envelopeID: string): Promise<void>
}

export interface WatchToolInsightInput {
  ctx: PluginContext
  /** 与 tool_insight 共享的会话归属解析器；测试和既有调用可省略 */
  ownership?: ToolInsightOwnership
  /** 本插件实例的 Location 目录：项目归属判定与日志根解析兜底 */
  projectDirectory: string
  /** 证据落盘并摄取进问题文档后的整理信号：归因整理队列按指纹合并发车 */
  onDocumented?: (fingerprint: string, sessionID: string) => void
}

function warnOnce(seen: Set<string>, message: string) {
  if (seen.has(message)) return
  seen.add(message)
  console.warn(`[tool-insight] ${message}`)
}

export function createCollectorState(input: WatchToolInsightInput): CollectorState {
  const { ctx, projectDirectory } = input
  const warnings = new Set<string>()
  let bootstrapped = false
  const ownership = input.ownership ?? createToolInsightOwnership({ ctx, projectDirectory })
  const callByKey = new Map<string, CallInfo>()
  /** 存活 turn 窗口：复合键 session+turn，跨订阅流交错的迟到事件落回各自 turn */
  const turns = new Map<string, TurnWindow>()
  /** 每会话最近开启的 turnID：agentFor 兜底与迟到 step.started 的合并锚点 */
  const latestTurnBySession = new Map<string, string>()
  const revisionStreak = new Map<string, { tool: string; count: number }>()
  /** 进程内单调发出序号计数器：CallInfo.issueSeq 的来源（D6） */
  let issueSeqCounter = 0

  const boundedSet = <K>(map: Map<K, unknown>, limit: number) => {
    while (map.size > limit) {
      const oldest = map.keys().next().value
      if (oldest === undefined) return
      map.delete(oldest)
    }
  }

  /** 按会话持久归属打开开关；无法确认真实归属时不使用当前 Location 兜底 */
  const gateFor = (resolved: ToolInsightSessionOwnership | undefined): { paths: ToolInsightPaths; projectID: string } | undefined => {
    if (resolved === undefined) return undefined
    const opened = openToolInsightGate({
      configDir: ctx.paths.config,
      projectDirectory: resolved.directory,
      // 日志根的项目隔离哈希恒用项目目录（与 tool_insight 工具入口一致，跨重启稳定）
      projectID: resolved.projectID,
      warnOnce: (message) => warnOnce(warnings, message),
    })
    if (opened === undefined) return undefined
    bootstrap(opened.paths)
    return { paths: opened.paths, projectID: resolved.projectID }
  }

  const resolveGate = async (sessionID: string) => gateFor(await ownership.resolve(sessionID))

  /** 首次启用时的全量解析：只确认可读性并对中部损坏告警；追加纪律由写入路径逐次保证 */
  const bootstrap = (paths: ToolInsightPaths) => {
    if (bootstrapped) return
    bootstrapped = true
    const initial = readToolInsightJsonl(paths.evidence)
    if (initial.corruptLines > 0) {
      warnOnce(warnings, `证据文件中部损坏 ${initial.corruptLines} 行：保留原文件并停止追加，等待人工处理`)
    }
  }

  const agentFor = (sessionID: string): string | undefined => {
    const turnID = latestTurnBySession.get(sessionID)
    return turnID === undefined ? undefined : turns.get(turnKey(sessionID, turnID))?.agent
  }

  /**
   * 取调用的 turn 窗口：按 session+turn 复合键懒建，永不替换其他 turn 的窗口。
   * 宿主分类型订阅流不保证先序：下一 turn 的 step.started 可能先于上一 turn 迟到的
   * tool.* 处理，复合键让迟到事件落回自己 turn 的窗口，跨 turn 交错不丢轨迹判定。
   */
  const windowFor = (sessionID: string, turnID: string): TurnWindow => {
    const key = turnKey(sessionID, turnID)
    const existing = turns.get(key)
    if (existing !== undefined) return existing
    const created: TurnWindow = {
      turnID,
      agent: undefined,
      model: undefined,
      calls: [],
      failedCalls: new Map(),
      inFlightByTool: new Map(),
    }
    turns.set(key, created)
    boundedSet(turns, MAX_TURNS)
    return created
  }

  /**
   * 批量兄弟配对（D6）：本调用发出时有同工具兄弟在途（batchIssued），或结算时仍有
   * 发出晚于自己的同工具兄弟在途 → 属于「同一轮内先发后收」的批量并行形态。批量
   * 形态不参与无意义重复、恢复失败与表面成功归纳（spec：仅成功返回后的同参重试计入）。
   */
  const isBatchMember = (turn: TurnWindow, tool: string, callID: string, info: CallInfo): boolean => {
    if (info.batchIssued) return true
    const siblings = turn.inFlightByTool.get(tool)
    if (siblings === undefined) return false
    for (const [otherCallID, otherSeq] of siblings) {
      if (otherCallID !== callID && otherSeq > info.issueSeq) return true
    }
    return false
  }

  /** 结算时从在途集合摘除（callByKey 淘汰后 tool 未知，按 callID 全扫兜底） */
  const removeFromInFlight = (turn: TurnWindow, callID: string) => {
    for (const siblings of turn.inFlightByTool.values()) siblings.delete(callID)
  }

  const recordTurnDetection = async (
    ctx2: PluginContext,
    paths: ToolInsightPaths,
    projectID: string,
    sessionID: string,
    turn: TurnWindow,
    kind: DetectionKind,
    trigger: { tool: string; errorCategory?: string },
    envelopeID: string,
    ts: number,
  ) => {
    const detection = detect({ trigger: { kind, ...trigger }, calls: turn.calls })
    const fingerprintHash = issueFingerprint(detection.fingerprint)
    const evidenceID = deriveEvidenceID({ projectID, eventID: envelopeID, kind: "trajectory" })
    const occurrenceID = deriveTurnOccurrenceID({
      projectID,
      sessionID,
      assistantMessageID: turn.turnID,
      goal: kind,
      fingerprint: fingerprintHash,
    })
    const record: ToolInsightEvidence = {
      id: evidenceID,
      ts,
      kind: "trajectory",
      projectID,
      sessionID,
      turnID: turn.turnID,
      agent: turn.agent,
      model: turn.model,
      trigger: "auto",
      occurrenceID,
      fields: {
        tool: trigger.tool,
        detection: kind,
        candidates: [...detection.candidates],
        callsShape: detection.factDetail,
        // 文档归属键：启动对账按它把孤儿证据确定性摄取回问题文档（无归属键的证据不参与对账）
        fingerprint: fingerprintHash,
        issue: { tool: trigger.tool, scenario: kind, errorCategory: detection.fingerprint.errorCategory },
      },
    }
    const appended = await appendEvidenceUnderLock(ctx2.file, paths, [record], { dedupe: true })
    if (!appended.appended) {
      if (appended.reason !== "duplicate") warnOnce(warnings, `轨迹证据落盘未完成（${appended.reason}），本条跳过`)
      return
    }
    await ingestEvidenceIssue(ctx2.file, paths, {
      fingerprint: fingerprintHash,
      evidenceID,
      occurrenceID,
      evidenceKind: "trajectory",
      occurredAt: ts,
      facts: detection.fingerprint satisfies ToolInsightFingerprintInput,
    })
    input.onDocumented?.(fingerprintHash, sessionID)
  }

  const recordCallFailure = async (
    ctx2: PluginContext,
    paths: ToolInsightPaths,
    projectID: string,
    sessionID: string,
    callID: string,
    info: CallInfo | undefined,
    error: unknown,
    envelopeID: string,
    ts: number,
  ) => {
    const tool = info?.tool ?? "unknown"
    const fields = redactToolFailed(tool, error)
    if (info?.paramKeys?.length) fields.paramKeys = info.paramKeys
    // 脱敏标识符摘要（D10）：与 paramKeys 并存，定位失败目标对象；完整参数值不落盘
    if (info?.identifiers !== undefined) fields.paramIdentifiers = info.identifiers
    const fingerprintInput: ToolInsightFingerprintInput = {
      tool,
      scenario: "tool_failure",
      errorCategory:
        typeof fields.errorType === "string" && isToolErrorCategory(fields.errorType) ? fields.errorType : "unknown",
    }
    const fingerprintHash = issueFingerprint(fingerprintInput)
    const evidenceID = deriveEvidenceID({ projectID, eventID: envelopeID, kind: "tool_failed" })
    const occurrenceID = deriveCallOccurrenceID({ projectID, sessionID, callID, fingerprint: fingerprintHash })
    const record: ToolInsightEvidence = {
      id: evidenceID,
      ts,
      kind: "tool_failed",
      projectID,
      sessionID,
      callID,
      turnID: info?.turnID,
      agent: info?.agent ?? agentFor(sessionID),
      model: info?.model,
      trigger: "auto",
      occurrenceID,
      fields: { ...fields, fingerprint: fingerprintHash, issue: fingerprintInput },
    }
    const appended = await appendEvidenceUnderLock(ctx2.file, paths, [record], { dedupe: true })
    if (!appended.appended) {
      if (appended.reason !== "duplicate") warnOnce(warnings, `失败证据落盘未完成（${appended.reason}），本条跳过`)
      return undefined
    }
    await ingestEvidenceIssue(ctx2.file, paths, {
      fingerprint: fingerprintHash,
      evidenceID,
      occurrenceID,
      evidenceKind: "tool_failed",
      occurredAt: ts,
      facts: fingerprintInput,
    })
    input.onDocumented?.(fingerprintHash, sessionID)
    return occurrenceID
  }

  /** 六类形状归纳：失败/成功时刻按本 turn 的轨迹判定检测类别，未命中返回 undefined */
  const classifyShape = (sessionID: string, turnID: string, tool: string, status: "success" | "failed"): { kind: DetectionKind } | undefined => {
    const turn = turns.get(turnKey(sessionID, turnID))
    if (turn === undefined) return undefined
    // 排除 called：同一次调用的 called+failed 是同一调用的两个阶段，不构成「重复调用」。
    // 排除 overlapped：批量兄弟条目不参与形状归纳（D6），批量失败不镜像误报
    const sameTool = turn.calls.filter((call) => call.tool === tool && call.status !== "called" && !call.overlapped)
    const sameKeyTail = (list: TrajectoryCall[]) => {
      if (list.length < 2) return false
      const last = list[list.length - 1]
      const previous = list[list.length - 2]
      return (
        last !== undefined &&
        previous !== undefined &&
        previous.tool === last.tool &&
        (previous.paramKeys ?? []).join(",") === (last.paramKeys ?? []).join(",")
      )
    }
    if (status === "failed") {
      if (sameKeyTail(sameTool)) return { kind: "redundant_repeat" }
      if (sameTool.filter((call) => call.status === "failed").length >= 2) return { kind: "recovery_failed" }
      return undefined
    }
    // success 归纳：同工具先败后成且参数键集合变化 → 改参成功；其他工具失败后本工具成功 → 换工具
    const failedSame = sameTool.some((call) => call.status === "failed")
    if (failedSame) {
      const failedKeys = sameTool.find((call) => call.status === "failed")?.paramKeys ?? []
      const successKeys = sameTool.find((call) => call.status === "success")?.paramKeys ?? []
      if (failedKeys.join(",") !== successKeys.join(",")) return { kind: "bad_params" }
    }
    if (turn.calls.some((call) => call.tool !== tool && call.status === "failed")) return { kind: "wrong_tool" }
    return undefined
  }

  const state: CollectorState = {
    async onCreated(properties) {
      ownership.observeCreated(properties)
    },

    async onPromptAdmitted(properties, envelopeID) {
      const opened = await resolveGate(properties.sessionID)
      if (opened === undefined) return
      const classification = classifyNegativePrompt(properties.prompt.text)
      if (classification === undefined) return
      const occurrenceID = deriveSignalOccurrenceID({
        projectID: opened.projectID,
        sessionID: properties.sessionID,
        promptMessageID: properties.messageID,
        ...classification,
      })
      // 信号 ID 从发生实例派生：同一提示在事件信封重启/重放变化时仍只有一个原始信号
      const signalID = deriveSignalID({ projectID: opened.projectID, eventID: occurrenceID })
      const appended = await appendSignalUnderLock(ctx.file, opened.paths, [
        {
          id: signalID,
          ts: Date.now(),
          projectID: opened.projectID,
          sessionID: properties.sessionID,
          promptMessageID: properties.messageID,
          occurrenceID,
          ...classification,
        },
      ])
      if (!appended.appended && appended.reason !== "duplicate") {
        warnOnce(warnings, `负反馈信号落盘未完成（${appended.reason}），本条跳过`)
      }
    },

    async onStepStarted(properties) {
      const turn = windowFor(properties.sessionID, properties.assistantMessageID)
      turn.agent ??= properties.agent
      turn.model ??= properties.model.id
      latestTurnBySession.set(properties.sessionID, properties.assistantMessageID)
      boundedSet(latestTurnBySession, MAX_SESSIONS)
    },

    async onStepSettled(properties: { sessionID: string; assistantMessageID: string }, envelopeID: string) {
      const key = turnKey(properties.sessionID, properties.assistantMessageID)
      const turn = turns.get(key)
      if (turn === undefined) return
      const opened = await resolveGate(properties.sessionID)
      if (opened === undefined) {
        turns.delete(key)
        if (latestTurnBySession.get(properties.sessionID) === properties.assistantMessageID) {
          latestTurnBySession.delete(properties.sessionID)
        }
        return
      }
      // 补齐：本 turn 落过失败证据的每个 callID 追加一条完整轨迹证据到 call 级文档；
      // settled 防跨流重复 settle 的重复补齐（step.ended 与 step.failed 可能都到达）
      if (turn.settled === true) return
      turn.settled = true
      for (const [callID, errorCategory] of turn.failedCalls) {
        const info = callByKey.get(callKey(opened.projectID, properties.sessionID, callID))
        const tool = info?.tool ?? "unknown"
        const fingerprintHash = issueFingerprint({
          tool,
          scenario: "tool_failure",
          errorCategory,
        })
        const evidenceID = deriveEvidenceID({
          projectID: opened.projectID,
          eventID: `${envelopeID}:turn:${callID}`,
          kind: "trajectory",
        })
        const occurrenceID = deriveCallOccurrenceID({
          projectID: opened.projectID,
          sessionID: properties.sessionID,
          callID,
          fingerprint: fingerprintHash,
        })
        const record: ToolInsightEvidence = {
          id: evidenceID,
          ts: Date.now(),
          kind: "trajectory",
          projectID: opened.projectID,
          sessionID: properties.sessionID,
          callID,
          turnID: turn.turnID,
          agent: turn.agent,
          model: turn.model,
          trigger: "auto",
          occurrenceID,
          fields: {
            tool,
            callsShape: turn.calls.map((call) => `${call.tool}:${call.status}`).join(">"),
            fingerprint: fingerprintHash,
            issue: { tool, scenario: "tool_failure", errorCategory },
          },
        }
        const appended = await appendEvidenceUnderLock(ctx.file, opened.paths, [record], { dedupe: true })
        if (appended.appended) {
          await ingestEvidenceIssue(ctx.file, opened.paths, {
            fingerprint: fingerprintHash,
            evidenceID,
            occurrenceID,
            evidenceKind: "trajectory",
            occurredAt: record.ts,
            facts: { tool, scenario: "tool_failure", errorCategory },
          })
          input.onDocumented?.(fingerprintHash, properties.sessionID)
        }
      }
      // 不删除本 turn 窗口：跨流乱序下本 turn 的迟到 tool.* 仍需落回窗口做形状归纳；
      // 窗口只由 MAX_TURNS 有界淘汰回收
    },

    async onToolCalled(properties, _envelopeID: string) {
      const opened = await resolveGate(properties.sessionID)
      if (opened === undefined) return
      const { projectID } = opened
      const input = isRecord(properties.input) ? properties.input : {}
      const turn = windowFor(properties.sessionID, properties.assistantMessageID)
      // 批量兄弟配对（D6）：登记前先看在途规模（不含自身），登记自身发出序号
      const siblings = turn.inFlightByTool.get(properties.tool) ?? new Map<string, number>()
      turn.inFlightByTool.set(properties.tool, siblings)
      const issueSeq = ++issueSeqCounter
      const info: CallInfo = {
        tool: properties.tool,
        paramKeys: Object.keys(input).sort(),
        turnID: turn.turnID,
        agent: turn.agent,
        model: turn.model,
        issueSeq,
        batchIssued: siblings.size > 0,
      }
      const adapter = findToolInsightVerifyAdapter(properties.tool)
      if (adapter !== undefined) {
        const identifiers = adapter.extract({ callInput: input, resultStructured: {} })
        if (identifiers !== undefined) info.verifyIdentifiers = identifiers
      }
      const paramIdentifiers = redactParamIdentifiers(input)
      if (paramIdentifiers !== undefined) info.identifiers = paramIdentifiers
      callByKey.set(callKey(projectID, properties.sessionID, properties.callID), info)
      boundedSet(callByKey, MAX_CALLS)
      siblings.set(properties.callID, issueSeq)
      if (turn.calls.length >= MAX_CALLS_PER_TURN) turn.calls.shift()
      turn.calls.push({ callID: properties.callID, tool: properties.tool, status: "called", paramKeys: info.paramKeys })
    },

    async onToolSuccess(properties, envelopeID: string) {
      const opened = await resolveGate(properties.sessionID)
      if (opened === undefined) return
      const { projectID } = opened
      const key = callKey(projectID, properties.sessionID, properties.callID)
      const info = callByKey.get(key)
      const structured = isRecord(properties.structured) ? properties.structured : {}
      const turn = windowFor(properties.sessionID, properties.assistantMessageID)
      const tool = info?.tool ?? "unknown"
      const overlapped = info !== undefined && isBatchMember(turn, tool, properties.callID, info)
      turn.calls.push({
        callID: properties.callID,
        tool,
        status: "success",
        paramKeys: info?.paramKeys,
        ...(overlapped ? { overlapped: true } : {}),
      })
      removeFromInFlight(turn, properties.callID)

      // 反复修改信号：兴趣工具连续成功（批量兄弟完成不计入，D6）
      if (REVISION_TOOLS.has(tool) && !overlapped) {
        const streak = revisionStreak.get(properties.sessionID)
        const next = streak?.tool === tool ? streak.count + 1 : 1
        revisionStreak.set(properties.sessionID, { tool, count: next })
        if (next >= REVISION_STREAK_THRESHOLD && turn !== undefined) {
          await recordTurnDetection(ctx, opened.paths, projectID, properties.sessionID, turn, "redundant_repeat", { tool }, `${envelopeID}:revision`, Date.now())
          revisionStreak.set(properties.sessionID, { tool, count: 0 })
        }
      }

      // 真实结果只读核验：注册了适配器且标识足够
      const adapter = findToolInsightVerifyAdapter(tool)
      if (adapter === undefined) {
        // 无核验器：成功归纳（改参成功/换工具成功）仍可触发轨迹检测
        const shape = classifyShape(properties.sessionID, properties.assistantMessageID, tool, "success")
        if (shape !== undefined && turn !== undefined) {
          await recordTurnDetection(ctx, opened.paths, projectID, properties.sessionID, turn, shape.kind, { tool }, `${envelopeID}:shape:${shape.kind}`, Date.now())
        }
        return
      }
      const identifiers = info?.verifyIdentifiers ?? adapter.extract({ callInput: {}, resultStructured: structured })
      if (identifiers === undefined) return
      const verified = await adapter.verify({ directory: projectDirectory, identifiers })
      const ts = Date.now()
      const evidenceID = deriveEvidenceID({ projectID, eventID: envelopeID, kind: "real_state" })
      const fingerprintInput: ToolInsightFingerprintInput = { tool, scenario: "surface_success", errorCategory: "unknown" }
      const fingerprintHash = issueFingerprint(fingerprintInput)
      const record: ToolInsightEvidence = {
        id: evidenceID,
        ts,
        kind: "real_state",
        projectID,
        sessionID: properties.sessionID,
        callID: properties.callID,
        turnID: info?.turnID ?? turn?.turnID,
        agent: info?.agent,
        model: info?.model,
        trigger: "auto",
        fields: {
          tool,
          verifyStatus: verified.status,
          detail: redactSummary(verified.detail, 120),
          // 仅核验失败（进 surface_success 文档）的证据带归属键；正常成功不参与对账
          ...(verified.status === "verified_failure" ? { fingerprint: fingerprintHash, issue: fingerprintInput } : {}),
        },
      }
      const appended = await appendEvidenceUnderLock(ctx.file, opened.paths, [record], { dedupe: true })
      if (!appended.appended) {
        if (appended.reason !== "duplicate") warnOnce(warnings, `真实状态证据落盘未完成（${appended.reason}），本条跳过`)
        return
      }
      if (verified.status !== "verified_failure") return
      // 表面成功但任务未完成：核验失败才建档
      const occurrenceID = deriveCallOccurrenceID({
        projectID,
        sessionID: properties.sessionID,
        callID: properties.callID,
        fingerprint: fingerprintHash,
      })
      await ingestEvidenceIssue(ctx.file, opened.paths, {
        fingerprint: fingerprintHash,
        evidenceID,
        occurrenceID,
        evidenceKind: "real_state",
        occurredAt: ts,
        facts: fingerprintInput,
      })
      input.onDocumented?.(fingerprintHash, properties.sessionID)
      if (turn !== undefined) {
        await recordTurnDetection(ctx, opened.paths, projectID, properties.sessionID, turn, "surface_success", { tool }, `${envelopeID}:surface`, ts)
      }
    },

    async onToolFailed(properties, envelopeID: string) {
      const opened = await resolveGate(properties.sessionID)
      if (opened === undefined) return
      const { projectID } = opened
      const key = callKey(projectID, properties.sessionID, properties.callID)
      const info = callByKey.get(key)
      const tool = info?.tool ?? "unknown"
      const failureFields = redactToolFailed(tool, properties.error)
      const errorCategory =
        typeof failureFields.errorType === "string" && isToolErrorCategory(failureFields.errorType)
          ? failureFields.errorType
          : "unknown"
      const turn = windowFor(properties.sessionID, properties.assistantMessageID)
      const overlapped = info !== undefined && isBatchMember(turn, tool, properties.callID, info)
      turn.calls.push({
        callID: properties.callID,
        tool,
        status: "failed",
        paramKeys: info?.paramKeys,
        errorCategory,
        ...(overlapped ? { overlapped: true } : {}),
      })
      removeFromInFlight(turn, properties.callID)

      // 客观证据先行：失败恒落 tool_failed 证据并按单次调用问题建档
      const occurrenceID = await recordCallFailure(
        ctx,
        opened.paths,
        projectID,
        properties.sessionID,
        properties.callID,
        info,
        properties.error,
        envelopeID,
        Date.now(),
      )
      if (occurrenceID !== undefined) turn?.failedCalls.set(properties.callID, errorCategory)

      // 六类形状归纳：重复/恢复失败在失败时刻即可判定
      const shape = classifyShape(properties.sessionID, properties.assistantMessageID, tool, "failed")
      if (shape !== undefined && turn !== undefined) {
        await recordTurnDetection(
          ctx,
          opened.paths,
          projectID,
          properties.sessionID,
          turn,
          shape.kind,
          { tool, errorCategory },
          `${envelopeID}:shape:${shape.kind}`,
          Date.now(),
        )
      }
    },
  }

  return state
}

/** 订阅全部相关事件并挂当前 scope：内部会话事件在任何状态更新前被过滤 */
export function watchToolInsightEvents(input: WatchToolInsightInput): Effect.Effect<void, never, Scope.Scope> {
  const state = createCollectorState(input)
  const { ctx } = input
  // 事件处理绝不反向影响事件流：任何意外 rejection 折叠为一次性警告。
  // 宿主信封在公开形状外携带事件 ID（派生证据 ID 的种子，跨重启不重用）：
  // 公开类型上没有该字段，与宿主适配同款单点断言收窄。
  const filterAndRun =
    <P>(handler: (properties: P, envelopeID: string) => Promise<void>) =>
    (event: { properties: P }) => {
      // 宿主信封在公开形状外携带事件 ID：Reflect.get 安全读取，无需断言
      const rawID = typeof event === "object" && event !== null ? Reflect.get(event, "id") : undefined
      const envelopeID = typeof rawID === "string" ? rawID : ""
      return Effect.promise(() =>
        handler(event.properties, envelopeID).catch((error: unknown) => {
          console.warn("[tool-insight] 事件处理异常（已忽略）:", error)
        }),
      )
    }

  return Effect.gen(function* () {
    yield* ctx.event.subscribe("session.next.prompt.admitted").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(
        filterAndRun(
          (properties: { sessionID: string; messageID: string; prompt: { text: string } }, envelopeID) =>
            state.onPromptAdmitted(properties, envelopeID),
        ),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.created").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(filterAndRun((properties) => state.onCreated(properties))),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.step.started").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(
        filterAndRun((properties: { sessionID: string; assistantMessageID: string; agent: string; model: { id: string } }) =>
          state.onStepStarted(properties),
        ),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.step.ended").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(
        filterAndRun((properties: { sessionID: string; assistantMessageID: string }, envelopeID) => state.onStepSettled(properties, envelopeID)),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.step.failed").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(
        filterAndRun((properties: { sessionID: string; assistantMessageID: string }, envelopeID) => state.onStepSettled(properties, envelopeID)),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.tool.called").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(
        filterAndRun((properties: { sessionID: string; assistantMessageID: string; callID: string; tool: string; input: unknown }, envelopeID) =>
          state.onToolCalled(properties, envelopeID),
        ),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.tool.success").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(
        filterAndRun((properties: { sessionID: string; assistantMessageID: string; callID: string; structured: unknown }, envelopeID) =>
          state.onToolSuccess(properties, envelopeID),
        ),
      ),
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe("session.next.tool.failed").pipe(
      Stream.filter((event) => !isInternalEvent(event)),
      Stream.runForEach(
        filterAndRun((properties: { sessionID: string; assistantMessageID: string; callID: string; error: unknown }, envelopeID) =>
          state.onToolFailed(properties, envelopeID),
        ),
      ),
      Effect.forkScoped,
    )
  })
}
