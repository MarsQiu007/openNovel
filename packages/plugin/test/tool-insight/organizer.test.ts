/**
 * 无工具后台归因整理队列与启动恢复测试（任务 4.1/4.2）。
 *
 * 覆盖 tasks.md 4.1 验证：同指纹合并只发车一次、运行中新证据完成后只再派生一次、
 * prompt 只含问题骨架/本批脱敏证据/已授权片段（未授权片段与授权结构对模型不可见）、
 * 结构化输出校验后写回指定段落、非法输出与失败落状态且保留 pending、取消静默、
 * 发车前拒绝（无模型）保留 pending 不隐式替换；以及 4.2 验证：孤儿证据重新摄取、
 * 引用不一致补回 pending、索引重建、启动只补一次、未启用与中部损坏跳过、恢复走
 * 显式目录的顶层归因会话。锁用进程内 fake，落盘用真实临时目录。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { toolInsightIssuePath, toolInsightPaths } from "@opennovel-ai/novel-store"
import {
  createContentException,
  grantContentModelUse,
  type ToolInsightEvidence,
} from "../../src/tool-insight/evidence.js"
import { appendEvidenceUnderLock } from "../../src/tool-insight/evidence-store.js"
import { openToolInsightGate } from "../../src/tool-insight/gate.js"
import { issueFingerprint, parseIssueDoc } from "../../src/tool-insight/issue-doc.js"
import { ingestEvidenceIssue, organizeUnderLock } from "../../src/tool-insight/issue-store.js"
import { createToolInsightOrganizer } from "../../src/tool-insight/organizer.js"
import { toolInsightProjectSlug } from "../../src/tool-insight/settings.js"
import type { PluginContext } from "../../src/v2/effect/context.js"
import type {
  BackgroundSessionHandle,
  BackgroundSessionInput,
  BackgroundSessionResult,
  SessionDomain,
} from "../../src/v2/effect/session.js"

const fakeLocks = new Map<string, Promise<unknown>>()

const file = {
  // 与 tool.test.ts 同款：进程内按键串行化
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
  const configDir = mkdtempSync(join(tmpdir(), `tool-insight-organizer-${name}-cfg-`))
  const logRoot = mkdtempSync(join(tmpdir(), `tool-insight-organizer-${name}-log-`))
  const projectDir = mkdtempSync(join(tmpdir(), `tool-insight-organizer-${name}-proj-`))
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

const fakeCtx = (configDir: string) =>
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 测试假件只用到 file 与 paths.config 两个域
  ({ file, paths: { config: configDir }, event: {} }) as unknown as PluginContext

const str = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const got = Reflect.get(value, key)
  return typeof got === "string" ? got : undefined
}

/** 测试数据里 issue 归属键的守卫读取：字段缺失返回 undefined（配合非空断言使用） */
const issueFacts = (record: unknown): { tool: string; scenario: string; errorCategory: string } | undefined => {
  const tool = str(record, "tool")
  const scenario = str(record, "scenario")
  const errorCategory = str(record, "errorCategory")
  return tool === undefined || scenario === undefined || errorCategory === undefined ? undefined : { tool, scenario, errorCategory }
}

const ORGANIZE_OUTPUT = { hypotheses: "工具描述遗漏了必填参数说明", suggestions: "补充参数文档并在校验失败时提示", acceptance: "再次调用时不再出现同类 NotFoundError" }
const success = (payload: unknown): BackgroundSessionResult => ({ status: "success", text: JSON.stringify(payload) })

interface FakeSession {
  session: Pick<SessionDomain, "startBackground">
  inputs: BackgroundSessionInput[]
  /** 手动放行最近一次发车；返回放行函数 */
  deferred: () => (result: BackgroundSessionResult) => void
}

function fakeSession(): FakeSession {
  const inputs: BackgroundSessionInput[] = []
  let pendingResolve: ((result: BackgroundSessionResult) => void) | undefined
  const session: Pick<SessionDomain, "startBackground"> = {
    startBackground: async (input) => {
      inputs.push(input)
      const done = new Promise<BackgroundSessionResult>((resolve) => {
        pendingResolve = resolve
      })
      const handle: BackgroundSessionHandle = { id: "ses_bg", done, cancel: async () => {} }
      return handle
    },
  }
  return {
    session,
    inputs,
    deferred: () => (result) => {
      const resolve = pendingResolve
      pendingResolve = undefined
      resolve?.(result)
    },
  }
}

