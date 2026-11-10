/**
 * 任务 5.1：确定性案例适配器测试。
 *
 * 覆盖：三类首批适配器端到端资格（准备→夹具落库→核验）、无适配器转人工、
 * 规范化摘要对案例/夹具/白名单/验收/模型/修复版本/正文凭据的失效敏感、
 * 仅本地保留正文不进入准备材料、准备阶段不触碰文件系统。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { ChapterTable, closeDb, getDb } from "../../src/novel-writer/session-store.js"
import {
  FIXTURE_UPDATED_TITLE,
  computeCaseDigest,
  findToolInsightCaseAdapter,
  prepareToolInsightCase,
} from "../../src/tool-insight/case-adapter.js"
import { createContentException, grantContentModelUse, modelVisibleContent } from "../../src/tool-insight/evidence.js"

const BASE_INPUT = {
  fingerprint: "fp_case_0001",
  tool: "update_chapter",
  scenario: "recovery_failed",
  model: { providerID: "test", modelID: "test-model" },
  fix_version: "0.1.24",
  grant_ids: ["cgr_base"] as readonly string[],
}

function removeDir(dir: string) {
  // Windows 下句柄/DB 释放有短暂延迟：清理失败不影响断言
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
}

/** 隔离 OPENNOVEL_DB 污染，在全新临时项目目录运行（走完回收 DB 与目录） */
async function withTempProject(name: string, run: (directory: string) => Promise<void>) {
  let envBackup: string | undefined
  const directory = mkdtempSync(join(tmpdir(), `tool-insight-case-${name}-`))
  try {
    envBackup = process.env.OPENNOVEL_DB
    delete process.env.OPENNOVEL_DB
    await run(directory)
  } finally {
    if (envBackup === undefined) delete process.env.OPENNOVEL_DB
    else process.env.OPENNOVEL_DB = envBackup
    closeDb(directory)
    removeDir(directory)
  }
}

const firstAdapters = ["list_chapters", "read_chapter_content", "update_chapter"] as const

afterAll(() => {
  closeDb()
})

describe("案例适配器注册与转人工", () => {
  test("三类首批适配器按工具与场景精确命中", () => {
    for (const tool of firstAdapters) {
      const adapter = findToolInsightCaseAdapter(tool, "recovery_failed")
      expect(adapter?.tool).toBe(tool)
      expect(adapter?.whitelist).toEqual([tool])
      expect(adapter?.fixture.novel_id).toBe("case-novel-0001")
      expect(adapter?.acceptance.length).toBeGreaterThan(0)
    }
  })

  test("无适配器的工具一律转人工：Shell、网络、发布、删除", () => {
    for (const tool of ["bash", "webfetch", "publish_chapter", "delete_chapter", "write_chapter"]) {
      expect(findToolInsightCaseAdapter(tool, "recovery_failed")).toBeUndefined()
      expect(prepareToolInsightCase({ ...BASE_INPUT, tool })).toEqual({ eligible: false, reason: "no-adapter" })
    }
  })

  test("同一工具场景不匹配同样转人工", () => {
    expect(findToolInsightCaseAdapter("update_chapter", "bad_params")).toBeUndefined()
    expect(prepareToolInsightCase({ ...BASE_INPUT, scenario: "bad_params" })).toEqual({ eligible: false, reason: "no-adapter" })
  })
})

