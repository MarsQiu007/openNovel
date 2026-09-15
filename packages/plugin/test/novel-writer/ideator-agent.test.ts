import { describe, expect, test } from "bun:test"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { ideatorAgentConfig } from "../../src/novel-writer/agents/ideator.js"
import { directorAgentConfig } from "../../src/novel-writer/agents/director.js"
import { architectAgent } from "../../src/novel-writer/agents/architect.js"
import { pipelineAgentConfig } from "../../src/novel-writer/agents/pipeline.js"
import type { Config } from "../../src/index.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

const ideatorReadTools = [
  "check_novel_settings",
  "list_settings",
  "read_setting",
  "search_settings",
  "list_story_arcs",
  "recall_history",
  "read_chapter_content",
]

const ideatorForbiddenTools = [
  "save_novel_settings",
  "update_setting",
  "delete_setting",
  "manage_characters",
  "create_relationship",
  "generate_master_outline",
  "generate_volume_outline",
  "generate_chapter_outline",
  "plan_story_arc",
  "record_arc_beat",
  "backfill_story_arcs",
  "write_chapter",
  "revise_chapter",
  "commit_state_delta",
  "commit_observer_delta",
  "update_project_config",
]

describe("novel ideator agent", () => {
  test("defines four read-only ideation modes with a unified candidate format", () => {
    expect(ideatorAgentConfig.name).toBe("ideator")
    expect(ideatorAgentConfig.mode).toBe("subagent")
    for (const mode of ["book_pitch", "plot_spark", "character_spark", "material_spark"]) {
      expect(ideatorAgentConfig.systemPrompt).toContain(`mode: ${mode}`)
    }
    expect(ideatorAgentConfig.systemPrompt).toContain("只读 agent")
    expect(ideatorAgentConfig.systemPrompt).toContain("以下仅为灵感候选，尚未落库")
    expect(ideatorAgentConfig.systemPrompt).toContain("一句话概念")
    expect(ideatorAgentConfig.systemPrompt).toContain("对既有故事的影响")
    expect(ideatorAgentConfig.systemPrompt).toContain("风险或代价")
    expect(ideatorAgentConfig.systemPrompt).toContain("下一步落地建议")
    expect(ideatorAgentConfig.systemPrompt).toContain("总共只生成 3 个候选")
  })

  test("registers ideator as a read-only subagent", async () => {
    const hooks = await NovelWriterPlugin(createPluginInput("ideator-agent-test"))
    const configHook = hooks.config
    if (!configHook) throw new Error("NovelWriterPlugin config hook is missing")

    const input: Config = {}
    await configHook(input)
    const ideator = input.agent?.ideator
    if (!ideator) throw new Error("ideator agent configuration is missing")

    expect(ideator.mode).toBe("subagent")
    expect(ideator.description).toContain("只读")
    expect(ideator.prompt).toBe(ideatorAgentConfig.systemPrompt)
    if (typeof ideator.permission !== "object" || ideator.permission === null) {
      throw new Error("ideator permission configuration is missing")
    }

    expect(ideator.permission["*"]).toBe("deny")
    for (const tool of ideatorReadTools) {
      expect(ideator.permission[tool]).toBe("allow")
    }
    for (const tool of ideatorForbiddenTools) {
      expect(ideator.permission[tool]).toBe("deny")
    }
  })

  test("routes explicit ideation requests through director without automatic pipeline use", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain("@ideator")
    expect(prompt).toContain("mode: book_pitch")
    expect(prompt).toContain("mode: plot_spark")
    expect(prompt).toContain("mode: character_spark")
    expect(prompt).toContain("mode: material_spark")
    expect(prompt).toContain("普通剧情问答、设定查询和章节执行不要自动调用它")
    expect(prompt).toContain("以下仅为灵感候选，尚未落库")
    expect(prompt).toContain("完整保留创意家的候选结构")
    expect(prompt).toContain("原样保留为最终回复第一行")
    expect(prompt).toContain("临时灵感采纳（必须二次确认）")
    expect(prompt).toContain("只影响下一章 → 走章节大纲生成 / 更新流程")
    expect(prompt).toContain("影响支线或角色弧 → 走现有弧光维护流程")
    expect(prompt).toContain("影响整卷或主线 → dispatch @architect")
    expect(prompt).toContain("新增或修改设定 → 使用现有设定写入工具")

    expect(pipelineAgentConfig.systemPrompt).not.toContain("@ideator")
  })

  test("uses a confirmed creative brief as an architect hard constraint", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain("creative brief")
    expect(prompt).toContain("creative_brief")
    expect(prompt).toContain("注明“用户已确认”")

    const architectPrompt = architectAgent.systemPrompt
    expect(architectPrompt).toContain("creative_brief")
    expect(architectPrompt).toContain("brief 是硬约束")
    expect(architectPrompt).toContain("SHALL NOT 替换")
    expect(architectPrompt).toContain("不要落库")
    expect(architectPrompt).toContain("返回给 director")
  })
})
