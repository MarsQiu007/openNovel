import { describe, expect, test } from "bun:test"
import type { Session } from "@opennovel-ai/sdk/v2/client"
import { boundNovelSessions, type NovelSessionBinding } from "./novel-queries"

function session(id: string, title?: string, archived?: boolean, parentID?: string): Session {
  return {
    id,
    parentID,
    title: title ?? `会话 ${id}`,
    time: { created: 1, updated: 1, archived: archived ? 1 : undefined },
  } as unknown as Session
}

function binding(sessionID: string, novelID = "novel-1"): NovelSessionBinding {
  return { sessionID, novelID, novelTitle: "测试书籍" }
}

describe("boundNovelSessions", () => {
  test("交集只含该书绑定的会话，未绑定会话不出现", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1"), binding("s2"), binding("s3", "novel-2")],
      sessions: [session("s1"), session("s2"), session("s3"), session("s4")],
    })
    expect(result.map((item) => item.sessionID)).toEqual(["s1", "s2"])
  })

  test("已归档会话被剔除", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1"), binding("s2")],
      sessions: [session("s1"), session("s2", undefined, true)],
    })
    expect(result.map((item) => item.sessionID)).toEqual(["s1"])
  })

  test("列表按绑定顺序排列，跟随绑定关系而非会话列表顺序", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s2"), binding("s1")],
      sessions: [session("s1"), session("s2")],
    })
    expect(result.map((item) => item.sessionID)).toEqual(["s2", "s1"])
  })

  test("标题取自会话本身", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1")],
      sessions: [session("s1", "我的草稿")],
    })
    expect(result[0]?.title).toBe("我的草稿")
  })

  test("指向不存在会话的绑定被剔除", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1"), binding("ghost")],
      sessions: [session("s1")],
    })
    expect(result.map((item) => item.sessionID)).toEqual(["s1"])
  })

  test("同一会话的重复绑定只出现一次", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1"), binding("s1")],
      sessions: [session("s1")],
    })
    expect(result.map((item) => item.sessionID)).toEqual(["s1"])
  })

  test("绑定变更后列表跟随刷新：新增绑定即出现在列表", () => {
    const before = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1")],
      sessions: [session("s1"), session("s2")],
    })
    expect(before.map((item) => item.sessionID)).toEqual(["s1"])

    const after = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1"), binding("s2")],
      sessions: [session("s1"), session("s2")],
    })
    expect(after.map((item) => item.sessionID)).toEqual(["s1", "s2"])
  })

  test("无绑定时返回空列表", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [],
      sessions: [session("s1")],
    })
    expect(result).toEqual([])
  })

  test("子代理会话被剔除（懒绑定连带标记，不属于用户对话线）", () => {
    const result = boundNovelSessions({
      novelID: "novel-1",
      bindings: [binding("s1"), binding("sub1"), binding("s2")],
      sessions: [session("s1"), session("sub1", "审查第二章连续性（@auditor subagent）", false, "s1"), session("s2")],
    })
    expect(result.map((item) => item.sessionID)).toEqual(["s1", "s2"])
  })
})
