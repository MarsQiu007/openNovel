import { describe, expect, test } from "bun:test"
import { resolveBannerState, resolveRetryEntryIds, resolveTaskCount } from "./upgrade-banner"

describe("resolveBannerState 横幅状态机", () => {
  test("无待执行任务且无队列任务 → 隐藏", () => {
    expect(resolveBannerState({ taskCount: 0, total: 0, synced: 0, failed: 0 })).toBe("hidden")
  })

  test("有待执行任务但未触发 → 提示确认", () => {
    expect(resolveBannerState({ taskCount: 3, total: 0, synced: 0, failed: 0 })).toBe("prompt")
  })

  test("升级执行中（未完成全部）→ 进行中", () => {
    expect(resolveBannerState({ taskCount: 0, total: 10, synced: 4, failed: 0 })).toBe("running")
    expect(resolveBannerState({ taskCount: 1, total: 10, synced: 6, failed: 1 })).toBe("running")
  })

  test("全部成功 → 隐藏（横幅消失）", () => {
    expect(resolveBannerState({ taskCount: 0, total: 10, synced: 10, failed: 0 })).toBe("hidden")
  })

  test("全部处理但有失败 → 展示失败可续跑", () => {
    expect(resolveBannerState({ taskCount: 0, total: 10, synced: 8, failed: 2 })).toBe("done-with-failures")
  })

  test("取消确认不产生任何变更：状态停留在提示", () => {
    // 取消即不触发 start 变更；任务仍在，状态保持 prompt
    expect(resolveBannerState({ taskCount: 2, total: 0, synced: 0, failed: 0 })).toBe("prompt")
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

describe("resolveRetryEntryIds 失败章节重试 ID 派生", () => {
  test("按失败项顺序返回队列条目 ID", () => {
    expect(
      resolveRetryEntryIds([
        { entryId: "entry-1", chapterId: "chapter-1", reason: "模型超时" },
        { entryId: "entry-2", chapterId: "chapter-2", reason: "输出解析失败" },
      ]),
    ).toEqual(["entry-1", "entry-2"])
  })

  test("无失败项时返回空数组", () => {
    expect(resolveRetryEntryIds([])).toEqual([])
  })
})
