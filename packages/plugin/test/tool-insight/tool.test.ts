/**
 * 独立 tool_insight 工具测试（任务 3.4）。
 *
 * 覆盖 tasks.md 3.4 验证：无报错体验问题与写作外流程问题都能记录、补充反馈纠正
 * 旧假设且不增加出现次数（明确新发生才建新实例）、正文不能经普通反馈绕过白名单
 * （截断脱敏，正文例外走独立字段显式授权）、未启用时显式拒绝、重新整理把全部证据
 * 放回 pending。锁用进程内 fake，落盘用真实临时目录。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { readToolInsightJsonl, toolInsightIssuePath, toolInsightPaths } from "@opennovel-ai/novel-store"
import { appendSignalUnderLock } from "../../src/tool-insight/evidence-store.js"
import { createToolInsightTool } from "../../src/tool-insight/tool.js"
import { issueFingerprint, parseIssueDoc } from "../../src/tool-insight/issue-doc.js"
import { organizeUnderLock } from "../../src/tool-insight/issue-store.js"
import { listSignals } from "../../src/tool-insight/signal-store.js"
import { toolInsightProjectSlug } from "../../src/tool-insight/settings.js"
import { type ToolContext, type ToolSpec } from "../../src/v2/effect/tool.js"

const fakeLocks = new Map<string, Promise<unknown>>()

const file = {
  // 与 issue-store.test 同款：进程内按键串行化
  withLock: (input: { key: string }, callback: () => Promise<unknown>) => {
    const chain = fakeLocks.get(input.key) ?? Promise.resolve()
    const run = chain.then(callback, callback)
    fakeLocks.set(
      input.key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  },
}

function fixture(name: string) {
  const configDir = mkdtempSync(join(tmpdir(), `tool-insight-tool-${name}-cfg-`))
  const logRoot = mkdtempSync(join(tmpdir(), `tool-insight-tool-${name}-log-`))
  const projectDir = mkdtempSync(join(tmpdir(), `tool-insight-tool-${name}-proj-`))
  writeFileSync(join(configDir, "opennovel.json"), JSON.stringify({ toolInsight: { enabled: true, directory: logRoot } }))
  return { configDir, logRoot, projectDir }
}

function cleanup(input: { configDir: string; logRoot: string; projectDir: string }) {
  for (const dir of [input.configDir, input.logRoot, input.projectDir]) {
    // Windows 下句柄释放有短暂延迟：清理失败不影响断言
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {}
  }
}

function makeTool(
  configDir: string,
  enqueue: (fingerprint: string, sessionID?: string) => void = () => {},
  ownership?: { resolve: (sessionID: string) => Promise<{ projectID: string; directory: string } | undefined> },
) {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 测试桩：通用工具签名与入口实现的具体 input 泛型不同
  return createToolInsightTool({ configDir, file, enqueue, resolveOwnership: ownership?.resolve }) as unknown as ToolSpec<Record<string, unknown>>
}

function makeContext(projectDir: string): ToolContext {
  return { sessionID: "ses_user", agent: "director", messageID: "msg_1", directory: projectDir, ask: async () => {} }
}

function logSlug(projectDir: string): string {
  return toolInsightProjectSlug(projectDir)
}

/** 读取用户报告问题的文档 meta（record/supplement 共用同一稳定指纹） */
function readUserReport(logRoot: string, projectDir: string) {
  const fingerprint = issueFingerprint({ tool: "", scenario: "user_report", errorCategory: "user_report" })
  const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(toolInsightPaths(join(logRoot, logSlug(projectDir))), fingerprint), "utf-8"))
  if (parsed.error) throw new Error("expected parseable issue doc")
  return { fingerprint, ...parsed }
}

