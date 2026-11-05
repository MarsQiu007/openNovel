import { describe, expect, test } from "bun:test"
import { resumedUpdateReady, updaterAction } from "./updater-action"

describe("updaterAction", () => {
  test("disables update actions when the platform has no updater", () => {
    expect(updaterAction(undefined)).toEqual({ label: "settings.updates.action.checkNow" })
  })

  test("projects updater transitions into one settings action", () => {
    expect(updaterAction({ status: "idle" })).toEqual({
      label: "settings.updates.action.checkNow",
      run: "check",
    })
    expect(updaterAction({ status: "checking" })).toEqual({ label: "settings.updates.action.checking" })
    expect(updaterAction({ status: "downloading", version: "2.0.0" })).toEqual({
      label: "settings.updates.action.downloading",
    })
    expect(updaterAction({ status: "ready", version: "2.0.0" })).toEqual({
      label: "toast.update.action.installRestart",
      run: "install",
    })
    expect(updaterAction({ status: "installing", version: "2.0.0" })).toEqual({
      label: "settings.updates.action.installing",
    })
  })
})

describe("resumedUpdateReady", () => {
  test("本次启动恢复了未决更新且状态回到 ready 时返回版本号", () => {
    expect(resumedUpdateReady(true, { status: "ready", version: "2.0.0" })).toBe("2.0.0")
  })

  test("未决更新尚未回到 ready 时不提示", () => {
    expect(resumedUpdateReady(true, { status: "checking" })).toBeUndefined()
    expect(resumedUpdateReady(true, { status: "downloading", version: "2.0.0" })).toBeUndefined()
    expect(resumedUpdateReady(true, undefined)).toBeUndefined()
  })

  test("定时检查下载完成（非启动恢复）不弹全局提示", () => {
    expect(resumedUpdateReady(false, { status: "ready", version: "2.0.0" })).toBeUndefined()
    expect(resumedUpdateReady(false, undefined)).toBeUndefined()
  })
})
