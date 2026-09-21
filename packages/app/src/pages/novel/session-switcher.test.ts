import { describe, expect, test } from "bun:test"
import { sessionSwitcherTrigger } from "./workspace-data"

const baseInput = {
  paramsID: undefined,
  fallbackLabel: "对话",
  emptyLabel: "暂无会话",
  pendingLabel: "加载中",
  errorLabel: "会话列表加载失败",
}

describe("sessionSwitcherTrigger", () => {
  test("0 会话（确认空）：触发器禁用并显示空态占位，无重试标记", () => {
    const result = sessionSwitcherTrigger({ ...baseInput, status: "ready", sessions: [] })
    expect(result).toEqual({ label: "暂无会话", disabled: true, showRetry: false })
  })

  test("多会话且路由命中：显示当前会话标题", () => {
    const result = sessionSwitcherTrigger({
      ...baseInput,
      status: "ready",
      sessions: [
        { sessionID: "s1", title: "第一章草稿" },
        { sessionID: "s2", title: "设定讨论" },
      ],
      paramsID: "s2",
    })
    expect(result).toEqual({ label: "设定讨论", disabled: false, showRetry: false })
  })

  test("多会话但路由未命中（数据未就绪/新建中）：回退面板名且不禁用", () => {
    const result = sessionSwitcherTrigger({
      ...baseInput,
      status: "ready",
      sessions: [{ sessionID: "s1", title: "第一章草稿" }],
      paramsID: "s-other",
    })
    expect(result).toEqual({ label: "对话", disabled: false, showRetry: false })
  })

  test("多会话但 paramsID 缺失：回退面板名且不禁用", () => {
    const result = sessionSwitcherTrigger({
      ...baseInput,
      status: "ready",
      sessions: [{ sessionID: "s1", title: "第一章草稿" }],
    })
    expect(result).toEqual({ label: "对话", disabled: false, showRetry: false })
  })

  test("pending：显示加载占位，不显示暂无会话，无重试标记", () => {
    const result = sessionSwitcherTrigger({ ...baseInput, status: "pending", sessions: [] })
    expect(result).toEqual({ label: "加载中", disabled: true, showRetry: false })
  })

  test("error：显示失败占位并带重试标记，不显示暂无会话", () => {
    const result = sessionSwitcherTrigger({ ...baseInput, status: "error", sessions: [] })
    expect(result).toEqual({ label: "会话列表加载失败", disabled: true, showRetry: true })
  })

  test("error 且已有旧数据：仍显示失败占位（不冒充就绪态）", () => {
    const result = sessionSwitcherTrigger({
      ...baseInput,
      status: "error",
      sessions: [{ sessionID: "s1", title: "第一章草稿" }],
    })
    expect(result).toEqual({ label: "会话列表加载失败", disabled: true, showRetry: true })
  })
})