describe("tool_insight 工具（任务 3.4）", () => {
  test("record：无报错体验问题与写作外流程问题都落证据并建档", async () => {
    const { configDir, logRoot, projectDir } = fixture("record")
    try {
      const enqueued: Array<{ fingerprint: string; sessionID?: string }> = []
      const tool = makeTool(configDir, (fingerprint, sessionID) => enqueued.push({ fingerprint, sessionID }))
      const ctx = makeContext(projectDir)
      const result = await tool.execute({ action: "record", feedback: "导出章节列表要点三步，太繁琐" }, ctx)
      expect(result).toMatchObject({ title: "tool_insight" })
      const output = typeof result === "string" ? result : result.output
      expect(output).toContain("已记录为新的一次发生")

      const { meta } = readUserReport(logRoot, projectDir)
      expect(meta.occurrence_count).toBe(1)
      expect(meta.classification).toBe("unknown")
      expect(meta.tool).toBe("")
      // 普通反馈经白名单脱敏保存
      const { entries } = readToolInsightJsonl(toolInsightPaths(join(logRoot, logSlug(projectDir))).evidence)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.kind).toBe("user_report")
      expect(entries[0]?.fields.userFeedback).toContain("导出章节列表")
      // 证据带文档归属键（启动对账按它摄取孤儿）并触发整理入队
      expect(entries[0]?.fields.fingerprint).toBe(meta.fingerprint)
      expect(entries[0]?.fields.issue).toEqual({ tool: "", scenario: "user_report", errorCategory: "user_report" })
      expect(enqueued).toEqual([{ fingerprint: meta.fingerprint, sessionID: "ses_user" }])

      // 写作外流程问题走同一路径：同一文档追加新发生
      const second = await tool.execute({ action: "record", feedback: "设置页无法搜索" }, ctx)
      expect(typeof second === "string" ? second : second.output).toContain("已记录为新的一次发生")
      expect(readUserReport(logRoot, projectDir).meta.occurrence_count).toBe(2)
      expect(enqueued).toHaveLength(2)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("supplement：沿用原发生实例，出现次数不增加", async () => {
    const { configDir, logRoot, projectDir } = fixture("supplement")
    try {
      const tool = makeTool(configDir)
      const ctx = makeContext(projectDir)
      const first = await tool.execute({ action: "record", feedback: "续写建议经常忽略前文伏笔" }, ctx)
      const fingerprint = typeof first === "string" ? "" : String((first as { metadata?: { fingerprint?: string } }).metadata?.fingerprint)
      expect(fingerprint).not.toBe("")

      const before = readUserReport(logRoot, projectDir).meta
      const supplement = await tool.execute(
        { action: "supplement", fingerprint, feedback: "补充：换卷之后更明显，角色动机总是丢" },
        ctx,
      )
      const output = typeof supplement === "string" ? supplement : supplement.output
      expect(output).toContain("已作为补充反馈追加")
      const after = readUserReport(logRoot, projectDir).meta
      expect(after.occurrence_count).toBe(before.occurrence_count)
      expect(after.occurrence_ids).toEqual(before.occurrence_ids)
      expect(after.evidence_ids).toHaveLength(before.evidence_ids.length + 1)

      // 明确新发生才建新实例
      const again = await tool.execute(
        { action: "supplement", fingerprint, feedback: "这次是又一次新发生", new_occurrence: true },
        ctx,
      )
      expect(typeof again === "string" ? again : again.output).toContain("已按新一次发生记录")
      expect(readUserReport(logRoot, projectDir).meta.occurrence_count).toBe(before.occurrence_count + 1)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("正文不能经普通反馈绕过白名单：截断脱敏；正文例外走独立字段保存本体", async () => {
    const { configDir, logRoot, projectDir } = fixture("exception")
    try {
      const tool = makeTool(configDir)
      const ctx = makeContext(projectDir)
      const novelText = `第一千零二十四章 主角挺身而出。${"风起云涌的正文段落。".repeat(40)}`
      await tool.execute({ action: "record", feedback: novelText }, ctx)

      const { entries } = readToolInsightJsonl(toolInsightPaths(join(logRoot, logSlug(projectDir))).evidence)
      const feedback = String(entries[0]?.fields.userFeedback)
      expect(feedback.length).toBeLessThanOrEqual(210)
      expect(feedback.endsWith("…(截断)")).toBe(true)

      // 必要正文必须经 content_exception 字段：显式本地保留授权，保存片段本体
      const exceptionResult = await tool.execute({ action: "record", feedback: "这段节奏有问题", content_exception: "他抬头看天，云层压得很低。" }, ctx)
      const output = typeof exceptionResult === "string" ? exceptionResult : exceptionResult.output
      expect(output).toContain("已记录为新的一次发生")
      const all = readToolInsightJsonl(toolInsightPaths(join(logRoot, logSlug(projectDir))).evidence)
      const exceptionEntry = all.entries.find((entry) => entry.kind === "content_exception")
      expect(exceptionEntry).toBeDefined()
      expect(exceptionEntry?.fields.text).toBe("他抬头看天，云层压得很低。")
      expect(exceptionEntry?.fields.shareWarning).toBe(true)
      expect(exceptionEntry?.fields.length).toBe(13)
      // 模型使用授权随证据持久化：初始为空（grants 为空即对模型不可见）
      expect(exceptionEntry?.fields.grants).toEqual([])
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("未启用时显式拒绝，不静默落盘", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "tool-insight-disabled-cfg-"))
    const projectDir = mkdtempSync(join(tmpdir(), "tool-insight-disabled-proj-"))
    try {
      const tool = makeTool(configDir)
      const result = await tool.execute({ action: "record", feedback: "问题" }, makeContext(projectDir))
      const output = typeof result === "string" ? result : result.output
      expect(output).toContain("未启用")
      expect(output).toContain("本次未记录任何内容")
    } finally {
      cleanup({ configDir, logRoot: configDir, projectDir })
    }
  })

  test("supplement 缺指纹或指纹不存在时给出去向提示且不落盘", async () => {
    const { configDir, logRoot, projectDir } = fixture("supplement-missing")
    try {
      const tool = makeTool(configDir)
      const ctx = makeContext(projectDir)
      const noFingerprint = await tool.execute({ action: "supplement", feedback: "补充" }, ctx)
      expect(typeof noFingerprint === "string" ? noFingerprint : noFingerprint.output).toContain("fingerprint")
      const missing = await tool.execute({ action: "supplement", fingerprint: "deadbeef00000000", feedback: "补充" }, ctx)
      expect(typeof missing === "string" ? missing : missing.output).toContain("不存在")
      expect(readToolInsightJsonl(toolInsightPaths(join(logRoot, logSlug(projectDir))).evidence).entries).toHaveLength(0)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("reorganize：整理过的证据全部放回 pending，恢复待整理状态", async () => {
    const { configDir, logRoot, projectDir } = fixture("reorganize")
    try {
      const reorganizeEnqueued: Array<{ fingerprint: string; sessionID?: string }> = []
      const tool = makeTool(configDir, (fingerprint, sessionID) => reorganizeEnqueued.push({ fingerprint, sessionID }))
      const ctx = makeContext(projectDir)
      const first = await tool.execute({ action: "record", feedback: "初始反馈" }, ctx)
      const fingerprint = typeof first === "string" ? "" : String((first as { metadata?: { fingerprint?: string } }).metadata?.fingerprint)
      const paths = toolInsightPaths(join(logRoot, logSlug(projectDir)))
      // 模拟一次已完成的后台整理
      const applied = await organizeUnderLock(file, paths, { fingerprint }, async () => ({
        hypotheses: "旧假设",
        suggestions: "旧建议",
        acceptance: "旧标准",
      }))
      expect(applied).toEqual({ applied: true, organized: readUserReport(logRoot, projectDir).meta.organized_evidence_ids })

      const result = await tool.execute({ action: "reorganize", fingerprint }, ctx)
      const output = typeof result === "string" ? result : result.output
      expect(output).toContain("已回到待整理状态")
      // record 与重新整理各入队一次；重新整理触发后台队列再派生一次整理
      expect(reorganizeEnqueued).toEqual([
        { fingerprint: readUserReport(logRoot, projectDir).meta.fingerprint, sessionID: "ses_user" },
        { fingerprint, sessionID: "ses_user" },
      ])
      const meta = readUserReport(logRoot, projectDir).meta
      expect(meta.organize_status).toBe("pending")
      expect(meta.pending_evidence_ids).toEqual(meta.evidence_ids)
      expect(meta.organized_evidence_ids).toEqual([])
      // 旧段落保留到下一次整理成功时才替换
      const doc = readUserReport(logRoot, projectDir)
      expect(doc.sections["原因假设"]).toBe("旧假设")
      // 证据与发生次数不变
      expect(meta.occurrence_count).toBe(1)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("工具注册：tool_insight 三个动作共享单一工具定义", () => {
    const configDir = mkdtempSync(join(tmpdir(), "tool-insight-shape-cfg-"))
    try {
      const tool = makeTool(configDir)
      // 工具注册计数受影响面检查：单一入口 + 三 action 字面量
      expect(tool.description).toContain("record")
      expect(tool.description).toContain("supplement")
      expect(tool.description).toContain("reorganize")
    } finally {
      rmSync(configDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

describe("负反馈信号工具入口（任务 4.3/4.4）", () => {
  const signal = (id: string, occurrenceID: string, targetScope: string, feedbackCategory: string) => ({
    id,
    ts: Date.parse("2026-01-01T00:00:00Z"),
    projectID: "proj_signal",
    sessionID: "ses_signal",
    promptMessageID: `msg_${id}`,
    targetScope,
    feedbackCategory,
    occurrenceID,
  })

  async function seedSignals(paths: ReturnType<typeof toolInsightPaths>, signals: unknown[]) {
    const appended = await appendSignalUnderLock(file, paths, signals)
    expect(appended).toEqual({ appended: true })
  }

  test("list_signals 无原文；upgrade_signal 携带发生实例与脱敏反馈", async () => {
    const { configDir, logRoot, projectDir } = fixture("signal-list")
    try {
      const paths = toolInsightPaths(join(logRoot, logSlug(projectDir)))
      await seedSignals(paths, [signal("sig_1", "oci_1", "writing", "result_rejected")])
      const tool = makeTool(configDir)
      const ctx = makeContext(projectDir)
      const listed = await tool.execute({ action: "list_signals" }, ctx)
      const listOutput = typeof listed === "string" ? listed : listed.output
      expect(listOutput).toContain("sig_1")
      expect(listOutput).toContain("writing/result_rejected")
      expect(listOutput).toContain("待确认")
      expect(listOutput).not.toContain("不对")

      const upgraded = await tool.execute(
        {
          action: "upgrade_signal",
          signal_ids: ["sig_1"],
          feedback: `api_key=raw-secret ${"很长的用户影响描述。".repeat(40)}`,
        },
        ctx,
      )
      expect(typeof upgraded === "string" ? upgraded : upgraded.output).toContain("已升级 1 条信号")
      const evidence = readToolInsightJsonl(paths.evidence).entries
      expect(evidence).toHaveLength(1)
      expect(evidence[0]?.occurrenceID).toBe("oci_1")
      expect(evidence[0]?.fields.signalID).toBe("sig_1")
      expect(evidence[0]?.fields.promptMessageID).toBe("msg_sig_1")
      const feedback = String(evidence[0]?.fields.userFeedback)
      expect(feedback).not.toContain("raw-secret")
      expect(feedback.length).toBeLessThanOrEqual(210)

      const again = await tool.execute({ action: "upgrade_signal", signal_ids: ["sig_1"] }, ctx)
      expect(typeof again === "string" ? again : again.output).toContain("已升级")
      expect(readToolInsightJsonl(paths.evidence).entries).toHaveLength(1)
      expect(listSignals(paths).every((entry) => entry.upgraded)).toBe(true)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("不同目标/类别不误并；批量包含已升级信号时整体跳过", async () => {
    const { configDir, logRoot, projectDir } = fixture("signal-categories")
    try {
      const paths = toolInsightPaths(join(logRoot, logSlug(projectDir)))
      await seedSignals(paths, [
        signal("sig_tool", "oci_tool", "tool", "tool_misuse"),
        signal("sig_flow", "oci_flow", "process", "flow_issue"),
      ])
      const tool = makeTool(configDir)
      const ctx = makeContext(projectDir)
      const upgraded = await tool.execute({ action: "upgrade_signal", signal_ids: ["sig_tool", "sig_flow"] }, ctx)
      expect(typeof upgraded === "string" ? upgraded : upgraded.output).toContain("已升级 2 条信号")
      const evidence = readToolInsightJsonl(paths.evidence).entries
      expect(evidence).toHaveLength(2)
      expect(new Set(evidence.map((entry) => entry.fields.signalID))).toEqual(new Set(["sig_tool", "sig_flow"]))
      expect(evidence[0]?.fields.fingerprint).not.toBe(evidence[1]?.fields.fingerprint)
      const issueDocs = readdirSync(paths.issuesDir).filter((name) => name.endsWith(".md"))
      expect(issueDocs).toHaveLength(2)
      for (const entry of evidence) {
        const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(paths, String(entry.fields.fingerprint)), "utf-8"))
        if (parsed.error) throw new Error("expected parseable issue doc")
        expect(parsed.meta.occurrence_count).toBe(1)
        expect(parsed.sections["用户目标"]).toBe("未知")
      }

      const skipped = await tool.execute({ action: "upgrade_signal", signal_ids: ["sig_tool", "sig_flow"] }, ctx)
      expect(typeof skipped === "string" ? skipped : skipped.output).toContain("整体跳过")
      expect(readToolInsightJsonl(paths.evidence).entries).toHaveLength(2)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("归属信息不足时拒绝；列表保持无原文", async () => {
    const { configDir, logRoot, projectDir } = fixture("signal-ownership")
    try {
      const paths = toolInsightPaths(join(logRoot, logSlug(projectDir)))
      await seedSignals(paths, [signal("sig_missing", "oci_missing", "writing", "result_rejected")])
      const tool = makeTool(configDir, () => {}, { resolve: async () => undefined })
      const ctx = makeContext(projectDir)
      const listed = await tool.execute({ action: "list_signals" }, ctx)
      expect(typeof listed === "string" ? listed : listed.output).toContain("无法确认当前会话的项目归属")
      expect(existsSync(paths.signals)).toBe(true)
      expect(existsSync(paths.evidence)).toBe(false)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })
})
  test("索引随建档与补充确定性更新", async () => {
    const { configDir, logRoot, projectDir } = fixture("index")
    try {
      const tool = makeTool(configDir)
      const ctx = makeContext(projectDir)
      await tool.execute({ action: "record", feedback: "第一条" }, ctx)
      const paths = toolInsightPaths(join(logRoot, logSlug(projectDir)))
      const first = readFileSync(paths.index, "utf-8")
      expect(first).toContain("共 1 个问题")
      await tool.execute({ action: "record", feedback: "第二条" }, ctx)
      const second = readFileSync(paths.index, "utf-8")
      expect(second).toContain("共 1 个问题")
      expect(second).toContain("| 2 |")
      expect(readdirSync(paths.issuesDir).filter((name) => name.endsWith(".md"))).toHaveLength(1)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })
})