function toolFailedEvidence(over?: Partial<ToolInsightEvidence>): ToolInsightEvidence {
  const issue = { tool: "update_chapter", scenario: "tool_failure", errorCategory: "NotFoundError" }
  return {
    id: "ev_fail_1",
    ts: Date.now(),
    kind: "tool_failed",
    projectID: "proj",
    sessionID: "ses_1",
    trigger: "auto",
    occurrenceID: "oci_1",
    fields: { tool: "update_chapter", errorType: "NotFoundError", fingerprint: issueFingerprint(issue), issue },
    ...over,
  }
}

function pathsFor(logRoot: string, projectDir: string) {
  return toolInsightPaths(join(logRoot, toolInsightProjectSlug(projectDir)))
}

function readDoc(paths: ReturnType<typeof toolInsightPaths>, fingerprint: string) {
  const parsed = parseIssueDoc(readFileSync(toolInsightIssuePath(paths, fingerprint), "utf-8"))
  if (parsed.error) throw new Error("expected parseable issue doc")
  return parsed
}

const sleep = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe("归因整理队列（任务 4.1）", () => {
  test("同指纹合并只发车一次；完成后新证据再派生一次且只含新批次", async () => {
    const { configDir, logRoot, projectDir } = fixture("merge")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const first = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [first])
      const fingerprint = String(first.fields.fingerprint)
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: first.id,
        occurrenceID: first.occurrenceID!,
        evidenceKind: first.kind,
        occurredAt: first.ts,
        facts: issueFacts(first.fields.issue)!,
      })
      const fake = fakeSession()
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake.session })
      const release = fake.deferred()

      organizer.enqueue(fingerprint, "ses_user")
      await sleep()
      organizer.enqueue(fingerprint, "ses_other")
      organizer.enqueue(fingerprint, "ses_third")
      await sleep()
      // 运行中同指纹全部合并：只发车一次，父会话取先到的
      expect(fake.inputs).toHaveLength(1)
      expect(fake.inputs[0]?.parentID).toBe("ses_user")
      expect(fake.inputs[0]?.mode).toBe("organize")
      expect(fake.inputs[0]?.agent).toBe("insight-organizer")
      expect(fake.inputs[0]?.expectedTools).toEqual([])

      release(success(ORGANIZE_OUTPUT))
      await sleep(50)
      const meta = readDoc(paths, fingerprint).meta
      expect(meta.organize_status).toBe("organized")
      expect(meta.pending_evidence_ids).toEqual([])
      expect(meta.organized_evidence_ids).toEqual([first.id])
      const sections = readDoc(paths, fingerprint).sections
      expect(sections["原因假设"]).toBe(ORGANIZE_OUTPUT.hypotheses)
      expect(sections["改进建议"]).toBe(ORGANIZE_OUTPUT.suggestions)
      expect(sections["验收标准"]).toBe(ORGANIZE_OUTPUT.acceptance)

      // pending 已空：再入队是空转，不发车
      organizer.enqueue(fingerprint, "ses_user")
      await sleep(30)
      expect(fake.inputs).toHaveLength(1)

      // 整理期间/之后的新证据：完成后恰好再派生一次，prompt 只含新批次
      const second = toolFailedEvidence({ id: "ev_fail_2", occurrenceID: "oci_2" })
      await appendEvidenceUnderLock(file, paths, [second])
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: second.id,
        occurrenceID: second.occurrenceID!,
        evidenceKind: second.kind,
        occurredAt: second.ts,
        facts: issueFacts(second.fields.issue)!,
      })
      organizer.enqueue(fingerprint, "ses_user")
      await sleep()
      expect(fake.inputs).toHaveLength(2)
      expect(fake.inputs[1]?.prompt).toContain("ev_fail_2")
      // 本批 JSONL 只含新证据（骨架段的客观证据列表含历史 ID 属预期）
      expect(fake.inputs[1]?.prompt).not.toContain('"id":"ev_fail_1"')
      release(success(ORGANIZE_OUTPUT))
      await sleep(50)
      expect(readDoc(paths, fingerprint).meta.organized_evidence_ids).toEqual([first.id, second.id])
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("prompt 只含骨架与本批脱敏证据：未授权片段本体与授权结构对模型不可见；授权后可见", async () => {
    const { configDir, logRoot, projectDir } = fixture("redact")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const failed = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [failed])
      const fingerprint = String(failed.fields.fingerprint)
      const facts = issueFacts(failed.fields.issue)!
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: failed.id,
        occurrenceID: failed.occurrenceID!,
        evidenceKind: failed.kind,
        occurredAt: failed.ts,
        facts,
      })
      // 未授权正文例外：grants 为空
      const sealed = createContentException({ text: "未授权片段内容甲" })
      const sealedEvidence: ToolInsightEvidence = {
        id: "ev_exc_1",
        ts: Date.now(),
        kind: "content_exception",
        projectID: "proj",
        sessionID: "ses_user",
        trigger: "user",
        occurrenceID: "oci_1",
        fields: { exceptionID: sealed.id, text: sealed.text, grants: sealed.grants, shareWarning: true },
      }
      await appendEvidenceUnderLock(file, paths, [sealedEvidence])
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: sealedEvidence.id,
        occurrenceID: "oci_1",
        evidenceKind: "content_exception",
        occurredAt: sealedEvidence.ts,
        facts,
      })
      const fake = fakeSession()
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake.session })
      const release = fake.deferred()

      organizer.enqueue(fingerprint, "ses_user")
      await sleep()
      const prompt = fake.inputs[0]?.prompt ?? ""
      // 问题骨架（文档全文）与本批证据在 prompt 里
      expect(prompt).toContain("# 问题骨架")
      expect(prompt).toContain(`"id":"ev_fail_1"`)
      expect(prompt).toContain("ev_exc_1")
      // 片段本体与授权结构绝不进入 prompt
      expect(prompt).not.toContain("未授权片段内容甲")
      expect(prompt).not.toContain('"text"')
      expect(prompt).not.toContain('"grants"')
      expect(prompt).not.toContain("已授权正文片段")

      // 第二批：带 organize 授权的片段可见
      const granted = createContentException({ text: "已授权片段内容乙" })
      grantContentModelUse(granted, { purpose: "organize", subjectDigest: fingerprint })
      const grantedEvidence: ToolInsightEvidence = {
        id: "ev_exc_2",
        ts: Date.now(),
        kind: "content_exception",
        projectID: "proj",
        sessionID: "ses_user",
        trigger: "user",
        occurrenceID: "oci_1",
        fields: { exceptionID: granted.id, text: granted.text, grants: granted.grants, shareWarning: true },
      }
      await appendEvidenceUnderLock(file, paths, [grantedEvidence])
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: grantedEvidence.id,
        occurrenceID: "oci_1",
        evidenceKind: "content_exception",
        occurredAt: grantedEvidence.ts,
        facts,
      })
      release(success(ORGANIZE_OUTPUT))
      await sleep(50)
      organizer.enqueue(fingerprint, "ses_user")
      await sleep()
      const secondPrompt = fake.inputs[1]?.prompt ?? ""
      expect(secondPrompt).toContain("已授权正文片段")
      expect(secondPrompt).toContain("已授权片段内容乙")
      // 未授权片段仍不可见（即使它已被整理过、不在本批）
      expect(secondPrompt).not.toContain("未授权片段内容甲")
      release(success(ORGANIZE_OUTPUT))
      await sleep(50)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("非法输出/执行失败落失败状态且保留 pending；围栏容忍", async () => {
    const { configDir, logRoot, projectDir } = fixture("signals")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const seed = async (id: string) => {
        const record = toolFailedEvidence({ id })
        await appendEvidenceUnderLock(file, paths, [record])
        const fingerprint = String(record.fields.fingerprint)
        await ingestEvidenceIssue(file, paths, {
          fingerprint,
          evidenceID: record.id,
          occurrenceID: record.occurrenceID!,
          evidenceKind: record.kind,
          occurredAt: record.ts,
          facts: issueFacts(record.fields.issue)!,
        })
        return fingerprint
      }

      // 非法输出：不是 JSON
      const fp1 = await seed("ev_bad_json")
      const fake1 = fakeSession()
      const organizer1 = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake1.session })
      organizer1.enqueue(fp1, "ses_user")
      await sleep()
      fake1.deferred()({ status: "success", text: "我认为原因是配置问题" })
      await sleep(50)
      const badMeta = readDoc(paths, fp1).meta
      expect(badMeta.organize_status).toBe("failed")
      expect(badMeta.organize_error).toContain("三段 JSON")
      expect(badMeta.pending_evidence_ids).toContain("ev_bad_json")

      // 执行失败：reason 落入失败状态，pending 保留
      const fp2 = await seed("ev_run_fail")
      const fake2 = fakeSession()
      const organizer2 = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake2.session })
      organizer2.enqueue(fp2, "ses_user")
      await sleep()
      fake2.deferred()({ status: "failure", reason: "无已配置模型：后台整理保留 pending，不隐式改用其他模型" })
      await sleep(50)
      const runMeta = readDoc(paths, fp2).meta
      expect(runMeta.organize_status).toBe("failed")
      expect(runMeta.organize_error).toContain("无已配置模型")
      expect(runMeta.pending_evidence_ids).toContain("ev_run_fail")

      // 围栏容忍：```json 包裹的合法输出照常写回
      const fp4 = await seed("ev_fenced")
      const fake4 = fakeSession()
      const organizer4 = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake4.session })
      organizer4.enqueue(fp4, "ses_user")
      await sleep()
      fake4.deferred()({
        status: "success",
        text: "```json\n" + JSON.stringify(ORGANIZE_OUTPUT) + "\n```",
      })
      await sleep(50)
      expect(readDoc(paths, fp4).meta.organize_status).toBe("organized")
      expect(readDoc(paths, fp4).sections["原因假设"]).toBe(ORGANIZE_OUTPUT.hypotheses)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("取消静默：pending 保留，不落失败状态", async () => {
    const { configDir, logRoot, projectDir } = fixture("cancelled")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const record = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [record])
      const fingerprint = String(record.fields.fingerprint)
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: record.id,
        occurrenceID: record.occurrenceID!,
        evidenceKind: record.kind,
        occurredAt: record.ts,
        facts: issueFacts(record.fields.issue)!,
      })
      const fake = fakeSession()
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake.session })
      organizer.enqueue(fingerprint, "ses_user")
      await sleep()
      fake.deferred()({ status: "cancelled" })
      await sleep(50)
      const meta = readDoc(paths, fingerprint).meta
      expect(meta.organize_status).toBe("pending")
      expect(meta.organize_error).toBeNull()
      expect(meta.pending_evidence_ids).toEqual([record.id])
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("发车前宿主拒绝（无模型）保留 pending，不隐式改用其他模型", async () => {
    const { configDir, logRoot, projectDir } = fixture("nomodel")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const record = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [record])
      const fingerprint = String(record.fields.fingerprint)
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: record.id,
        occurrenceID: record.occurrenceID!,
        evidenceKind: record.kind,
        occurredAt: record.ts,
        facts: issueFacts(record.fields.issue)!,
      })
      const rejecting: Pick<SessionDomain, "startBackground"> = {
        startBackground: () => Promise.reject(new Error("无已配置模型：后台整理保留 pending，不隐式改用其他模型")),
      }
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: rejecting })
      organizer.enqueue(fingerprint, "ses_user")
      await sleep(50)
      const meta = readDoc(paths, fingerprint).meta
      expect(meta.organize_status).toBe("failed")
      expect(meta.organize_error).toContain("无已配置模型")
      expect(meta.pending_evidence_ids).toEqual([record.id])
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })
})

