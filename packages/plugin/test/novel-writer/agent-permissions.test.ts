import { afterEach, describe, expect, test } from "bun:test"
import { join } from "path"
import { tmpdir } from "os"
import { rmSync } from "fs"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

const highImpactTools = [
  "delete_chapter",
  "delete_setting",
  "cascade_execute",
  "accept_pending_setting",
  "merge_pending_settings",
  "deduplicate_characters",
  "deduplicate_relationships",
  "update_project_config",
]

let projectDir: string

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

describe("novel-writer agent permissions", () => {
  test("marks high-impact director tools as ask and keeps pipeline tools allowed", async () => {
    projectDir = join(tmpdir(), `agent-permissions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const input = createPluginInput(projectDir)
    const hooks = await NovelWriterPlugin(input)

    await hooks.config?.(input)
    const permission = input.agent?.director?.permission
    const pipelinePermission = input.agent?.pipeline?.permission
    if (!permission || !pipelinePermission) throw new Error("novel-writer agent permissions were not configured")

    for (const tool of highImpactTools) {
      expect(permission[tool]).toBe("ask")
    }

    // restore_chapter_version 追加新版本而不删除历史，纯可逆操作，直接放行
    expect(permission.restore_chapter_version).toBe("allow")

    expect(pipelinePermission.read_chapter_content).toBe("allow")
    expect(pipelinePermission.commit_state_delta).toBe("allow")
    expect(pipelinePermission.update_chapter).toBe("allow")
  })
})
