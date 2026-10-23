import { describe, expect, test } from "bun:test"
import { architectAgent } from "../../src/novel-writer/agents/architect.js"
import { auditorAgent } from "../../src/novel-writer/agents/auditor.js"
import { directorAgent } from "../../src/novel-writer/agents/director.js"
import { ideatorAgent } from "../../src/novel-writer/agents/ideator.js"
import { librarianAgent } from "../../src/novel-writer/agents/librarian.js"
import { observerAgent } from "../../src/novel-writer/agents/observer.js"
import { outlinerAgent } from "../../src/novel-writer/agents/outliner.js"
import { pipelineAgent } from "../../src/novel-writer/agents/pipeline.js"
import { reflectorAgent } from "../../src/novel-writer/agents/reflector.js"
import { researchAgent } from "../../src/novel-writer/agents/research.js"
import { reviserAgent } from "../../src/novel-writer/agents/reviser.js"
import { writerAgent } from "../../src/novel-writer/agents/writer.js"

const highImpactTools = [
  "delete_chapter",
  "delete_setting",
  "cascade_execute",
  "accept_pending_setting",
  "merge_pending_settings",
  "resolve_conflict",
  "deduplicate_characters",
  "deduplicate_relationships",
  "update_project_config",
]

describe("novel-writer agent permissions", () => {
  test("marks high-impact director tools as ask and keeps pipeline tools allowed", () => {
    for (const tool of highImpactTools) {
      expect(directorAgent.permission[tool]).toBe("ask")
    }

    // restore_chapter_version 追加新版本而不删除历史，纯可逆操作，直接放行
    expect(directorAgent.permission.restore_chapter_version).toBe("allow")

    expect(pipelineAgent.permission.read_chapter_content).toBe("allow")
    expect(pipelineAgent.permission.commit_state_delta).toBe("allow")
    expect(pipelineAgent.permission.update_chapter).toBe("allow")
  })

  test("browser 工具族仅 research 放行，其余写作 agent 显式 deny", () => {
    // browser deny 必须位于通配 "*" 之后（findLast 取最后匹配），对齐 generate_chapter_outline 先例
    for (const agent of [
      directorAgent,
      architectAgent,
      pipelineAgent,
      writerAgent,
      observerAgent,
      reflectorAgent,
      auditorAgent,
      reviserAgent,
      outlinerAgent,
      librarianAgent,
    ]) {
      expect(agent.permission.browser, agent.name).toBe("deny")
      expect(
        Object.keys(agent.permission).indexOf("browser"),
        agent.name,
      ).toBeGreaterThan(Object.keys(agent.permission).indexOf("*"))
    }
    // ideator 是 "*" deny 的只读 agent，通配已覆盖 browser，无需显式条目
    expect(ideatorAgent.permission["*"]).toBe("deny")
    expect(researchAgent.permission.browser).toBe("allow")
  })
})
