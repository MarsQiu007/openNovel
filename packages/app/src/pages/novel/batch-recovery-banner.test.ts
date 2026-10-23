/**
 * 批量写作中断横幅状态机单测（agent-background-job-recovery D6）：
 * 仅 running 且 interrupted（发起会话不活跃）时可见；其余态一律隐藏。
 */
import { describe, expect, test } from "bun:test"
import { resolveBatchBannerState } from "./batch-recovery-banner"

describe("resolveBatchBannerState", () => {
  test("无批量记录时隐藏", () => {
    expect(resolveBatchBannerState(undefined)).toBe("hidden")
    expect(resolveBatchBannerState(null)).toBe("hidden")
  })

  test("running 且 interrupted 时展示", () => {
    expect(resolveBatchBannerState({ status: "running", interrupted: true })).toBe("interrupted")
  })

  test("running 但会话活跃（非 interrupted）时隐藏", () => {
    expect(resolveBatchBannerState({ status: "running", interrupted: false })).toBe("hidden")
  })

  test("终态（completed/cancelled）隐藏", () => {
    expect(resolveBatchBannerState({ status: "completed", interrupted: false })).toBe("hidden")
    expect(resolveBatchBannerState({ status: "cancelled", interrupted: false })).toBe("hidden")
  })
})
