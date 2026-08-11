/**
 * collectDescendants 级联收集测试
 *
 * 主代理会话派生的子代理会话（可能多层嵌套）必须全部被收集，
 * 未关联会话不受影响；环状数据不会死循环。
 */
import { describe, test, expect } from "bun:test"
import type { Session } from "@opennovel-ai/sdk/v2/client"
import { collectDescendants } from "./session-descendants"

function session(id: string, parentID?: string): Session {
  return {
    id,
    parentID,
    time: { created: 1, updated: 1 },
  } as unknown as Session
}

describe("collectDescendants", () => {
  test("收集直接子会话与多层嵌套后代", () => {
    const sessions = [
      session("root"),
      session("child-a", "root"),
      session("child-b", "root"),
      session("grandchild", "child-a"),
      session("unrelated"),
      session("other-child", "unrelated"),
    ]
    const result = collectDescendants("root", sessions)
    expect(result.map((s) => s.id).sort()).toEqual(["child-a", "child-b", "grandchild"])
  })

  test("无子会话时返回空数组", () => {
    const sessions = [session("root"), session("other")]
    expect(collectDescendants("root", sessions)).toEqual([])
  })

  test("环状 parent 数据不会死循环", () => {
    // a -> b -> a 的人造环：visited 防护保证每个节点最多收集一次
    const sessions = [session("a", "b"), session("b", "a")]
    const result = collectDescendants("a", sessions)
    expect(result.map((s) => s.id)).toEqual(["b"])
  })
})
