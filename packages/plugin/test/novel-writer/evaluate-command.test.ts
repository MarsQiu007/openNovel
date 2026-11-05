/**
 * /evaluate 手动入口测试（2.2，design D4.1）
 *
 * 覆盖：模板命令注册（CommandDraft upsert 语义对齐 core——update 即 upsert）、
 * 模板含 $ARGUMENTS 占位与四类范围、agent 指向 director；
 * evaluate 工具执行（scope 全分支解析、默认 since-last、产物落盘回贴）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, readFileSync, rmSync, appendFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeDb } from "../../src/novel-writer/session-store.js"
import { recordMetricsBatch, getMetricsDir, getMetricsPath } from "../../src/novel-writer/evaluate/metrics.js"
import { registerEvaluateCommand } from "../../src/novel-writer/evaluate/command.js"
import { evaluateTools } from "../../src/novel-writer/tools/evaluate.js"
import type { CommandDraft } from "../../src/v2/effect/command.js"
import type { CommandV2Info } from "@opennovel-ai/sdk/v2/types"
import { createToolContext } from "./runtime-assembly-helpers.js"

type ToolExecResult = Awaited<ReturnType<typeof evaluateTools.evaluate.execute>>

function metadataOf(result: ToolExecResult): Record<string, unknown> {
  if (typeof result === "string" || result.metadata === undefined) throw new Error("evaluate 工具应返回 metadata")
  return result.metadata
}

function metaString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key]
  if (typeof value !== "string") throw new Error(`metadata.${key} 应为 string`)
  return value
}

function fakeDraft() {
  const commands = new Map<string, CommandV2Info>()
  const draft: CommandDraft = {
    list: () => [...commands.values()],
    get: (name) => commands.get(name),
    update: (name, update) => {
      const fallback: CommandV2Info = { name, template: "" }
      const current = commands.get(name) ?? fallback
      if (!commands.has(name)) commands.set(name, current)
      update(current)
      current.name = name
    },
    remove: (name) => {
      commands.delete(name)
    },
  }
  return { draft }
}

describe("registerEvaluateCommand 模板命令注册", () => {
  test("upsert /evaluate：模板含 $ARGUMENTS 与四类范围，agent 指向 director", () => {
    const { draft } = fakeDraft()
    registerEvaluateCommand(draft)
    const command = draft.get("evaluate")
    expect(command).toBeDefined()
    expect(command?.template).toContain("$ARGUMENTS")
    expect(command?.template).toContain("evaluate 工具")
    expect(command?.template).toContain("since-last")
    expect(command?.template).toContain("volume")
    expect(command?.template).toContain("sessions N")
    expect(command?.template).toContain("all")
    expect(command?.description).toContain("创作自评价报告")
    expect(command?.agent).toBe("director")
    // 幂等：重复注册不叠加副作用
    registerEvaluateCommand(draft)
    expect(draft.list().filter((c) => c.name === "evaluate")).toHaveLength(1)
  })
})

describe("evaluate 工具执行", () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = join(tmpdir(), `eval-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(projectDir, { recursive: true })
  })

  afterEach(() => {
    closeDb(projectDir)
    try {
      rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {
      // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
    }
  })

  test("scope=all：生成三分部报告，输出含全文与落盘路径，文件可读回", async () => {
    recordMetricsBatch(projectDir, [
      { domain: "c5-flow", key: "version.rollback", delta: 2 },
      { domain: "c2-prompt-control", key: "approval.requested", delta: 3 },
      { domain: "c2-prompt-control", key: "approval.rejected", delta: 2 },
      { domain: "c7-narrative", key: "hook.warning.face_slap", delta: 1 },
    ])

    const result = await evaluateTools.evaluate.execute({ scope: "all" }, createToolContext(projectDir))

    expect(result.title).toBe("evaluate")
    expect(result.output).toContain("## A. 创作复盘")
    expect(result.output).toContain("## B. 配置优化建议")
    expect(result.output).toContain("## C. 产品信号")
    expect(result.output).toContain("[B3]")
    expect(result.output).toContain("报告已落盘：")
    const metadata = metadataOf(result)
    expect(metadata.scope).toBe("all")
    expect(metadata.entry_count).toBe(4)
    expect(readFileSync(metaString(metadata, "path"), "utf8")).toContain("## A. 创作复盘")
  })

  test("默认 scope=since-last：首报纳入既有条目，空数据不编造", async () => {
    const empty = await evaluateTools.evaluate.execute({}, createToolContext(projectDir))
    expect(metadataOf(empty).scope).toBe("since-last")
    expect(empty.output).toContain("本轮无配置建议")
    expect(empty.output).not.toContain("[B1]")

    // 直接写 JSONL 并取状态时间戳 +1：Windows 时钟粒度粗（~15.6ms），recordMetrics 的
    // 真实 Date.now() 可能与 lastRunTs 同毫秒而被 `e.ts > lastRunTs` 排除（时序 flake）
    const state: unknown = JSON.parse(
      readFileSync(join(getMetricsDir(projectDir), "last-report.json"), "utf8"),
    )
    if (typeof state !== "object" || state === null || !("lastRunTs" in state) || typeof state.lastRunTs !== "number") {
      throw new Error("报告状态文件格式异常")
    }
    const { lastRunTs } = state
    appendFileSync(
      getMetricsPath(projectDir),
      JSON.stringify({ ts: lastRunTs + 1, domain: "c1-runtime", key: "session.created", delta: 1 }) + "\n",
    )
    const second = await evaluateTools.evaluate.execute({}, createToolContext(projectDir))
    expect(metadataOf(second).entry_count).toBe(1)
  })

  test("scope=sessions 带 count：scopeSlug 反映会话数", async () => {
    recordMetricsBatch(projectDir, [{ domain: "c1-runtime", key: "session.created", delta: 1 }])
    const result = await evaluateTools.evaluate.execute(
      { scope: "sessions", count: 2 },
      createToolContext(projectDir),
    )
    expect(metadataOf(result).scope).toBe("sessions-2")
  })
})
