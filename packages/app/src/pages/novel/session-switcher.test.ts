import { describe, expect, test } from "bun:test"
import { sessionSwitcherTrigger } from "./workspace-data"

describe("sessionSwitcherTrigger", () => {
  test("0 会话：触发器禁用并显示空态占位", () => {
    const result = sessionSwitcherTrigger({
      sessions: [],
      paramsID: undefined,
      fallbackLabel: "对话",
      emptyLabel: "暂无会话",
    })
    expect(result).toEqual({ label: "暂无会话", disabled: true })
  })

  test("多会话且路由命中：显示当前会话标题", () => {
    const result = sessionSwitcherTrigger({
      sessions: [
        { sessionID: "s1", title: "第一章草稿" },
        { sessionID: "s2", title: "设定讨论" },
      ],
      paramsID: "s2",
      fallbackLabel: "对话",
      emptyLabel: "暂无会话",
    })
    expect(result).toEqual({ label: "设定讨论", disabled: false })
  })

  test("多会话但路由未命中（数据未就绪/新建中）：回退面板名且不禁用", () => {
    const result = sessionSwitcherTrigger({
      sessions: [{ sessionID: "s1", title: "第一章草稿" }],
      paramsID: "s-other",
      fallbackLabel: "对话",
      emptyLabel: "暂无会话",
    })
    expect(result).toEqual({ label: "对话", disabled: false })
  })

  test("多会话但 paramsID 缺失：回退面板名且不禁用", () => {
    const result = sessionSwitcherTrigger({
      sessions: [{ sessionID: "s1", title: "第一章草稿" }],
      paramsID: undefined,
      fallbackLabel: "对话",
      emptyLabel: "暂无会话",
    })
    expect(result).toEqual({ label: "对话", disabled: false })
  })
})
