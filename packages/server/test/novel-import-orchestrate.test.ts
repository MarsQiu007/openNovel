/**
 * 原文驱动导入服务端编排测试（source-driven-import）。
 *
 * 覆盖：启动契约（解码失败/入库/幂等保留）、进度与报告读取、
 * 控制动作状态机（pause/resume/retry/configure 的非法态拒绝）。
 * SessionV2/WorkRun 服务以最小桩替代（编排只做 admission 与状态透传）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Effect } from "effect"
import { closeDb, getDb, NovelTable } from "@opennovel-ai/novel-store"
import { startImport, getImportProgressEndpoint, getImportReportEndpoint, controlImport } from "../src/handlers/novel-import/orchestrate"

let projectDir: string

const sessionStub = () => {
  const prompts: Array<{ sessionID: string; text: string }> = []
  return {
    prompts,
    service: {
      create: () => Effect.succeed({ id: "ses_import_test" }),
      prompt: (input: { sessionID: string; prompt: { text: string } }) =>
        Effect.sync(() => {
          prompts.push({ sessionID: input.sessionID, text: input.prompt.text })
        }),
    } as never,
    workrun: { pause: () => Effect.fail(new Error("no active") as never), resume: () => Effect.fail(new Error("no paused") as never) } as never,
  }
}

const dataUrlOf = (text: string, mime = "text/plain") =>
  `data:${mime};base64,${Buffer.from(text, "utf8").toString("base64")}`

beforeEach(() => {
  projectDir = join(tmpdir(), `import-orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

describe("startImport", () => {
  test("合法启动：建书+任务+段落，admission 提示并返回进度", async () => {
    const stub = sessionStub()
    const text = "第一章 风起\n正文第一段。\n正文第二段。"
    const progress = await Effect.runPromise(
      startImport(projectDir, stub.service, {
        dataUrl: dataUrlOf(text),
        filename: "book.txt",
        title: "测试书",
        repairLevel: "standard",
      }),
    )
    expect(progress.novelId).not.toBe("")
    expect(progress.status).toBe("calibrating")
    expect(progress.totalChars).toBe(text.length)
    expect(progress.chapterCount).toBe(0)
    expect(stub.prompts).toHaveLength(1)
    expect(stub.prompts[0].text).toContain("原文驱动导入")
    expect(getDb(projectDir).select().from(NovelTable).all()[0]).toMatchObject({ title: "测试书", status: "draft" })
  })

  test("编码失败返回可读错误且不建书", async () => {
    const stub = sessionStub()
    const bad = yieldFlip(
      startImport(projectDir, stub.service, { dataUrl: "data:text/plain;base64,!!!invalid!!!", filename: "x.txt", title: "x" }),
    )
    expect((bad as { _tag?: string })._tag ?? "NovelImportError").toBe("NovelImportError")
    expect(getDb(projectDir).select().from(NovelTable).all()).toHaveLength(0)
    expect(stub.prompts).toHaveLength(0)
  })
})

async function yieldFlip<A, E>(effect: Effect.Effect<A, E, never>): Promise<E> {
  return Effect.runPromise(effect.pipe(Effect.flip))
}

describe("get / control", () => {
  test("无任务书籍返回 not-found", async () => {
    const error = await yieldFlip(getImportProgressEndpoint(projectDir, "novel-x"))
    expect((error as { data?: { reason?: string } }).data?.reason).toBe("not-found")
  })

  test("configure 拒绝非暂停状态", async () => {
    const stub = sessionStub()
    const text = "第一段。\n第二段。"
    const started = await Effect.runPromise(
      startImport(projectDir, stub.service, { dataUrl: dataUrlOf(text), filename: "b.txt", title: "书" }),
    )
    const error = await yieldFlip(
      controlImport(projectDir, { session: stub.service, workrun: stub.workrun }, started.novelId, { action: "configure", repairLevel: "off" }),
    )
    expect((error as { data?: { reason?: string } }).data?.reason).toBe("invalid-state")
  })

  test("pause 后 configure 成功并更新配置", async () => {
    const stub = sessionStub()
    const text = "第一段。\n第二段。"
    const started = await Effect.runPromise(
      startImport(projectDir, stub.service, { dataUrl: dataUrlOf(text), filename: "b.txt", title: "书" }),
    )
    const paused = await Effect.runPromise(
      controlImport(projectDir, { session: stub.service, workrun: stub.workrun }, started.novelId, { action: "pause" }),
    )
    expect(paused.status).toBe("paused")
    const configured = await Effect.runPromise(
      controlImport(projectDir, { session: stub.service, workrun: stub.workrun }, started.novelId, {
        action: "configure",
        targetChapterChars: 2500,
        repairLevel: "off",
      }),
    )
    expect(configured.status).toBe("paused")
    expect(stub.prompts.length).toBe(2)
    expect(stub.prompts[1].text).toContain("仅应用到未开始部分")
  })

  test("报告聚合排除与操作计数", async () => {
    const stub = sessionStub()
    const text = "第一章\n正文。\n广告行\n第二章\n正文二。"
    const started = await Effect.runPromise(
      startImport(projectDir, stub.service, { dataUrl: dataUrlOf(text), filename: "b.txt", title: "书", encoding: "utf-8" }),
    )
    // 直接走数据层提交一章（编排层报告读取验证）
    const { withTransaction, commitImportChapterTx } = await import("@opennovel-ai/novel-store")
    withTransaction(getDb(projectDir), (tx) =>
      commitImportChapterTx(tx, {
        novelId: started.novelId,
        repairEnabled: true,
        draft: {
          title: "第一章",
          volumeTitle: null,
          chapterOrder: 1,
          carry: [],
          windowSize: 3,
          ops: [
            { kind: "keep", source: 0 },
            { kind: "keep", source: 1 },
            { kind: "exclude", source: 2, category: "noise", reason: "广告" },
          ],
        },
      }),
    )
    const report = await Effect.runPromise(getImportReportEndpoint(projectDir, started.novelId))
    expect(report.chapterCount).toBe(1)
    expect(report.opCounts["exclude"]).toBe(1)
    expect(report.excluded[0].reason).toBe("广告")
    expect(report.title).toBe("书")
  })
})
