/**
 * 独立 tool_insight 工具测试（任务 3.4）。
 *
 * 覆盖 tasks.md 3.4 验证：无报错体验问题与写作外流程问题都能记录、补充反馈纠正
 * 旧假设且不增加出现次数（明确新发生才建新实例）、正文不能经普通反馈绕过白名单
 * （截断脱敏，正文例外走独立字段显式授权）、未启用时显式拒绝、重新整理把全部证据
 * 放回 pending。锁用进程内 fake，落盘用真实临时目录。
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { readToolInsightJsonl, toolInsightIssuePath, toolInsightPaths } from "@opennovel-ai/novel-store"
import { createToolInsightTool } from "../../src/tool-insight/tool.js"
import { issueFingerprint, parseIssueDoc } from "../../src/tool-insight/issue-doc.js"
import { organizeUnderLock } from "../../src/tool-insight/issue-store.js"
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

function makeTool(configDir: string) {
  return createToolInsightTool({ configDir, file }) as unknown as ToolSpec<Record<string, unknown>, unknown>
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
      const tool = makeTool(configDir)
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

      // 写作外流程问题走同一路径：同一文档追加新发生
      const second = await tool.execute({ action: "record", feedback: "设置页无法搜索" }, ctx)
      expect(typeof second === "string" ? second : second.output).toContain("已记录为新的一次发生")
      expect(readUserReport(logRoot, projectDir).meta.occurrence_count).toBe(2)
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
      const tool = makeTool(configDir)
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
