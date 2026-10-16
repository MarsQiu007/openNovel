/**
 * 同步错误分类器测试（upgrade-reliability）。
 */
import { describe, expect, test } from "bun:test"
import { classifySyncError, computeBackoffMs, MAX_ATTEMPTS } from "../src/sync-error-classifier"

describe("classifySyncError", () => {
  test("配额错误带恢复时间 → transient_quota + resumeAt", () => {
    const err = new Error("已达到 5 小时使用上限。您的额度将于 2026-10-16 20:51:41 可用")
    const result = classifySyncError(err)
    expect(result.kind).toBe("transient")
    expect(result.failureClass).toBe("transient_quota")
    expect(result.resumeAt).not.toBeNull()
    // 2026-10-16 20:51:41 本地时间
    const expected = new Date(2026, 9, 16, 20, 51, 41).getTime()
    expect(result.resumeAt).toBe(expected)
    expect(result.message).toContain("自动恢复")
    expect(result.action).toContain("重试")
  })

  test("配额错误仅带时间 → transient_quota + resumeAt（今日或明日）", () => {
    const err = new Error("您的额度将于 23:59 可用")
    const result = classifySyncError(err)
    expect(result.kind).toBe("transient")
    expect(result.failureClass).toBe("transient_quota")
    expect(result.resumeAt).not.toBeNull()
  })

  test("限流错误 → transient_rate", () => {
    const result = classifySyncError(new Error("Rate limit exceeded: 429 Too Many Requests"))
    expect(result.kind).toBe("transient")
    expect(result.failureClass).toBe("transient_rate")
    expect(result.resumeAt).toBeNull()
  })

  test("网络错误 → transient_network", () => {
    const result = classifySyncError(new Error("connect ETIMEDOUT 104.18.7.192:443"))
    expect(result.kind).toBe("transient")
    expect(result.failureClass).toBe("transient_network")
  })

  test("模型未配置 → terminal_model", () => {
    const result = classifySyncError(new Error("model not found: gpt-99"))
    expect(result.kind).toBe("terminal")
    expect(result.failureClass).toBe("terminal_model")
  })

  test("解析错误 → terminal_parse", () => {
    const result = classifySyncError(new Error("Failed to parse JSON response"))
    expect(result.kind).toBe("terminal")
    expect(result.failureClass).toBe("terminal_parse")
  })

  test("未知错误 → terminal_unknown", () => {
    const result = classifySyncError(new Error("something completely unexpected"))
    expect(result.kind).toBe("terminal")
    expect(result.failureClass).toBe("terminal_unknown")
  })

  test("非 Error 对象也可分类", () => {
    const result = classifySyncError("已达到 5 小时使用上限")
    expect(result.kind).toBe("transient")
    expect(result.failureClass).toBe("transient_quota")
  })
})

describe("computeBackoffMs", () => {
  test("第 0 次尝试约 1 分钟", () => {
    const ms = computeBackoffMs(0)
    expect(ms).toBeGreaterThanOrEqual(60_000 * 0.8)
    expect(ms).toBeLessThanOrEqual(60_000 * 1.2)
  })

  test("第 2 次尝试约 4 分钟", () => {
    const ms = computeBackoffMs(2)
    expect(ms).toBeGreaterThanOrEqual(240_000 * 0.8)
    expect(ms).toBeLessThanOrEqual(240_000 * 1.2)
  })

  test("第 10 次尝试不超过 30 分钟上限", () => {
    const ms = computeBackoffMs(10)
    expect(ms).toBeLessThanOrEqual(30 * 60_000 * 1.2)
  })

  test("MAX_ATTEMPTS 为 5", () => {
    expect(MAX_ATTEMPTS).toBe(5)
  })
})
