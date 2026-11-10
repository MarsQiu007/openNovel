/**
 * 隔离复测编排引擎（任务 5.2/5.3/5.4）。
 *
 * 准备 → 系统确认 → 隔离执行 → 确定性核验的编排层：
 * - prepare_retest 只构造案例并写 cases/<fingerprint>.md：不确认、不建临时目录、
 *   不写运行记录，给模型与用户预览将执行什么。
 * - run_retest 在用户经 ctx.confirm 于原会话确认后按 1–20 次顺序执行。每次运行在
 *   run 锁内先重新核对案例摘要（编排层行为：确认后案例、白名单、验收、模型、版本
 *   任一变化都使既有确认失效，停止并要求重新确认），再写 started，然后在 OS 临时
 *   根下创建唯一临时 Location（最小 .novel 标记 + 显式声明 novel-writer-v2 的
 *   opennovel.json），seed 合成夹具后经宿主 startBackground(retest) 发车：前置
 *   插件有界等待、宿主代持注册 deny-first 复测 agent、预检全部通过才 prompt。
 *   结果取自适配器核验器对临时 Location 最终本地状态的判定，agent 自称成功只作
 *   轨迹事实。核验失败继续后续运行（不一致判「未稳定解决」）；取消与结构性失败
 *   （摘要变化、授权失效、隔离建立失败、执行失败）停止批次并显式记录未执行次数。
 *
 * 临时根取 OS tmpdir + 项目短哈希（toolInsightProjectSlug），不用宿主 paths.tmp：
 * 任务 5.6 要求「祖先链无 opennovel 配置并入」，而临时目录嵌在宿主数据目录或原
 * 项目下时，配置发现的祖先链会并入上级 opennovel 配置，破坏隔离。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { closeDb, toolInsightCasePath, type ToolInsightPaths } from "@opennovel-ai/novel-store"
import type { PluginContext } from "../v2/effect/context.js"
import type { BackgroundSessionAuthorization, SessionDomain } from "../v2/effect/session.js"
import type { ConfirmRetestInput, ToolContext } from "../v2/effect/tool.js"
import {
  computeCaseDigest,
  findToolInsightCaseAdapter,
  prepareToolInsightCase,
  type PreparedToolInsightCase,
} from "./case-adapter.js"
import { redactSummary } from "./evidence.js"
import { openToolInsightGate } from "./gate.js"
import { parseCaseDoc, readIssueMeta, writeToolInsightCaseDoc } from "./issue-store.js"
import {
  appendManualRunResult,
  appendRunFinishedLocked,
  appendRunStartedLocked,
  loadRunRecords,
  reconcileRunRecords,
  runUnderRunLock,
  safeRemoveTempDir,
  summarizeRuns,
  type ToolInsightRunVerdict,
} from "./retest-records.js"
import { toolInsightProjectSlug } from "./settings.js"

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * 复测专用 agent 规格（任务 5.4）：插件 ctx 无法跨 Location transform，由宿主在
 * 临时 Location 作用域代持注册（subagent + hidden），并在作用域 finalizer 清理。
 * deny-first 权限规则由宿主按当次案例白名单构造，权限不固化在 agent 身份上。
 */
const RETEST_AGENT = {
  id: "insight-retester",
  description: "内部复测执行 agent（隐藏）：在一次性隔离临时项目中按固定步骤调用案例白名单工具",
  system:
    "你是复测执行 agent，在一次性隔离临时项目中工作。严格按提示中的固定步骤调用指定工具并立即结束，不总结不追问。不得读取或引用任何原书数据，不得调用白名单之外的任何能力，不得产生任何真实外部副作用。",
}

const VERDICT_TEXT: Record<ToolInsightRunVerdict, string> = {
  none: "无自动执行记录",
  passed: "多次复测通过",
  failed: "复测失败",
  unstable: "未稳定解决（通过与失败并存）",
  incomplete: "未完成（存在中断未验证的运行）",
}