describe("启动崩溃恢复（任务 4.2）", () => {
  test("孤儿证据重新确定性摄取并入队；恢复走显式目录顶层会话；只补一次", async () => {
    const { configDir, logRoot, projectDir } = fixture("orphan")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const record = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [record])
      const fake = fakeSession()
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake.session })

      await organizer.recoverOnce()
      await sleep(50)
      const fingerprint = String(record.fields.fingerprint)
      const meta = readDoc(paths, fingerprint).meta
      expect(meta.evidence_ids).toEqual([record.id])
      expect(meta.pending_evidence_ids).toEqual([record.id])
      expect(existsSync(paths.index)).toBe(true)
      expect(readFileSync(paths.index, "utf-8")).toContain("共 1 个问题")
      // 无父会话：用当前项目目录创建顶层归因会话，无工具
      expect(fake.inputs).toHaveLength(1)
      expect(fake.inputs[0]?.parentID).toBeUndefined()
      expect(fake.inputs[0]?.directory).toBe(projectDir)
      expect(fake.inputs[0]?.expectedTools).toEqual([])
      fake.deferred()(success(ORGANIZE_OUTPUT))
      await sleep(50)

      // 只补一次：装载后再出现的孤儿不由本次实例处理
      const late = toolFailedEvidence({ id: "ev_late" })
      await appendEvidenceUnderLock(file, paths, [late])
      await organizer.recoverOnce()
      await sleep(50)
      expect(readDoc(paths, fingerprint).meta.evidence_ids).not.toContain("ev_late")
      expect(fake.inputs).toHaveLength(1)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("引用但不在 pending/organized 的崩溃残留补回 pending；索引丢失后重建", async () => {
    const { configDir, logRoot, projectDir } = fixture("requeue")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const record = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [record])
      const fingerprint = String(record.fields.fingerprint)
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: record.id,
        occurrenceID: record.occurrenceID!,
        evidenceKind: record.kind,
        occurredAt: record.ts,
        facts: issueFacts(record.fields.issue)!,
      })
      // 模拟已完成整理后 pending/organized 均被清空的崩溃残留
      await organizeUnderLock(file, paths, { fingerprint }, async () => ({ hypotheses: "旧假设", suggestions: "旧建议", acceptance: "旧标准" }))
      const docPath = toolInsightIssuePath(paths, fingerprint)
      const wiped = readFileSync(docPath, "utf-8")
        .replace(/"pending_evidence_ids": \[[^\]]*\]/, '"pending_evidence_ids": []')
        .replace(/"organized_evidence_ids": \[[^\]]*\]/, '"organized_evidence_ids": []')
      writeFileSync(docPath, wiped, "utf-8")
      expect(readDoc(paths, fingerprint).meta.pending_evidence_ids).toEqual([])
      rmSync(paths.index, { force: true })

      const fake = fakeSession()
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake.session })
      await organizer.recoverOnce()
      await sleep(50)
      const meta = readDoc(paths, fingerprint).meta
      expect(meta.pending_evidence_ids).toEqual([record.id])
      expect(meta.organized_evidence_ids).toEqual([])
      expect(existsSync(paths.index)).toBe(true)
      expect(readFileSync(paths.index, "utf-8")).toContain("共 1 个问题")
      // 恢复入队后真实发车一次
      await sleep()
      expect(fake.inputs).toHaveLength(1)
      fake.deferred()(success(ORGANIZE_OUTPUT))
      await sleep(50)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("未启用跳过；证据中部损坏停止对账不摄取", async () => {
    const disabledConfig = mkdtempSync(join(tmpdir(), "tool-insight-organizer-disabled-cfg-"))
    const disabledProject = mkdtempSync(join(tmpdir(), "tool-insight-organizer-disabled-proj-"))
    try {
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(disabledConfig), projectDirectory: disabledProject, session: fakeSession().session })
      await organizer.recoverOnce()
      expect(existsSync(join(disabledProject, ".novel"))).toBe(false)
    } finally {
      cleanup({ configDir: disabledConfig, logRoot: disabledConfig, projectDir: disabledProject })
    }

    const { configDir, logRoot, projectDir } = fixture("corrupt")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const record = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [record])
      // 中部坏行（非最后一行）
      const raw = readFileSync(paths.evidence, "utf-8")
      writeFileSync(paths.evidence, `{"broken":\n${raw}`, "utf-8")
      const fake = fakeSession()
      const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: projectDir, session: fake.session })
      await organizer.recoverOnce()
      await sleep(50)
      expect(fake.inputs).toHaveLength(0)
      expect(existsSync(toolInsightIssuePath(paths, String(record.fields.fingerprint)))).toBe(false)
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })

  test("开关门现值决定发车：目录变化后旧队列静默丢弃", async () => {
    const { configDir, logRoot, projectDir } = fixture("gate")
    try {
      const paths = pathsFor(logRoot, projectDir)
      const record = toolFailedEvidence()
      await appendEvidenceUnderLock(file, paths, [record])
      const fingerprint = String(record.fields.fingerprint)
      await ingestEvidenceIssue(file, paths, {
        fingerprint,
        evidenceID: record.id,
        occurrenceID: record.occurrenceID!,
        evidenceKind: record.kind,
        occurredAt: record.ts,
        facts: issueFacts(record.fields.issue)!,
      })
      const fake = fakeSession()
      // organizer 绑定另一个目录：gate 按 projectDirectory 解析出不同日志根，本日志根不入队
      const otherDir = mkdtempSync(join(tmpdir(), "tool-insight-organizer-gate-other-"))
      try {
        const organizer = createToolInsightOrganizer({ ctx: fakeCtx(configDir), projectDirectory: otherDir, session: fake.session })
        organizer.enqueue(fingerprint, "ses_user")
        await sleep(50)
        expect(fake.inputs).toHaveLength(0)
        // 文档 untouched：pending 保留
        expect(readDoc(paths, fingerprint).meta.pending_evidence_ids).toEqual([record.id])
      } finally {
        cleanup({ configDir, logRoot: otherDir, projectDir: otherDir })
      }
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })
})

describe("工具改进日志开关门（gate 复用确认）", () => {
  test("openToolInsightGate 按 configDir 配置解析日志根", () => {
    const { configDir, logRoot, projectDir } = fixture("gate-shape")
    try {
      const opened = openToolInsightGate({
        configDir,
        projectDirectory: projectDir,
        projectID: projectDir,
        warnOnce: () => {},
      })
      expect(opened?.paths.root).toBe(join(logRoot, toolInsightProjectSlug(projectDir)))
    } finally {
      cleanup({ configDir, logRoot, projectDir })
    }
  })
})
