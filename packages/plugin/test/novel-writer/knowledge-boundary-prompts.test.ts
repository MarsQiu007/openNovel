import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { outlinerAgent } from "../../src/novel-writer/agents/outliner.js"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"
import { pipelineAgentConfig } from "../../src/novel-writer/agents/pipeline.js"

const outlinerPrompt = outlinerAgent.prompt
const writerPrompt = writerAgentConfig.systemPrompt
const pipelinePrompt = pipelineAgentConfig.systemPrompt

describe("知识边界提示词链路", () => {
  test("outliner 职责包含信息差场景识别与正反例", () => {
    expect(outlinerPrompt).toContain("识别信息差场景")
    expect(outlinerPrompt).toContain("谁知道什么、谁不知道什么、依据哪段前文")
    expect(outlinerPrompt).toContain("家人仅知主角晚归，不知坠崖")
    expect(outlinerPrompt).toContain("配合隐瞒的知情者")
  })

  test("outliner 输出格式含 knowledgeBoundary 且要求渲染为字段行", () => {
    expect(outlinerPrompt).toContain("knowledgeBoundary")
    expect(outlinerPrompt).toContain("- **信息边界**：")
  })

  test("writer 规则 32 含知情范围约束与 POV 例外", () => {
    expect(writerPrompt).toContain("清单条目含「知情范围」时")
    expect(writerPrompt).toContain("MUST NOT 对不知情事件表现知情特征")
    expect(writerPrompt).toContain("MUST NOT 在正文中直述")
    expect(writerPrompt).toContain("唯一例外：叙述视角角色的内心独白")
  })

  test("writer 自检清单含知情范围核对", () => {
    expect(writerPrompt).toContain("清单条目含「知情范围」行时")
    expect(writerPrompt).toContain("“不知道/没意识到”类直述")
  })

  test("pipeline dispatch 指示点明知情范围同等级约束", () => {
    expect(pipelinePrompt).toContain("含「知情范围」行：出场角色言行不得超出其知情范围")
  })

  test("章纲默认模板含信息边界字段行", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/novel-writer/outline.ts"), "utf8")
    expect(source).toContain('lines.push("- **信息边界**：（待填写）")')
  })
})
