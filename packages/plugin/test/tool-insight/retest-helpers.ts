/**
 * 复测测试共享基建（retest.test.ts 与 retest-e2e.test.ts）：
 * 进程内锁 fake、临时项目夹具、确认假体、可控后台会话假体与编排层装配。
 * 落盘与夹具 DB 用真实临时目录；宿主侧授权与 deny-first 物化由 core 真栈测试覆盖。
 */
import { expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { eq } from "drizzle-orm"
import { toolInsightPaths, type ToolInsightPaths } from "@opennovel-ai/novel-store"
import { FIXTURE_UPDATED_TITLE } from "../../src/tool-insight/case-adapter.js"
import { ChapterTable, getDb } from "../../src/novel-writer/session-store.js"
import { issueFingerprint } from "../../src/tool-insight/issue-doc.js"
import { ingestEvidenceIssue } from "../../src/tool-insight/issue-store.js"
import { createToolInsightRetest, type ToolInsightRetest } from "../../src/tool-insight/retest.js"
import { toolInsightProjectSlug } from "../../src/tool-insight/settings.js"
import type { PluginContext } from "../../src/v2/effect/context.js"
import type {
  BackgroundSessionHandle,
  BackgroundSessionInput,
  BackgroundSessionResult,
  SessionDomain,
} from "../../src/v2/effect/session.js"
import type { ConfirmRetestInput, ToolContext } from "../../src/v2/effect/tool.js"

export const fakeLocks = new Map<string, Promise<unknown>>()

export const file = {
  // 与 organizer.test.ts 同款：进程内按键串行化
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

export function fixture(name: string) {
  const configDir = mkdtempSync(join(tmpdir(), `tool-insight-retest-${name}-cfg-`))
  const logRoot = mkdtempSync(join(tmpdir(), `tool-insight-retest-${name}-log-`))
  const projectDir = mkdtempSync(join(tmpdir(), `tool-insight-retest-${name}-proj-`))
  writeFileSync(join(configDir, "opennovel.json"), JSON.stringify({ toolInsight: { enabled: true, directory: logRoot } }))
  return { configDir, logRoot, projectDir }
}

export function cleanup(input: { configDir: string; logRoot: string; projectDir: string }) {
  for (const dir of [input.configDir, input.logRoot, input.projectDir]) {
    // Windows 下句柄释放有短暂延迟：清理失败不影响断言
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {}
  }
}

export const FACTS = { tool: "update_chapter", scenario: "recovery_failed", errorCategory: "StaleRead" } as const
export const FP = issueFingerprint(FACTS)

export function pathsFor(logRoot: string, projectDir: string) {
  return toolInsightPaths(join(logRoot, toolInsightProjectSlug(projectDir)))
}

/** 编排层真实使用的临时根：OS tmpdir + 项目短哈希（祖先链无 opennovel 配置） */
export const tempRootFor = (projectDir: string) => join(tmpdir(), "opennovel-tool-insight", toolInsightProjectSlug(projectDir))

export async function seedIssue(paths: ToolInsightPaths, fingerprint: string, facts: { tool: string; scenario: string; errorCategory: string }) {
  const outcome = await ingestEvidenceIssue(file, paths, {
    fingerprint,
    evidenceID: `ev_retest_${fingerprint.slice(0, 8)}`,
    occurrenceID: "oci_retest_seed",
    evidenceKind: "tool_failed",
    occurredAt: Date.now(),
    facts,
  })
  expect(outcome.documented).toBe(true)
}

export type RunBehavior = (input: BackgroundSessionInput, index: number) => Promise<BackgroundSessionResult>

export function fakeSession(behavior: RunBehavior) {
  const inputs: BackgroundSessionInput[] = []
  const session: Pick<SessionDomain, "startBackground"> = {
    startBackground: async (input) => {
      const index = inputs.length
      inputs.push(input)
      const done = behavior(input, index)
      const handle: BackgroundSessionHandle = { id: `ses_bg_${index}`, done, cancel: async () => {} }
      return handle
    },
  }
  return { session, inputs }
}

export function makeConfirm(behavior?: (input: ConfirmRetestInput) => BackgroundSessionAuthorization | undefined) {
  const calls: ConfirmRetestInput[] = []
  const confirm: NonNullable<ToolContext["confirm"]> = async (input) => {
    calls.push(input)
    return behavior === undefined ? { id: "auth_retest_1", caseDigest: input.caseDigest } : behavior(input)
  }
  return { calls, confirm }
}

export function makeRetest(deps: {
  configDir: string
  projectDir: string
  session: Pick<SessionDomain, "startBackground">
  defaultModel?: () => Promise<{ providerID: string; modelID: string } | undefined>
}): ToolInsightRetest {
  const ctx = {
    file,
    paths: { config: deps.configDir },
    event: {},
    catalog: { defaultModel: deps.defaultModel ?? (async () => ({ providerID: "test", modelID: "test-model" })) },
  } as unknown as PluginContext
  return createToolInsightRetest({ ctx, projectDirectory: deps.projectDir, session: deps.session })
}

/** 夹具当前章节（id+标题），供发车时点与核验相关断言使用 */
export function fixtureChapters(directory: string) {
  return getDb(directory)
    .select({ id: ChapterTable.id, title: ChapterTable.title })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, "case-novel-0001"))
    .all()
}

/** 模拟复测 agent 的合规写入：把夹具章节标题更新为案例固定目标值 */
export function applyFixtureUpdate(directory: string) {
  getDb(directory)
    .update(ChapterTable)
    .set({ title: FIXTURE_UPDATED_TITLE })
    .where(eq(ChapterTable.id, "case-ch-0001"))
    .run()
}
