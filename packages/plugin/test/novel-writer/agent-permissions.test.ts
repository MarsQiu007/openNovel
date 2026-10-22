import { describe, expect, test } from "bun:test"
import { directorAgent } from "../../src/novel-writer/agents/director.js"
import { pipelineAgent } from "../../src/novel-writer/agents/pipeline.js"

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
})
