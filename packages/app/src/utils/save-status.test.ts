import { describe, test, expect } from "bun:test"
import {
  EDIT_SAVE_STATUS_LABELS,
  EDIT_SAVE_STATUS_STYLES,
  createSaveStatusStore,
} from "./save-status"

describe("EDIT_SAVE_STATUS_LABELS", () => {
  test("覆盖全部状态且使用简体中文", () => {
    const statuses = ["idle", "saving", "saved", "save_failed", "sync_pending", "sync_failed", "skipped"]
    for (const status of statuses) {
      expect(EDIT_SAVE_STATUS_LABELS[status as keyof typeof EDIT_SAVE_STATUS_LABELS]).toBeDefined()
    }
    // 中文文案
    expect(EDIT_SAVE_STATUS_LABELS.saving).toContain("保存")
    expect(EDIT_SAVE_STATUS_LABELS.saved).toBe("已保存")
    expect(EDIT_SAVE_STATUS_LABELS.save_failed).toBe("保存失败")
    expect(EDIT_SAVE_STATUS_LABELS.sync_pending).toBe("待同步")
    expect(EDIT_SAVE_STATUS_LABELS.sync_failed).toBe("同步失败")
    expect(EDIT_SAVE_STATUS_LABELS.skipped).toBe("已跳过")
  })

  test("idle 状态无标签", () => {
    expect(EDIT_SAVE_STATUS_LABELS.idle).toBe("")
  })
})

describe("EDIT_SAVE_STATUS_STYLES", () => {
  test("失败状态使用红色，成功使用绿色", () => {
    expect(EDIT_SAVE_STATUS_STYLES.save_failed).toContain("red")
    expect(EDIT_SAVE_STATUS_STYLES.sync_failed).toContain("red")
    expect(EDIT_SAVE_STATUS_STYLES.saved).toContain("green")
    expect(EDIT_SAVE_STATUS_STYLES.sync_pending).toContain("amber")
  })
})

describe("createSaveStatusStore", () => {
  test("初始状态为 idle", () => {
    const store = createSaveStatusStore()
    expect(store.status).toBe("idle")
    expect(store.failureMessage).toBeNull()
  })

  test("set 更新状态和失败消息", () => {
    const store = createSaveStatusStore()
    store.set("save_failed", "网络超时")
    expect(store.status).toBe("save_failed")
    expect(store.failureMessage).toBe("网络超时")

    store.set("saved")
    expect(store.status).toBe("saved")
    expect(store.failureMessage).toBeNull()
  })

  test("subscribe 监听状态变化", () => {
    const store = createSaveStatusStore()
    let notifyCount = 0
    const unsubscribe = store.subscribe(() => {
      notifyCount++
    })

    store.set("saving")
    expect(notifyCount).toBe(1)

    store.set("saved")
    expect(notifyCount).toBe(2)

    unsubscribe()
    store.set("idle")
    expect(notifyCount).toBe(2)
  })
})
