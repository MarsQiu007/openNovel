import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Effect } from "effect"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { closeDb, getDb, createChapter, enqueueManualEditSync, NovelTable, querySyncStatus } from "@opennovel-ai/novel-store"
import { InstanceStore } from "../../src/project/instance-store"
import type { InstanceContext } from "../../src/project/instance-context"
import { Provider } from "../../src/provider/provider"
import { clearSyncHandlers, processSyncQueue } from "../../src/novel/manual-edit-sync-worker"
import { registerNovelSyncHandler } from "../../src/novel/sync-worker-composition"

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
    }, {
      load: () =>
        Effect.succeed({
          directory: projectDir,
          worktree: projectDir,
          project: {
            id: ProjectV2.ID.make("smoke-project"),
            worktree: projectDir,
            time: { created: 0, updated: 0 },
            sandboxes: [],
          },
        } satisfies InstanceContext),
      reload: () => Effect.die(new Error("不应 reload")),
      dispose: () => Effect.void,
      disposeDirectory: () => Effect.void,
      disposeAll: () => Effect.void,
      provide: (_input, effect) => effect,
    } satisfies InstanceStore.Interface)

    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(0)

    const entries = await querySyncStatus(novelId, { status: "failed" }, projectDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].failure_reason).toContain("无可用语言模型")
  })
})