export interface ToolInsightRetestOutcome {
  readonly message: string
  readonly metadata?: Record<string, unknown>
}

export interface ToolInsightRetest {
  /** 准备复测案例：写案例文档并返回预览；不确认、不建临时目录、不写运行记录 */
  prepareRetest: (input: { fingerprint: string }) => Promise<ToolInsightRetestOutcome>
  /** 系统确认后的隔离复测编排：按次数顺序执行并汇总判定 */
  runRetest: (input: {
    fingerprint: string
    runs?: number
    fixVersion: string
    confirm: ToolContext["confirm"]
    sessionID: string
  }) => Promise<ToolInsightRetestOutcome>
  /** 人工结果留痕：只展示，不计自动通过 */
  recordManual: (input: { fingerprint: string; passed: boolean; fixVersion: string; detail?: string }) => Promise<ToolInsightRetestOutcome>
  /** 启动对账：每实例至多一次，把无终态的运行标为 interrupted/未验证，不自动重跑 */
  reconcileRunsOnce: () => Promise<void>
}

type PreparedCase = {
  prepared: Extract<PreparedToolInsightCase, { eligible: true }>
  model: { providerID: string; modelID: string }
}

export function createToolInsightRetest(input: {
  ctx: PluginContext
  /** 本插件实例的 Location 目录：开关门与目录变化判定（与 organizer/collector 一致） */
  projectDirectory: string
  session: Pick<SessionDomain, "startBackground">
}): ToolInsightRetest {
  const { ctx, projectDirectory, session } = input
  const file = ctx.file

  const openGate = () =>
    openToolInsightGate({
      configDir: ctx.paths.config,
      projectDirectory,
      projectID: projectDirectory,
      warnOnce: (message) => console.warn(`[tool-insight] ${message}`),
    })

  const notEnabled = (): ToolInsightRetestOutcome => ({ message: "工具改进日志未启用：请在设置中开启后使用。本次未做任何修改。" })

  /** 案例准备共用段：问题定位 → 模型解析（确认前覆盖进摘要）→ 适配器资格 */
  const prepareCase = async (paths: ToolInsightPaths, fingerprint: string, fixVersion: string): Promise<PreparedCase | { error: string }> => {
    const meta = readIssueMeta(paths, fingerprint)
    if (meta.error !== undefined) {
      return { error: `问题 ${fingerprint} ${meta.error === "missing" ? "不存在" : "文档损坏"}，无法准备复测案例。` }
    }
    const model = await ctx.catalog.defaultModel()
    if (model === undefined) {
      return { error: "无已配置模型：复测案例摘要必须覆盖模型提供方与模型，不能隐式改用其他模型，本次未执行。" }
    }
    const prepared = prepareToolInsightCase({
      fingerprint,
      tool: meta.meta.tool,
      scenario: meta.meta.scenario,
      model,
      fix_version: fixVersion,
      // 首批适配器夹具全部为合成数据，无正文授权参与摘要；后续依赖授权正文的
      // 适配器在确认流里签发 retest grant，并以其稳定 ID 进入摘要输入
      grant_ids: [],
    })
    if (!prepared.eligible) {
      return {
        error: `工具 ${meta.meta.tool}（场景 ${meta.meta.scenario}）暂无确定性复测适配器：无法限制资源、有真实外部副作用或无适配器的操作一律转人工验证，可用 action=record_manual_result 留痕。`,
      }
    }
    return { prepared, model }
  }

  const caseDocWritten = async (paths: ToolInsightPaths, caseInput: PreparedCase) => {
    const written = await writeToolInsightCaseDoc(file, paths, { meta: caseInput.prepared.meta, sections: caseInput.prepared.sections })
    return written.written ? undefined : written.reason
  }

  const prepareRetest = async (input: { fingerprint: string }): Promise<ToolInsightRetestOutcome> => {
    const opened = openGate()
    if (opened === undefined) return notEnabled()
    const caseInput = await prepareCase(opened.paths, input.fingerprint, "")
    if ("error" in caseInput) return { message: caseInput.error }
    const reason = await caseDocWritten(opened.paths, caseInput)
    if (reason !== undefined) return { message: `案例文档落盘未完成（${reason}），已停止；未创建临时目录，未写运行记录。` }
    return {
      message: [
        `已生成复测案例 ${caseInput.prepared.case_id}（cases/${input.fingerprint}.md）。`,
        `目标工具 ${caseInput.prepared.adapter.tool}，白名单 ${caseInput.prepared.adapter.whitelist.join("、")}；验收标准与合成夹具见案例文档。`,
        `模型 ${caseInput.model.providerID}/${caseInput.model.modelID}，案例摘要 ${caseInput.prepared.digest.slice(0, 12)}…。`,
        "执行请用 action=run_retest 并提供 1–20 的整数运行次数与非空修复版本；执行前会再次核对案例摘要并请求系统确认。",
      ].join("\n"),
      metadata: { action: "prepare_retest", fingerprint: input.fingerprint, case_id: caseInput.prepared.case_id, digest: caseInput.prepared.digest },
    }
  }

  // ─── 单次运行（run 锁内） ───

  const runOnce = async (context: {
    index: number
    paths: ToolInsightPaths
    root: string
    fingerprint: string
    model: { providerID: string; modelID: string }
    fixVersion: string
    prepared: PreparedCase["prepared"]
    authorization: BackgroundSessionAuthorization
    sessionID: string
  }): Promise<{ executed: boolean; stop?: string }> => {
    const { paths, root, fingerprint } = context
    // 每次执行前重新核对摘要：重新构造案例并与确认时摘要比对，任一组成变化
    // 即停止并要求重新确认（摘要变化也使宿主授权失配，双保险）
    const recheck = prepareToolInsightCase({
      fingerprint,
      tool: context.prepared.adapter.tool,
      scenario: context.prepared.adapter.scenario,
      model: context.model,
      fix_version: context.fixVersion,
      grant_ids: [],
    })
    if (!recheck.eligible || recheck.digest !== context.prepared.digest) {
      const started = appendRunStartedLocked(paths, { fingerprint, case_digest: context.prepared.digest, model: context.model, fix_version: context.fixVersion })
      if (started.result.appended) {
        appendRunFinishedLocked(paths, {
          fingerprint,
          case_digest: context.prepared.digest,
          model: context.model,
          fix_version: context.fixVersion,
          runID: started.runID,
          status: "preflight_failed",
          verified: "unverified",
          detail: "执行前案例摘要与确认时不一致，已按重新确认要求停止",
        })
      }
      return { executed: false, stop: "案例摘要与确认时不一致：请重新确认后再执行" }
    }

    const recordBase = { fingerprint, case_digest: recheck.digest, model: context.model, fix_version: context.fixVersion }
    // started 必须在创建临时目录之前落盘：崩溃后对账可标 interrupted/未验证
    const started = appendRunStartedLocked(paths, recordBase)
    if (!started.result.appended) {
      return { executed: false, stop: `运行记录落盘失败（${started.result.reason}）：为避免无记录运行，本次未执行` }
    }

    const finish = (status: Parameters<typeof appendRunFinishedLocked>[1]["status"], verified: Parameters<typeof appendRunFinishedLocked>[1]["verified"], detail: string) => {
      appendRunFinishedLocked(paths, { ...recordBase, runID: started.runID, status, verified, detail })
    }

    // 隔离目录建立失败同样失败关闭：不裸抛（会让 started 记录成为孤儿），按
    // 预检失败落盘「未验证」并停止批次
    const establish = (): { runDir: string } | { failed: string } => {
      let runDir: string | undefined
      try {
        mkdirSync(root, { recursive: true })
        runDir = mkdtempSync(join(root, "run-"))
        // 最小隔离项目：.novel 标记 + 显式声明 novel-writer-v2 的 opennovel.json；
        // 祖先链（OS tmpdir 之上）无任何 opennovel 配置可并入（任务 5.6 验收）
        mkdirSync(join(runDir, ".novel"))
        writeFileSync(join(runDir, "opennovel.json"), JSON.stringify({ plugins: ["@opennovel-ai/plugin/novel-writer-v2"] }, null, 2))
        return { runDir }
      } catch (error) {
        // 半建的 runDir 走安全清理；此时尚未打开任何数据库连接
        if (runDir !== undefined) void safeRemoveTempDir({ root, target: runDir })
        return { failed: redactSummary(describeError(error)) }
      }
    }
    const isolation = establish()
    if ("failed" in isolation) {
      finish("preflight_failed", "unverified", `隔离目录建立失败：${isolation.failed}`)
      return { executed: false, stop: `隔离目录建立失败，结果未验证：${isolation.failed}` }
    }
    const runDir = isolation.runDir

    const cleanup = async () => {
      // 释放 seed/verify 经 getDb 缓存的 SQLite 连接：Windows 下句柄随 statement GC
      // 终结才真正释放，交给 safeRemoveTempDir 的 GC+重试兜底
      closeDb(runDir)
      const removed = await safeRemoveTempDir({ root, target: runDir })
      if (!removed.removed) console.warn(`[tool-insight] 复测临时目录清理未完成（${removed.reason}）：${runDir}`)
    }

    // 隔离建立失败：未执行、未验证，停止批次；不复制、不挂载原书数据
    try {
      await recheck.adapter.seed({ directory: runDir })
    } catch (error) {
      finish("preflight_failed", "unverified", `隔离夹具建立失败：${redactSummary(describeError(error))}`)
      await cleanup()
      return { executed: false, stop: `隔离夹具建立失败，结果未验证：${redactSummary(describeError(error))}` }
    }

    let done
    try {
      const handle = await session.startBackground({
        mode: "retest",
        agent: RETEST_AGENT.id,
        retestAgent: RETEST_AGENT,
        prompt: recheck.prompt,
        expectedTools: recheck.adapter.whitelist,
        directory: runDir,
        model: context.model,
        authorization: { id: context.authorization.id, caseDigest: recheck.digest },
        originSessionID: context.sessionID,
        // 前置插件：config-plugin 装载临时项目声明的 novel-writer-v2；两者都在
        // 临时 Location 激活后宿主才注册复测 agent 与预检（有界等待，无固定 sleep）
        requiredPlugins: ["config-plugin", "novel-writer"],
      })
      done = await handle.done
    } catch (error) {
      // startBackground 在 create 前失败关闭：授权校验失败与一般预检失败分类落盘
      // （消息前缀是 core 宿主与编排层的私有契约，两侧同仓同改）
      const message = describeError(error)
      const status = message.startsWith("后台 retest 授权校验失败") ? "authorization_invalid" : "preflight_failed"
      finish(status, "unverified", redactSummary(message))
      await cleanup()
      return {
        executed: false,
        stop: status === "authorization_invalid" ? "宿主授权校验失败：请重新确认后再执行" : `发车前预检失败，结果未验证：${redactSummary(message)}`,
      }
    }

    if (done.status === "cancelled") {
      finish("cancelled", "unverified", "复测会话被取消")
      await cleanup()
      return { executed: false, stop: "复测会话被取消，剩余运行不再执行" }
    }
    if (done.status === "failure") {
      finish("failed", "unverified", `复测会话执行失败：${redactSummary(done.reason)}`)
      await cleanup()
      return { executed: true, stop: `复测会话执行失败，剩余运行不再执行：${redactSummary(done.reason)}` }
    }

    // 确定性核验：适配器读临时 Location 最终本地状态，逐条判断验收标准；
    // agent 自称成功只作为轨迹事实，不作为通过依据
    const verified = await recheck.adapter.verify({ directory: runDir })
    finish(verified.status === "verified_success" ? "passed" : "failed", verified.status, verified.detail)
    await cleanup()
    return { executed: true }
  }

  const runRetest = async (input: {
    fingerprint: string
    runs?: number
    fixVersion: string
    confirm: ToolContext["confirm"]
    sessionID: string
  }): Promise<ToolInsightRetestOutcome> => {
    // 确认前的入参校验：拒绝时不创建任何运行记录、临时目录或后台会话
    if (input.runs === undefined || !Number.isInteger(input.runs) || input.runs < 1 || input.runs > 20) {
      const shown = input.runs === undefined ? "" : `（收到 ${input.runs}）`
      return { message: `复测次数必须是 1–20 的整数${shown}：本次请求未创建任何运行记录、未建临时目录、未启动会话。` }
    }
    if (input.fixVersion.trim() === "") {
      return { message: "修复版本不能为空：请提供本次复测对应的应用或修复版本；本次请求未创建任何运行记录。" }
    }
    if (input.confirm === undefined) {
      return { message: "当前宿主未提供系统确认通道：隔离复测必须经用户在原会话显式确认后执行，本次未做任何事。" }
    }
    const opened = openGate()
    if (opened === undefined) return notEnabled()
    const paths = opened.paths
    const caseInput = await prepareCase(paths, input.fingerprint, input.fixVersion)
    if ("error" in caseInput) return { message: caseInput.error }
    const caseReason = await caseDocWritten(paths, caseInput)
    if (caseReason !== undefined) return { message: `案例文档落盘未完成（${caseReason}），已停止；未确认、未建临时目录、未写运行记录。` }

    const confirmInput: ConfirmRetestInput = {
      question: `对问题 ${input.fingerprint}（工具 ${caseInput.prepared.adapter.tool}）执行隔离自动复测？`,
      runs: input.runs,
      fixVersion: input.fixVersion,
      caseDigest: caseInput.prepared.digest,
      model: caseInput.model,
      expectedTools: caseInput.prepared.adapter.whitelist,
    }
    const authorization = await input.confirm(confirmInput)
    if (authorization === undefined) {
      return { message: "用户未确认执行：未创建临时目录、未启动后台会话、未写任何运行记录。" }
    }

    // 临时根在 OS tmpdir 下按项目短哈希隔离：与其他项目/实例互不共享，
    // 祖先链不含任何 opennovel 配置（任务 5.6 验收）
    const root = join(tmpdir(), "opennovel-tool-insight", toolInsightProjectSlug(projectDirectory))

    let executed = 0
    let stopped: string | undefined
    for (let index = 0; index < input.runs && stopped === undefined; index++) {
      const outcome = await runUnderRunLock(file, paths, { fingerprint: input.fingerprint }, () =>
        runOnce({
          index,
          paths,
          root,
          fingerprint: input.fingerprint,
          model: caseInput.model,
          fixVersion: input.fixVersion,
          prepared: caseInput.prepared,
          authorization,
          sessionID: input.sessionID,
        }),
      )
      if (!outcome.ok) {
        stopped = `运行锁不可用（${outcome.reason}）：第 ${index + 1} 次运行未执行`
        break
      }
      executed += outcome.value.executed ? 1 : 0
      stopped = outcome.value.stop
    }

    const summary = summarizeRuns(loadRunRecords(paths, input.fingerprint), caseInput.prepared.digest)
    const notExecuted = input.runs - executed
    const lines = [
      `复测批次结束：请求 ${input.runs} 次，实际执行 ${executed} 次${notExecuted > 0 ? `，未执行 ${notExecuted} 次` : ""}。`,
      `判定：${VERDICT_TEXT[summary.verdict]}（通过 ${summary.autoPassed}、失败 ${summary.autoFailed}）。`,
    ]
    if (stopped !== undefined) lines.push(`中途停止：${stopped}。`)
    if (summary.interrupted > 0) lines.push(`另有 ${summary.interrupted} 条历史中断记录（进程未完成），结果未验证，不自动重跑。`)
    lines.push(`逐次结果与核验详情见 runs/${input.fingerprint}.jsonl；每次运行的临时目录已在结果落盘后清理。`)
    return {
      message: lines.join("\n"),
      metadata: {
        action: "run_retest",
        fingerprint: input.fingerprint,
        requested: input.runs,
        executed,
        verdict: summary.verdict,
        digest: caseInput.prepared.digest,
      },
    }
  }

  // ─── 人工结果留痕 ───

  const recordManual = async (input: { fingerprint: string; passed: boolean; fixVersion: string; detail?: string }): Promise<ToolInsightRetestOutcome> => {
    if (input.fixVersion.trim() === "") return { message: "人工结果需要非空修复版本：请提供本次验证对应的版本后重试。" }
    const opened = openGate()
    if (opened === undefined) return notEnabled()
    const paths = opened.paths
    const meta = readIssueMeta(paths, input.fingerprint)
    if (meta.error !== undefined) {
      return { message: `问题 ${input.fingerprint} ${meta.error === "missing" ? "不存在" : "文档损坏"}，人工结果未记录。` }
    }
    const appended = await appendManualRunResult(file, paths, {
      fingerprint: input.fingerprint,
      case_digest: manualCaseDigest(paths, input.fingerprint),
      model: {},
      fix_version: input.fixVersion,
      passed: input.passed,
      detail:
        input.detail === undefined || input.detail.trim() === ""
          ? input.passed
            ? "人工验证通过"
            : "人工验证未通过"
          : redactSummary(input.detail),
    })
    if (!appended.appended) return { message: `人工结果落盘未完成（${appended.reason}），本次未记录；请稍后重试。` }
    const records = loadRunRecords(paths, input.fingerprint).filter((record) => record.manual)
    const passed = records.filter((record) => record.status === "passed").length
    return {
      message: `人工结果已留痕（runs/${input.fingerprint}.jsonl）：累计 ${records.length} 条，通过 ${passed}、未通过 ${records.length - passed}。人工结果只展示，不计入自动复测通过次数。`,
      metadata: { action: "record_manual_result", fingerprint: input.fingerprint, manual_total: records.length },
    }
  }

  // ─── 启动对账 ───

  let reconciled = false
  const reconcileRunsOnce = async () => {
    if (reconciled) return
    reconciled = true
    const opened = openGate()
    if (opened === undefined) return
    let files: string[] = []
    try {
      files = readdirSync(opened.paths.runsDir).filter((name) => name.endsWith(".jsonl"))
    } catch {
      return
    }
    for (const name of files) {
      const fingerprint = name.slice(0, -".jsonl".length)
      try {
        const outcome = await reconcileRunRecords(file, opened.paths, { fingerprint })
        if ("reason" in outcome) continue // 另一进程活动运行持锁：不等待、不误标
        if (outcome.marked > 0) console.warn(`[tool-insight] 复测运行对账：${fingerprint} 标记 ${outcome.marked} 条中断记录`)
      } catch (error) {
        console.warn(`[tool-insight] 复测运行对账异常（${fingerprint}）:`, error)
      }
    }
  }

  return { prepareRetest, runRetest, recordManual, reconcileRunsOnce }
}

/** 人工结果绑定摘要：有适配器案例文档时按其 meta 重算（与自动批次同摘要），否则空串 */
function manualCaseDigest(paths: ToolInsightPaths, fingerprint: string): string {
  let text: string
  try {
    text = readFileSync(toolInsightCasePath(paths, fingerprint), "utf-8")
  } catch {
    return ""
  }
  const parsed = parseCaseDoc(text)
  if (parsed.error) return ""
  const adapter = findToolInsightCaseAdapter(parsed.meta.tool, parsed.meta.scenario)
  if (adapter === undefined) return ""
  return computeCaseDigest({
    case_id: parsed.meta.case_id,
    tool: parsed.meta.tool,
    scenario: parsed.meta.scenario,
    whitelist: parsed.meta.whitelist,
    fixture: adapter.fixture,
    acceptance: adapter.acceptance,
    model: parsed.meta.model,
    fix_version: parsed.meta.fix_version,
    grant_ids: [],
  })
}
