import { describe, expect, test } from "bun:test"
import {
  resolveBannerState,
  resolveRetryChapterIds,
  resolveTaskCount,
  formatResumeTime,
  formatEta,
  isWorkerStale,
} from "./upgrade-banner"

describe("resolveBannerState 横幅状态机（run 驱动五态）", () => {
  test("无待执行任务且无活跃 run → 隐藏", () => {
    expect(resolveBannerState({ taskCount: 0, total: 0, synced: 0, failed: 0, running: 0, waitingRetry: 0 })).toBe("hidden")
  })

  test("有待执行任务但无活跃 run → 提示确认", () => {
    expect(resolveBannerState({ taskCount: 3, total: 0, synced: 0, failed: 0, running: 0, waitingRetry: 0 })).toBe("prompt")
  })

  test("有 running 章节 → running 态（优先于 waiting）", () => {
    expect(resolveBannerState({ taskCount: 0, total: 10, synced: 4, failed: 0, running: 1, waitingRetry: 2 })).toBe("running")
  })

  test("无 running 但有 waiting_retry → waiting 态", () => {
    expect(resolveBannerState({ taskCount: 0, total: 10, synced: 4, failed: 0, running: 0, waitingRetry: 2 })).toBe("waiting")
  })

  test("全部成功 → 隐藏（横幅消失）", () => {
    expect(resolveBannerState({ taskCount: 0, total: 10, synced: 10, failed: 0, running: 0, waitingRetry: 0 })).toBe("hidden")
  })

  test("全部处理但有失败 → 展示失败可续跑", () => {
    expect(resolveBannerState({ taskCount: 0, total: 10, synced: 8, failed: 2, running: 0, waitingRetry: 0 })).toBe("done-with-failures")
  })

  test("取消确认不产生任何变更：状态停留在提示", () => {
    expect(resolveBannerState({ taskCount: 2, total: 0, synced: 0, failed: 0, running: 0, waitingRetry: 0 })).toBe("prompt")
  })
})

describe("resolveTaskCount 待执行任务数派生", () => {
  test("状态整体为空按 0 处理", () => {
    expect(resolveTaskCount(undefined)).toBe(0)
  })

  test("负载缺 tasks 字段按 0 处理（异常响应不崩溃）", () => {
    expect(resolveTaskCount({})).toBe(0)
  })

  test("正常负载返回任务数", () => {
    expect(resolveTaskCount({ tasks: ["a", "b", "c"] })).toBe(3)
    expect(resolveTaskCount({ tasks: [] })).toBe(0)
  })
})

describe("resolveRetryChapterIds 失败章节重试 ID 派生（章节级）", () => {
  test("按失败项顺序返回章节 ID", () => {
    expect(
      resolveRetryChapterIds([
        { chapterId: "chapter-1" },
        { chapterId: "chapter-2" },
      ]),
    ).toEqual(["chapter-1", "chapter-2"])
  })

  test("无失败项时返回空数组", () => {
    expect(resolveRetryChapterIds([])).toEqual([])
  })

  test("章节 ID 为空时过滤掉", () => {
    expect(resolveRetryChapterIds([{ chapterId: "" }, { chapterId: "ch-1" }])).toEqual(["ch-1"])
  })
})

describe("formatResumeTime 恢复时间格式化", () => {
  test("格式化为 HH:mm", () => {
    const d = new Date(2026, 9, 16, 20, 51)
    expect(formatResumeTime(d.getTime())).toBe("20:51")
  })

  test("补零", () => {
    const d = new Date(2026, 9, 16, 8, 5)
    expect(formatResumeTime(d.getTime())).toBe("08:05")
  })
})

describe("formatEta 预计剩余时间格式化", () => {
  test("格式化为「约 N 分钟」", () => {
    expect(formatEta(5 * 60_000)).toBe("约 5 分钟")
    expect(formatEta(90_000)).toBe("约 2 分钟")
  })

  test("最小 1 分钟", () => {
    expect(formatEta(500)).toBe("约 1 分钟")
  })
})

describe("isWorkerStale worker 活性判定", () => {
  test("lastPollAt 为 undefined 时不视为 stale（旧服务端）", () => {
    expect(isWorkerStale(undefined, Date.now())).toBe(false)
  })

  test("10 秒内不视为 stale", () => {
    const now = Date.now()
    expect(isWorkerStale(now - 9_000, now)).toBe(false)
  })

  test("超过 10 秒视为 stale", () => {
    const now = Date.now()
    expect(isWorkerStale(now - 11_000, now)).toBe(true)
  })
})
