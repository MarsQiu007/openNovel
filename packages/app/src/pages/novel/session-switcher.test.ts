import { describe, expect, test } from "bun:test"
import { flattenNovelSessionOptions, type NovelSessionOption } from "@/context/novel-queries"
import {
  sessionSwitcherTrigger,
  switcherChildrenVisible,
  switcherNodeContainsActive,
  switcherWorkingDot,
} from "./workspace-data"

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

  test("深层嵌套子会话：拍平后触发器标签命中孙级标题", () => {
    const tree: NovelSessionOption[] = [
      {
        sessionID: "s1",
        title: "第一章草稿",
        updatedAt: 1,
        children: [
          {
            sessionID: "sub1",
            title: "子代理 A",
            updatedAt: 2,
            children: [{ sessionID: "sub2", title: "孙代理 B", updatedAt: 3, children: [] }],
          },
        ],
      },
    ]
    const result = sessionSwitcherTrigger({
      ...baseInput,
      status: "ready",
      sessions: flattenNovelSessionOptions(tree),
      paramsID: "sub2",
    })
    expect(result).toEqual({ label: "孙代理 B", disabled: false, showRetry: false })
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

describe("switcherChildrenVisible（子代理默认展开语义）", () => {
  test("默认展开：无手动收起记录即可见", () => {
    expect(switcherChildrenVisible({ collapsed: false, containsActive: false })).toBe(true)
  })

  test("手动收起后保持收起", () => {
    expect(switcherChildrenVisible({ collapsed: true, containsActive: false })).toBe(false)
  })

  test("祖先链含当前会话：手动收起不遮挡活动位置", () => {
    expect(switcherChildrenVisible({ collapsed: true, containsActive: true })).toBe(true)
  })
})

describe("switcherNodeContainsActive（活动祖先链判定）", () => {
  const tree = {
    sessionID: "main",
    children: [
      { sessionID: "child", children: [{ sessionID: "grand", children: [] }] },
      { sessionID: "sibling", children: [] },
    ],
  }

  test("当前会话在深层后代中命中", () => {
    expect(switcherNodeContainsActive(tree, "grand")).toBe(true)
    expect(switcherNodeContainsActive(tree, "child")).toBe(true)
  })

  test("当前会话不在该子树时为否", () => {
    expect(switcherNodeContainsActive(tree, "other")).toBe(false)
    expect(switcherNodeContainsActive(tree, undefined)).toBe(false)
  })
})

describe("switcherWorkingDot（子代理运行指示三态）", () => {
  test("运行中（busy）：子代理层级显示，主会话层级不显示", () => {
    expect(switcherWorkingDot({ depth: 1, working: true })).toBe(true)
    expect(switcherWorkingDot({ depth: 0, working: true })).toBe(false)
  })

  test("空闲（idle）：不显示", () => {
    expect(switcherWorkingDot({ depth: 1, working: false })).toBe(false)
  })

  test("结束（回到 idle）：指示消失", () => {
    expect(switcherWorkingDot({ depth: 1, working: true })).toBe(true)
    expect(switcherWorkingDot({ depth: 1, working: false })).toBe(false)
  })
})
