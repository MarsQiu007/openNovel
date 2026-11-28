/**
 * 章节清理修订提案数据层测试（chapter-cleanup-review · tasks 1.5）
 *
 * 覆盖：
 * - 落库校验：kind/replacement/锚点/置信度非法整批拒绝，不落任何条目
 * - 应用成功路径：快照版本、正文机械替换、字数、提案状态与前后版本关联
 * - 删除类应用：整段移除
 * - 锚点漂移：quote 不匹配标 failed，同批其余项不受阻断
 * - 倒序应用：同章多条提案按位置倒序执行，无偏移错位
 * - 批量原子回滚：应用过程中抛错整体回滚，无半应用状态
 * - 撤销：恢复应用前快照、追加 revert 版本行、提案转 reverted
 * - 拒绝留痕与计数
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { desc, eq } from "drizzle-orm"
import {
  closeDb,
  createChapter,
  getDb,
  ChapterTable,
  ChapterVersionTable,
  NovelTable,
  PendingSettingTable,
  withTransaction,
  aggregatePendingSummary,
  applyCleanupProposals,
  applyCleanupProposalsTx,
  countCleanupProposals,
  createCleanupProposals,
  createCleanupProposalsTx,
  isLowRiskCleanup,
  listCleanupProposals,
  rejectCleanupProposal,
  revertCleanupProposal,
  validateCleanupProposalInputs,
  LOW_RISK_CONFIDENCE_THRESHOLD,
} from "../src/index.js"

let projectDir: string
let chapterId: string

beforeEach(async () => {
  projectDir = join(tmpdir(), `cleanup-proposals-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  db.insert(NovelTable)
    .values({ id: "novel-1", title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  chapterId = (await createChapter("novel-1", "第一章", 1, null, projectDir)).id
  db.update(ChapterTable)
    .set({ content: "他说道：“今天天气不错。”\n这是一段完全正常的内容。\n他昨天的昨候就到了。", word_count: 40 })
    .where(eq(ChapterTable.id, chapterId))
    .run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

const PARAGRAPH_1 = "他说道：“今天天气不错。”"
const PARAGRAPH_2 = "这是一段完全正常的内容。"
const PARAGRAPH_3 = "他昨天的昨候就到了。"

function typoProposal() {
  return {
    kind: "typo_replace" as const,
    paragraph_index: 2,
    start_offset: 4,
    end_offset: 6,
    quote: "昨候",
    replacement: "时候",
    reason: "错别字",
    confidence: 0.98,
  }
}

function content() {
  return getDb(projectDir).select({ content: ChapterTable.content }).from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!
    .content
}

function versions() {
  return getDb(projectDir)
    .select()
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, chapterId))
    .orderBy(desc(ChapterVersionTable.version))
    .all()
}

describe("章节清理修订提案", () => {
  describe("落库校验", () => {
    test("合法提案落库为 pending 并返回 id", () => {
      const ids = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      expect(ids).toHaveLength(1)
      const rows = listCleanupProposals("novel-1", { status: "pending" }, projectDir)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.kind).toBe("typo_replace")
      expect(rows[0]!.quote).toBe("昨候")
      expect(rows[0]!.replacement).toBe("时候")
    })

    test("kind 非法整批拒绝", () => {
      expect(() =>
        createCleanupProposals(
          { novelId: "novel-1", chapterId, proposals: [typoProposal(), { ...typoProposal(), kind: "rewrite_all" }] },
          projectDir,
        ),
      ).toThrow(/修订提案校验失败/)
      expect(listCleanupProposals("novel-1", {}, projectDir)).toHaveLength(0)
    })

    test("删除类带 replacement 与替换类空 replacement 均拒绝", () => {
      const issues = validateCleanupProposalInputs([
        { kind: "noise_remove", paragraph_index: 0, start_offset: 0, end_offset: 5, quote: "广告行", replacement: "改成别的" },
        { kind: "typo_replace", paragraph_index: 0, start_offset: 0, end_offset: 5, quote: "原文" },
      ])
      expect(issues.map((i) => i.field)).toEqual(["replacement", "replacement"])
    })

    test("置信度越界与锚点区间非法拒绝", () => {
      const issues = validateCleanupProposalInputs([
        { kind: "typo_replace", paragraph_index: 0, start_offset: 0, end_offset: 3, quote: "原文", replacement: "改", confidence: 1.5 },
        { kind: "typo_replace", paragraph_index: -1, start_offset: 2, end_offset: 1, quote: "原文", replacement: "改" },
      ])
      expect(issues.map((i) => i.field)).toEqual(["confidence", "paragraph_index", "offsets"])
    })
  })

  describe("低风险判定", () => {
    test("替换/清理类达阈值判定低风险，删除类永不低风险", () => {
      expect(isLowRiskCleanup("typo_replace", 0.95)).toBe(true)
      expect(isLowRiskCleanup("format_clean", LOW_RISK_CONFIDENCE_THRESHOLD)).toBe(true)
      expect(isLowRiskCleanup("typo_replace", 0.5)).toBe(false)
      expect(isLowRiskCleanup("noise_remove", 0.99)).toBe(false)
      expect(isLowRiskCleanup("duplicate_remove", 0.99)).toBe(false)
    })
  })

  describe("事务化应用", () => {
    test("替换类应用：正文机械变更、快照与应用后版本齐备、提案关联版本", () => {
      const [id] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      const result = applyCleanupProposals([id!], projectDir)
      expect(result.applied).toEqual([id])
      expect(result.failed).toHaveLength(0)
      expect(content()).toBe(`${PARAGRAPH_1}\n${PARAGRAPH_2}\n他昨天的时候就到了。`)
      const vs = versions()
      expect(vs[0]!.created_by).toBe("cleanup-apply")
      expect(vs[1]!.created_by).toBe("cleanup-apply")
      expect(vs[1]!.content).toBe("他说道：“今天天气不错。”\n这是一段完全正常的内容。\n他昨天的昨候就到了。")
      const row = listCleanupProposals("novel-1", {}, projectDir)[0]!
      expect(row.status).toBe("applied")
      expect(row.applied_from_version_id).toBe(vs[1]!.id)
      expect(row.applied_to_version_id).toBe(vs[0]!.id)
    })

    test("删除类应用：整段移除且段落序号回拢", () => {
      const [id] = createCleanupProposals(
        {
          novelId: "novel-1",
          chapterId,
          proposals: [
            { kind: "noise_remove", paragraph_index: 1, start_offset: 0, end_offset: PARAGRAPH_2.length, quote: PARAGRAPH_2, reason: "广告残留" },
          ],
        },
        projectDir,
      )
      applyCleanupProposals([id!], projectDir)
      expect(content()).toBe(`${PARAGRAPH_1}\n${PARAGRAPH_3}`)
    })

    test("倒序应用：同章两条提案不错位", () => {
      const [idA, idB] = createCleanupProposals(
        {
          novelId: "novel-1",
          chapterId,
          proposals: [
            typoProposal(),
            { kind: "typo_replace", paragraph_index: 0, start_offset: 5, end_offset: 7, quote: "今天", replacement: "明日", reason: "用词", confidence: 0.95 },
          ],
        },
        projectDir,
      )
      const result = applyCleanupProposals([idA!, idB!], projectDir)
      expect(result.applied).toHaveLength(2)
      expect(result.failed).toHaveLength(0)
      expect(content()).toBe(`他说道：“明日天气不错。”\n${PARAGRAPH_2}\n他昨天的时候就到了。`)
    })

    test("锚点漂移标 failed 不阻断同批其余项", () => {
      const [idA] = createCleanupProposals(
        {
          novelId: "novel-1",
          chapterId,
          proposals: [{ ...typoProposal(), quote: "完全不同的文本" }],
        },
        projectDir,
      )
      const [idB] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      const result = applyCleanupProposals([idA!, idB!], projectDir)
      expect(result.failed.map((f) => f.id)).toEqual([idA])
      expect(result.applied).toEqual([idB])
      const failedRow = listCleanupProposals("novel-1", { status: "failed" }, projectDir)[0]!
      expect(failedRow.fail_reason).toContain("锚点漂移")
    })

    test("应用异常整体回滚，无半应用状态", () => {
      const [id] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      const before = content()
      expect(() =>
        withTransaction(getDb(projectDir), (tx) => {
          applyCleanupProposalsTx(tx, [id!])
          throw new Error("模拟应用中途异常")
        }),
      ).toThrow("模拟应用中途异常")
      expect(content()).toBe(before)
      expect(listCleanupProposals("novel-1", { status: "pending" }, projectDir)).toHaveLength(1)
      expect(versions()).toHaveLength(0)
    })
  })

  describe("撤销与拒绝", () => {
    test("撤销恢复应用前快照并转 reverted", () => {
      const [id] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      applyCleanupProposals([id!], projectDir)
      revertCleanupProposal(id!, projectDir)
      expect(content()).toBe(`${PARAGRAPH_1}\n${PARAGRAPH_2}\n${PARAGRAPH_3}`)
      const vs = versions()
      expect(vs[0]!.created_by).toBe("cleanup-revert")
      expect(vs[0]!.content).toBe(`${PARAGRAPH_1}\n${PARAGRAPH_2}\n${PARAGRAPH_3}`)
      expect(listCleanupProposals("novel-1", {}, projectDir)[0]!.status).toBe("reverted")
    })

    test("拒绝留痕可查", () => {
      const [id] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      rejectCleanupProposal(id!, projectDir)
      expect(listCleanupProposals("novel-1", {}, projectDir)[0]!.status).toBe("rejected")
      expect(() => rejectCleanupProposal(id!, projectDir)).toThrow(/不是待审状态/)
    })

    test("计数按状态聚合", () => {
      const [idA] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      const [idB] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      applyCleanupProposals([idA!], projectDir)
      rejectCleanupProposal(idB!, projectDir)
      const [idC] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      const counts = countCleanupProposals("novel-1", projectDir)
      expect(counts["applied"]).toBe(1)
      expect(counts["rejected"]).toBe(1)
      expect(counts["pending"]).toBe(1)
      expect(idC).toBeTruthy()
    })
  })

  describe("书级待审聚合", () => {
    test("两源 pending 按书合并，无书返回空", () => {
      expect(aggregatePendingSummary(projectDir)).toEqual([])
      const db = getDb(projectDir)
      db.insert(PendingSettingTable)
        .values({
          id: "ps-1",
          novel_id: "novel-1",
          candidate_type: "world_entry",
          payload_json: "{}",
          importance: 2,
        })
        .run()
      createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      const summary = aggregatePendingSummary(projectDir)
      expect(summary).toHaveLength(1)
      expect(summary[0]).toEqual({ novelId: "novel-1", inboxPending: 1, cleanupPending: 1, total: 2 })
      // 已应用/已拒绝不进入 pending 聚合
      const [id] = createCleanupProposals({ novelId: "novel-1", chapterId, proposals: [typoProposal()] }, projectDir)
      applyCleanupProposals([id!], projectDir)
      const after = aggregatePendingSummary(projectDir)[0]!
      expect(after.cleanupPending).toBe(1)
      expect(after.total).toBe(2)
    })
  })
})