describe("案例准备与规范化摘要", () => {
  test("三类首批适配器端到端资格：可准备、白名单精确、摘要稳定", () => {
    for (const tool of firstAdapters) {
      const prepared = prepareToolInsightCase({ ...BASE_INPUT, tool })
      expect(prepared.eligible).toBe(true)
      if (!prepared.eligible) continue
      expect(prepared.case_id).toBe(`case_${BASE_INPUT.fingerprint}`)
      expect(prepared.meta.whitelist).toEqual([tool])
      expect(prepared.meta.fix_version).toBe(BASE_INPUT.fix_version)
      expect(prepared.digest).toMatch(/^[0-9a-f]{64}$/)
      // 摘要只依赖适配器定义与输入，重复构造逐字节一致
      const again = prepareToolInsightCase({ ...BASE_INPUT, tool })
      expect(again.eligible && again.digest === prepared.digest).toBe(true)
    }
  })

  test("摘要覆盖案例、夹具、白名单、验收标准、模型、修复版本与正文凭据：任一变化即失效", () => {
    const base = computeCaseDigest({
      case_id: "case_x",
      tool: "update_chapter",
      scenario: "recovery_failed",
      whitelist: ["update_chapter"],
      fixture: { novel_id: "n1", novel_title: "样本", genre: "都市", synopsis: "", chapters: [{ id: "c1", title: "第1章", content: "正文" }] },
      acceptance: ["标题更新"],
      model: { providerID: "test", modelID: "m1" },
      fix_version: "0.1.24",
      grant_ids: [],
    })
    const mutate = (patch: Partial<Parameters<typeof computeCaseDigest>[0]>) =>
      computeCaseDigest({
        case_id: "case_x",
        tool: "update_chapter",
        scenario: "recovery_failed",
        whitelist: ["update_chapter"],
        fixture: { novel_id: "n1", novel_title: "样本", genre: "都市", synopsis: "", chapters: [{ id: "c1", title: "第1章", content: "正文" }] },
        acceptance: ["标题更新"],
        model: { providerID: "test", modelID: "m1" },
        fix_version: "0.1.24",
        grant_ids: [],
        ...patch,
      })
    expect(mutate({ case_id: "case_y" })).not.toBe(base)
    expect(mutate({ whitelist: ["update_chapter", "list_chapters"] })).not.toBe(base)
    expect(mutate({ fixture: { novel_id: "n1", novel_title: "样本", genre: "都市", synopsis: "", chapters: [{ id: "c1", title: "第1章", content: "正文改" }] } })).not.toBe(base)
    expect(mutate({ acceptance: ["标题更新、正文不变"] })).not.toBe(base)
    expect(mutate({ model: { providerID: "test", modelID: "m2" } })).not.toBe(base)
    expect(mutate({ fix_version: "0.1.25" })).not.toBe(base)
    expect(mutate({ grant_ids: ["cgr_1"] })).not.toBe(base)
    // 输入列表顺序不同即视为不同规范化形态
    expect(mutate({ grant_ids: ["cgr_1", "cgr_2"] })).not.toBe(mutate({ grant_ids: ["cgr_2", "cgr_1"] }))
  })

  test("仅本地保留的必要正文不进入准备材料；正文取用只走摘要绑定的授权", () => {
    const secret = "机密正文片段绝不能进入模型构造器"
    const exception = createContentException({ text: secret })

    const prepared = prepareToolInsightCase({ ...BASE_INPUT, grant_ids: [] })
    expect(prepared.eligible).toBe(true)
    if (!prepared.eligible) return
    const rendered = JSON.stringify({ prompt: prepared.prompt, sections: prepared.sections })
    expect(rendered).not.toContain(secret)

    // 正文可见的唯一入口：retest 授权且 subjectDigest 精确绑定本案例摘要
    const grant = grantContentModelUse(exception, { purpose: "retest", subjectDigest: prepared.digest, providerID: "test", modelID: "test-model" })
    expect(modelVisibleContent(exception, { purpose: "retest", subjectDigest: prepared.digest })).toBe(secret)
    expect(modelVisibleContent(exception, { purpose: "retest", subjectDigest: "other-case" })).toBeUndefined()
    expect(modelVisibleContent(exception, { purpose: "organize", subjectDigest: prepared.digest })).toBeUndefined()
    // 凭据 ID 参与摘要绑定：把该凭据计入后摘要变化，旧确认材料随之失效
    const rebound = prepareToolInsightCase({ ...BASE_INPUT, grant_ids: [grant.id] })
    expect(rebound.eligible && rebound.digest !== prepared.digest).toBe(true)
    expect(JSON.stringify({ prompt: rebound.prompt, sections: rebound.sections })).not.toContain(secret)
  })

  test("准备阶段不执行目标工具：可准备案例但项目目录尚无任何数据库", async () => {
    await withTempProject("prepare-no-io", async (directory) => {
      const prepared = prepareToolInsightCase(BASE_INPUT)
      expect(prepared.eligible).toBe(true)
      expect(existsSync(join(directory, "novel.db"))).toBe(false)
    })
  })
})

describe("夹具写入与真实结果核验", () => {
  test("list_chapters：夹具落库后核验通过，只读路径被改动判失败", async () => {
    await withTempProject("list-chapters", async (directory) => {
      const adapter = findToolInsightCaseAdapter("list_chapters", "recovery_failed")!
      await adapter.seed({ directory })
      await expect(adapter.verify({ directory })).resolves.toEqual({
        status: "verified_success",
        detail: expect.stringContaining("2 条章节"),
      })

      const db = getDb(directory)
      db.update(ChapterTable).set({ title: "被改标题" }).where(eq(ChapterTable.id, "case-ch-0001")).run()
      const result = await adapter.verify({ directory })
      expect(result.status).toBe("verified_failure")
    })
  })

  test("read_chapter_content：只读核验通过，正文被改动判失败", async () => {
    await withTempProject("read-content", async (directory) => {
      const adapter = findToolInsightCaseAdapter("read_chapter_content", "recovery_failed")!
      await adapter.seed({ directory })
      const ok = await adapter.verify({ directory })
      expect(ok.status).toBe("verified_success")

      const db = getDb(directory)
      db.update(ChapterTable).set({ content: "越权改写" }).where(eq(ChapterTable.id, "case-ch-0001")).run()
      const bad = await adapter.verify({ directory })
      expect(bad.status).toBe("verified_failure")
      expect(bad.detail).toContain("只读路径被改动")
    })
  })

  test("update_chapter：未更新判失败、按案例更新判通过、正文越权改动判失败", async () => {
    await withTempProject("update-chapter", async (directory) => {
      const adapter = findToolInsightCaseAdapter("update_chapter", "recovery_failed")!
      await adapter.seed({ directory })

      const untouched = await adapter.verify({ directory })
      expect(untouched.status).toBe("verified_failure")
      expect(untouched.detail).toContain("未更新")

      const db = getDb(directory)
      db.update(ChapterTable).set({ title: FIXTURE_UPDATED_TITLE }).where(eq(ChapterTable.id, "case-ch-0001")).run()
      const ok = await adapter.verify({ directory })
      expect(ok.status).toBe("verified_success")

      db.update(ChapterTable).set({ content: "顺带改了正文" }).where(eq(ChapterTable.id, "case-ch-0001")).run()
      const mutated = await adapter.verify({ directory })
      expect(mutated.status).toBe("verified_failure")
      expect(mutated.detail).toContain("越权改动")
    })
  })

  test("隔离建立失败（数据库不可用）按未验证处理", async () => {
    await withTempProject("verify-unverified", async (directory) => {
      const adapter = findToolInsightCaseAdapter("list_chapters", "recovery_failed")!
      // getDb 对缺失目录会惰性建库（查到空库判 verified_failure），所以用同名文件占用路径，
      // 让数据库真正打不开 → 核验按「未验证」处理
      const blocked = join(directory, "占用文件")
      writeFileSync(blocked, "不是目录")
      const result = await adapter.verify({ directory: blocked })
      expect(result.status).toBe("unverified")
      expect(result.detail).toContain("本地状态查询失败")
    })
  })
})
