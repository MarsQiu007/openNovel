import { describe, expect, test } from "bun:test"
import { activeSubagentEntries } from "./active-subagent-bar"

const children = [
  { id: "architect", title: "架构师" },
  { id: "outliner", title: "大纲师" },
  { id: "pipeline", title: "流水线" },
]

describe("activeSubagentEntries（活跃子代理横条条目）", () => {
  test("有运行：只保留运行中子代理并带标题，保持顺序", () => {
    const entries = activeSubagentEntries({
      children,
      working: (id) => id === "architect" || id === "pipeline",
    })
    expect(entries).toEqual([
      { id: "architect", title: "架构师" },
      { id: "pipeline", title: "流水线" },
    ])
  })

  test("无运行：条目为空（横条不渲染）", () => {
    expect(activeSubagentEntries({ children, working: () => false })).toEqual([])
  })

  test("点击导航：条目携带子会话 ID 供 onSelect 使用", () => {
    const selected: string[] = []
    for (const entry of activeSubagentEntries({ children, working: () => true })) selected.push(entry.id)
    expect(selected).toEqual(["architect", "outliner", "pipeline"])
  })
})

describe("activeSubagentEntries（随运行状态实时增删）", () => {
  // 运行状态无推送（busy/idle 由 active 对账刷新），以状态集合翻转驱动断言横条增删
  const working = (busy: Set<string>) => (id: string) => busy.has(id)

  test("子代理开始运行：条目即出现", () => {
    const busy = new Set<string>()
    expect(activeSubagentEntries({ children, working: working(busy) })).toEqual([])
    busy.add("outliner")
    expect(activeSubagentEntries({ children, working: working(busy) })).toEqual([{ id: "outliner", title: "大纲师" }])
  })

  test("子代理结束：条目即移除", () => {
    const busy = new Set(["architect", "outliner"])
    expect(activeSubagentEntries({ children, working: working(busy) })).toHaveLength(2)
    busy.delete("architect")
    expect(activeSubagentEntries({ children, working: working(busy) })).toEqual([{ id: "outliner", title: "大纲师" }])
  })

  test("最后一个条目移除：横条清空", () => {
    const busy = new Set(["pipeline"])
    expect(activeSubagentEntries({ children, working: working(busy) })).toHaveLength(1)
    busy.delete("pipeline")
    expect(activeSubagentEntries({ children, working: working(busy) })).toEqual([])
  })
})
