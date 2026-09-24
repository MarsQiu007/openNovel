import { describe, test, expect } from "bun:test"
import { ManualEditDirectory, getManualEditEntry, isCreativeFactEdit, requiresAiSync } from "../src/manual-edit-directory"

/** 所有修改小说正式数据的写入端点（POST / PUT / PATCH / DELETE） */
const formalWriteEndpoints = [
  "novel.create",
  "novel.update",
  "novel.delete",
  "novel.update-content",
  "novel.update-outline",
  "novel.create-volume",
  "novel.update-volume",
  "novel.delete-volume",
  "novel.create-chapter",
  "novel.update-chapter",
  "novel.delete-chapter",
  "novel.rollback",
  "novel.restore-version",
  "novel.move-chapter",
  "novel.create-character",
  "novel.update-character",
  "novel.delete-character",
  "novel.create-character-state",
  "novel.update-character-state",
  "novel.delete-character-state",
  "novel.create-relationship",
  "novel.update-relationship",
  "novel.delete-relationship",
  "novel.create-plot-thread",
  "novel.update-plot-thread",
  "novel.delete-plot-thread",
  "novel.create-foreshadowing",
  "novel.update-foreshadowing",
  "novel.create-world-entry",
  "novel.update-world-entry",
  "novel.delete-world-entry",
  "novel.update-style-guide",
  "novel.update-soul",
  "novel.create-tension",
  "novel.update-tension",
  "novel.delete-tension",
  "novel.create-arc",
  "novel.update-arc",
  "novel.delete-arc",
  "novel.create-beat",
  "novel.update-beat",
  "novel.delete-beat",
  "novel.upsert-canvas-layout",
]

describe("ManualEditDirectory", () => {
  test("覆盖所有正式数据写入端点", () => {
    const missing = formalWriteEndpoints.filter((endpoint) => !ManualEditDirectory.has(endpoint))
    expect(missing).toEqual([])
  })

  test("每个条目声明实体、字段、类别、感知策略和同步策略", () => {
    for (const [endpoint, entry] of ManualEditDirectory) {
      expect(endpoint.length).toBeGreaterThan(0)
      expect(entry.entity.length).toBeGreaterThan(0)
      expect(entry.fields.length).toBeGreaterThan(0)
      expect(["creative_fact", "workflow_fact", "ui_preference"]).toContain(entry.category)
      expect(["context", "gate", "flow_only", "none"]).toContain(entry.aiPerception)
      expect(["queued", "immediate", "none"]).toContain(entry.sync)
    }
  })

  test("创作事实端点标记为需要 AI 感知", () => {
    expect(isCreativeFactEdit("novel.update-content")).toBe(true)
    expect(isCreativeFactEdit("novel.update-character")).toBe(true)
    expect(isCreativeFactEdit("novel.update-world-entry")).toBe(true)
    expect(isCreativeFactEdit("novel.update-style-guide")).toBe(true)
    // 工作流和 UI 偏好不是创作事实
    expect(isCreativeFactEdit("novel.approval")).toBe(false)
    expect(isCreativeFactEdit("novel.upsert-canvas-layout")).toBe(false)
  })

  test("创作事实 + queued 策略的端点需要同步", () => {
    expect(requiresAiSync("novel.update-content")).toBe(true)
    expect(requiresAiSync("novel.update-character")).toBe(true)
    // workflow_fact 即使 sync 为 none 也不需要
    expect(requiresAiSync("novel.approval")).toBe(false)
  })

  test("UI 偏好不进入 AI 感知", () => {
    const entry = getManualEditEntry("novel.upsert-canvas-layout")
    expect(entry?.category).toBe("ui_preference")
    expect(entry?.aiPerception).toBe("none")
    expect(entry?.sync).toBe("none")
  })

  test("章节正文端点使用排队同步策略", () => {
    const entry = getManualEditEntry("novel.update-content")
    expect(entry?.entity).toBe("chapter")
    expect(entry?.category).toBe("creative_fact")
    expect(entry?.aiPerception).toBe("context")
    expect(entry?.sync).toBe("queued")
  })

  test("世界观端点标记为需要上下文感知", () => {
    const entry = getManualEditEntry("novel.update-world-entry")
    expect(entry?.entity).toBe("world_entry")
    expect(entry?.category).toBe("creative_fact")
    expect(entry?.aiPerception).toBe("context")
    expect(entry?.sync).toBe("queued")
  })
})
