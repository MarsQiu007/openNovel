import { describe, test, expect } from "bun:test"
import type { CleanupProposal } from "@opennovel-ai/schema/novel"
import {
  CLEANUP_STATUS_FILTERS,
  groupByChapter,
  isBatchSelectable,
  isLowRiskProposal,
  kindLabelKey,
  statusLabelKey,
  statusTagVariant,
} from "./cleanup-review-data"

function proposal(overrides: Partial<CleanupProposal> = {}): CleanupProposal {
  return {
    id: "p1",
    novelId: "novel-1",
    chapterId: "ch-1",
    kind: "typo_replace",
    paragraphIndex: 0,
    startOffset: 0,
    endOffset: 2,
    quote: "原文",
    replacement: "建议",
    reason: "理由",
    confidence: 0.98,
    status: "pending",
    failReason: null,
    appliedFromVersionId: null,
    appliedToVersionId: null,
    sourceRunId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe("isLowRiskProposal", () => {
  test("替换/清理类达阈值判定低风险", () => {
    expect(isLowRiskProposal("typo_replace", 0.95)).toBe(true)
    expect(isLowRiskProposal("format_clean", 0.9)).toBe(true)
    expect(isLowRiskProposal("typo_replace", 0.89)).toBe(false)
    expect(isLowRiskProposal("noise_remove", 0.99)).toBe(false)
    expect(isLowRiskProposal("duplicate_remove", 0.99)).toBe(false)
  })
})

describe("isBatchSelectable", () => {
  test("仅低风险 pending 可批量勾选", () => {
    expect(isBatchSelectable(proposal())).toBe(true)
    expect(isBatchSelectable(proposal({ confidence: 0.5 }))).toBe(false)
    expect(isBatchSelectable(proposal({ kind: "noise_remove" }))).toBe(false)
    expect(isBatchSelectable(proposal({ status: "applied" }))).toBe(false)
    expect(isBatchSelectable(proposal({ status: "failed" }))).toBe(false)
  })
})

describe("标签键与变体", () => {
  test("kind 与 status 的文案键齐全", () => {
    for (const kind of ["typo_replace", "noise_remove", "duplicate_remove", "format_clean", "unknown"]) {
      expect(kindLabelKey(kind)).toMatch(/^novel\.settings\.cleanup\.kind\./)
    }
    for (const status of ["pending", "applied", "rejected", "failed", "reverted", "unknown"]) {
      expect(statusLabelKey(status)).toMatch(/^novel\.settings\.cleanup\.status\./)
    }
  })

  test("状态过滤清单含全部六项", () => {
    expect(CLEANUP_STATUS_FILTERS).toEqual(["all", "pending", "applied", "rejected", "failed", "reverted"])
  })

  test("状态标签变体映射", () => {
    expect(statusTagVariant("pending")).toBe("neutral")
    expect(statusTagVariant("applied")).toBe("success")
    expect(statusTagVariant("rejected")).toBe("danger")
    expect(statusTagVariant("failed")).toBe("warning")
  })
})

describe("groupByChapter", () => {
  test("同章提案相邻且章内按锚点位置排序", () => {
    const items = [
      proposal({ id: "b", chapterId: "ch-2", paragraphIndex: 5 }),
      proposal({ id: "a2", chapterId: "ch-1", paragraphIndex: 3, startOffset: 0 }),
      proposal({ id: "a1", chapterId: "ch-1", paragraphIndex: 1, startOffset: 4 }),
    ]
    const groups = groupByChapter(items)
    expect(groups.map((g) => g.chapterId)).toEqual(["ch-2", "ch-1"])
    expect(groups[1]!.items.map((p) => p.id)).toEqual(["a1", "a2"])
  })
})
