import { describe, expect, test } from "bun:test"
import {
  countActions,
  hasAppliedChanges,
  isApplyReady,
  isPlanCurrent,
  prepareApplyRequest,
  type SettingOrganizationApplyResult,
  type SettingOrganizationDryRun,
} from "./setting-organization-state"

const dryRun: SettingOrganizationDryRun = {
  valid: true,
  planDigest: "digest",
  previews: [{ action: "update" }, { action: "merge" }, { action: "delete" }, { action: "delete" }],
  errors: [],
}

describe("setting organization state", () => {
  test("没有当前 dry run 时禁止 apply", () => {
    expect(isApplyReady({ planJson: "{}", submittedPlanJson: "{}", dryRun: null })).toBe(false)
  })

  test("dry run 通过且计划未变化时允许 apply", () => {
    expect(isApplyReady({ planJson: "{}", submittedPlanJson: "{}", dryRun })).toBe(true)
  })

  test("计划修改后失效既有 dry run 许可", () => {
    expect(isPlanCurrent({ planJson: "{}", submittedPlanJson: "" })).toBe(false)
    expect(isApplyReady({ planJson: "{}", submittedPlanJson: "", dryRun })).toBe(false)
  })

  test("取消确认不生成 apply 请求，确认后携带当前计划与摘要", () => {
    const state = { planJson: "{}", submittedPlanJson: "{}", dryRun }
    expect(prepareApplyRequest(state, false)).toBeNull()
    expect(prepareApplyRequest(state, true)).toEqual({ planJson: "{}", planDigest: "digest" })
  })

  test("统计操作类型并识别真实写入", () => {
    expect(countActions(dryRun.previews)).toEqual({ update: 1, merge: 1, delete: 2 })
    const failed: SettingOrganizationApplyResult = { ok: false, errors: ["失败"], results: [{ status: "failed" }] }
    const succeeded: SettingOrganizationApplyResult = { ok: true, errors: [], results: [{ status: "success" }] }
    expect(hasAppliedChanges(failed)).toBe(false)
    expect(hasAppliedChanges(succeeded)).toBe(true)
  })
})
