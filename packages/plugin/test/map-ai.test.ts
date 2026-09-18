import { describe, expect, test } from "bun:test"
import { formatWorldMapAiPrompt, runWorldMapAiDraft, validateWorldMapAiDraft } from "../src/novel-writer/map-ai.js"

const validDraft = {
  title: "青岚大陆",
  description: "东部临海、西部荒漠的大陆。",
  features: [
    {
      kind: "region",
      name: "西部荒漠",
      description: "干燥的荒漠区域",
      color: "#f97316",
      worldEntryId: null,
      polygon: [
        { x: 200, y: 300 },
        { x: 3600, y: 500 },
        { x: 1800, y: 3200 },
      ],
    },
    {
      kind: "place",
      name: "青岚城",
      description: "东部商业重镇",
      color: "#4f46e5",
      worldEntryId: "entry-1",
      x: 7000,
      y: 6200,
    },
  ],
}

describe("world map AI draft", () => {
  test("合法输出直接写入，不触发重试", async () => {
    const calls: unknown[] = []
    const writes: unknown[] = []
    await runWorldMapAiDraft(
      async (feedback) => {
        calls.push(feedback)
        return validDraft
      },
      async (draft) => {
        writes.push(draft)
      },
    )
    expect(calls).toEqual([undefined])
    expect(writes).toHaveLength(1)
  })

  test("非法输出注入错误反馈并只重试一次", async () => {
    const prompts: Array<{ error?: string } | undefined> = []
    const writes: unknown[] = []
    await runWorldMapAiDraft(
      async (feedback) => {
        prompts.push(feedback)
        if (!feedback) return { title: "", features: [] }
        return validDraft
      },
      async (draft) => {
        writes.push(draft)
      },
    )
    expect(prompts).toHaveLength(2)
    expect(prompts[1]?.error).toContain("结构化地图输出校验失败")
    expect(writes).toHaveLength(1)
  })

  test("第二次仍失败时不写入", async () => {
    let calls = 0
    let writes = 0
    await expect(
      runWorldMapAiDraft(
        async () => {
          calls += 1
          return { title: "x", features: [{ kind: "region", polygon: [] }] }
        },
        async () => {
          writes += 1
        },
      ),
    ).rejects.toThrow("重试仍失败")
    expect(calls).toBe(2)
    expect(writes).toBe(0)
  })

  test("校验拒绝越界坐标、退化区域和图钉外泄字段", () => {
    expect(validateWorldMapAiDraft({ ...validDraft, features: [{ ...validDraft.features[0], polygon: [] }] }).ok).toBe(false)
    expect(validateWorldMapAiDraft({ ...validDraft, features: [{ ...validDraft.features[1], x: 10001, y: 0 }] }).ok).toBe(false)
  })

  test("提示词包含条目、指令、坐标约定和工具约束", () => {
    const prompt = formatWorldMapAiPrompt({
      entries: [{ id: "entry-1", title: "青岚城", category: "地点", content: "东部港口城市" }],
      instruction: "西部是沙漠，东部是群岛",
    })
    expect(prompt).toContain("entry-1")
    expect(prompt).toContain("西部是沙漠")
    expect(prompt).toContain("0..10000")
    expect(prompt).toContain("write_world_map_draft")
  })
})
