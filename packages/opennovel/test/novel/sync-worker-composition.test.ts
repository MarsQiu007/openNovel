import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { sql } from "drizzle-orm"
import { MockLanguageModelV3 } from "ai/test"
import { Effect } from "effect"
import { ProjectV2 } from "@opennovel-ai/core/project"
import {
  closeDb,
  getDb,
  createChapter,
  enqueueManualEditSync,
  NovelTable,
  querySyncStatus,
  upsertSoul,
} from "@opennovel-ai/novel-store"
import { InstanceStore } from "../../src/project/instance-store"
import type { InstanceContext } from "../../src/project/instance-context"
import { Provider } from "../../src/provider/provider"
import { clearSyncHandlers, processSyncQueue } from "../../src/novel/manual-edit-sync-worker"
import { registerNovelSyncHandler } from "../../src/novel/sync-worker-composition"
import { ProviderTest } from "../fake/provider"

let projectDir: string
let novelId: string

beforeEach(() => {
  projectDir = join(tmpdir(), `sync-worker-composition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  db.insert(NovelTable).values({ id: novelId, title: "组合层测试", genre: "玄幻" }).run()
  clearSyncHandlers()
})

afterEach(() => {
  clearSyncHandlers()
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 SQLite 文件句柄可能短暂未释放
  }
})

function createTestStore(directory: string): InstanceStore.Interface {
  return {
    load: () =>
      Effect.succeed({
        directory,
        worktree: directory,
        project: {
          id: ProjectV2.ID.make("smoke-project"),
          worktree: directory,
          time: { created: 0, updated: 0 },
          sandboxes: [],
        },
      } satisfies InstanceContext),
    reload: () => Effect.die(new Error("不应 reload")),
    dispose: () => Effect.void,
    disposeDirectory: () => Effect.void,
    disposeAll: () => Effect.void,
    provide: (_input, effect) => effect,
  }
}

function createSoulCaptureProvider() {
  const mdl = ProviderTest.model()
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "本章摘要",
            key_events: ["关键事件"],
            char_changes: ["角色变化"],
            spine: [{ content: "主轴条目", kind: "chapter" }],
          }),
        },
      ],
      finishReason: { unified: "stop", raw: undefined } as const,
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    }),
  })
  return {
    model,
    provider: {
      list: () => Effect.succeed({}),
      getProvider: () => Effect.die(new Error("不应读取 provider")),
      getModel: () => Effect.succeed(mdl),
      getLanguage: () => Effect.succeed(model),
      closest: () => Effect.succeed(undefined),
      getSmallModel: () => Effect.succeed(undefined),
      defaultModel: () => Effect.succeed({ providerID: mdl.providerID, modelID: mdl.id }),
    },
  }
}

function systemTextOf(prompt: Array<{ role: string; content: unknown }>) {
  const message = prompt.find((entry) => entry.role === "system")
  return typeof message?.content === "string" ? message.content : undefined
}

describe("registerNovelSyncHandler", () => {
  test("无默认模型时任务 failed 且原因包含模型提示", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: chapter.id,
        field: "content",
        sourceFingerprint: "fp-composition",
        source: "upgrade",
      },
      projectDir,
    )
    registerNovelSyncHandler({
      list: () => Effect.succeed({}),
      getProvider: () => Effect.die(new Error("不应读取 provider")),
      getModel: () => Effect.die(new Error("不应加载模型")),
      getLanguage: () => Effect.die(new Error("不应加载语言模型")),
      closest: () => Effect.succeed(undefined),
      getSmallModel: () => Effect.succeed(undefined),
      defaultModel: () => Effect.fail(new Provider.NoProvidersError()),
    }, createTestStore(projectDir))

    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(0)

    const entries = await querySyncStatus(novelId, { status: "failed" }, projectDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].failure_reason).toContain("无可用语言模型")
  })

  test("小说灵魂优先于全局灵魂注入重建", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    await upsertSoul(novelId, "小说人格", projectDir)
    const configDir = join(projectDir, "config")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "soul.md"), "全局人格")
    const { model, provider } = createSoulCaptureProvider()
    registerNovelSyncHandler(provider, createTestStore(projectDir), configDir)
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: chapter.id,
        field: "content",
        sourceFingerprint: "fp-novel-soul",
        source: "upgrade",
      },
      projectDir,
    )

    await processSyncQueue(projectDir)

    expect(model.doGenerateCalls).toHaveLength(1)
    expect(systemTextOf(model.doGenerateCalls[0].prompt)).toBe("小说人格")
  })

  test("未设小说灵魂时回退全局灵魂", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    const configDir = join(projectDir, "config")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "soul.md"), "全局人格")
    const { model, provider } = createSoulCaptureProvider()
    registerNovelSyncHandler(provider, createTestStore(projectDir), configDir)
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: chapter.id,
        field: "content",
        sourceFingerprint: "fp-global-soul",
        source: "upgrade",
      },
      projectDir,
    )

    await processSyncQueue(projectDir)

    expect(model.doGenerateCalls).toHaveLength(1)
    expect(systemTextOf(model.doGenerateCalls[0].prompt)).toBe("全局人格")
  })

  test("小说与全局灵魂均为空时不注入系统提示词", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    const configDir = join(projectDir, "config")
    mkdirSync(configDir, { recursive: true })
    const { model, provider } = createSoulCaptureProvider()
    registerNovelSyncHandler(provider, createTestStore(projectDir), configDir)
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: chapter.id,
        field: "content",
        sourceFingerprint: "fp-empty-soul",
        source: "upgrade",
      },
      projectDir,
    )

    await processSyncQueue(projectDir)

    expect(model.doGenerateCalls).toHaveLength(1)
    expect(systemTextOf(model.doGenerateCalls[0].prompt)).toBeUndefined()
    const synced = await querySyncStatus(novelId, { status: "synced" }, projectDir)
    expect(synced).toHaveLength(1)
  })

  test("灵魂读取失败按未设置降级不阻断重建", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    getDb(projectDir).run(sql`DROP TABLE soul`)
    const { model, provider } = createSoulCaptureProvider()
    registerNovelSyncHandler(provider, createTestStore(projectDir), join(projectDir, "missing-config"))
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: chapter.id,
        field: "content",
        sourceFingerprint: "fp-broken-soul",
        source: "upgrade",
      },
      projectDir,
    )

    await processSyncQueue(projectDir)

    expect(model.doGenerateCalls).toHaveLength(1)
    expect(systemTextOf(model.doGenerateCalls[0].prompt)).toBeUndefined()
    const synced = await querySyncStatus(novelId, { status: "synced" }, projectDir)
    expect(synced).toHaveLength(1)
  })

  test("手动与升级来源的重建注入一致", async () => {
    const first = await createChapter(novelId, "第一章", 1, null, projectDir)
    const second = await createChapter(novelId, "第二章", 2, null, projectDir)
    await upsertSoul(novelId, "共享人格", projectDir)
    const configDir = join(projectDir, "config")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "soul.md"), "全局人格")
    const { model, provider } = createSoulCaptureProvider()
    registerNovelSyncHandler(provider, createTestStore(projectDir), configDir)
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: first.id,
        field: "content",
        sourceFingerprint: "fp-source-manual",
        source: "manual",
      },
      projectDir,
    )
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: second.id,
        field: "content",
        sourceFingerprint: "fp-source-upgrade",
        source: "upgrade",
      },
      projectDir,
    )

    await processSyncQueue(projectDir)

    // 全局轮询定时器可能在本用例断言前消费其他目录的遗留任务（复用本 handler 闭包与 model），
    // 计数只认本用例两章标题锚点，避免跨用例串扰
    const rebuildCalls = model.doGenerateCalls.filter((call) => {
      const text = call.prompt.map((entry) => JSON.stringify(entry.content)).join("\n")
      return text.includes("《第一章》") || text.includes("《第二章》")
    })
    expect(rebuildCalls).toHaveLength(2)
    expect(systemTextOf(rebuildCalls[0].prompt)).toBe("共享人格")
    expect(systemTextOf(rebuildCalls[1].prompt)).toBe("共享人格")
  })
})
