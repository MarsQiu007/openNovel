/**
 * novel-writer V2 入口注册测试
 *
 * 手写 AgentDraft 假件（plugin 包不可导入 core，无法用真实注册表），
 * 语义对齐 core/src/agent.ts 的 draft：update 为 upsert。
 */
import { describe, expect, test } from "bun:test"
import type { AgentV2Info } from "@opennovel-ai/sdk/v2/types"
import novelWriterV2, { registerWritingAgents } from "../../src/novel-writer-v2.js"
import { directorAgent } from "../../src/novel-writer/agents/director.js"
import { pipelineAgent } from "../../src/novel-writer/agents/pipeline.js"
import type { AgentDraft } from "../../src/v2/effect/agent.js"

const WRITING_AGENTS = [
  "director",
  "architect",
  "pipeline",
  "writer",
  "observer",
  "reflector",
  "auditor",
  "reviser",
  "outliner",
  "librarian",
  "ideator",
  "research",
] as const

function fakeDraft() {
  const agents = new Map<string, AgentV2Info>()
  let selected: string | undefined
  const draft: AgentDraft = {
    list: () => [...agents.values()],
    get: (id) => agents.get(id),
    default: (id) => {
      selected = id
    },
    update: (id, update) => {
      const fallback: AgentV2Info = {
        id,
        mode: "subagent",
        hidden: false,
        request: { headers: {}, body: {} },
        permissions: [],
      }
      const current = agents.get(id) ?? fallback
      if (!agents.has(id)) agents.set(id, current)
      update(current)
      current.id = id
    },
    remove: (id) => agents.delete(id),
  }
  // 预置真实注册表中存在的内置 agent，验证 remove 生效
  for (const id of ["build", "plan", "general", "explore", "compaction", "title", "summary"]) {
    draft.update(id, () => {})
  }
  return { draft, selected: () => selected }
}

describe("novel-writer V2 入口", () => {
  test("导出符合 V2 default { id, effect } 契约", () => {
    expect(novelWriterV2.id).toBe("novel-writer")
    expect(typeof novelWriterV2.effect).toBe("function")
  })

  test("注册 12 个写作 agent 并设置 director 为默认", () => {
    const { draft, selected } = fakeDraft()
    registerWritingAgents(draft)
    const ids = draft.list().map((agent) => agent.id)
    for (const id of WRITING_AGENTS) {
      expect(ids).toContain(id)
    }
    expect(selected()).toBe("director")

    const director = draft.get("director")
    expect(director?.mode).toBe("primary")
    expect(director?.category).toBe("orchestration")
    expect(director?.system).toBe(directorAgent.prompt)
    expect(director?.description).toBe(directorAgent.description)

    const writer = draft.get("writer")
    expect(writer?.mode).toBe("subagent")
    expect(writer?.category).toBe("creation")

    const research = draft.get("research")
    expect(research?.mode).toBe("subagent")
    expect(research?.category).toBe("research")
    expect(research?.permissions).toContainEqual({ action: "browser", resource: "*", effect: "allow" })
  })

  test("禁用 build/plan 内置 agent，其余内置不受影响", () => {
    const { draft } = fakeDraft()
    registerWritingAgents(draft)
    expect(draft.get("build")).toBeUndefined()
    expect(draft.get("plan")).toBeUndefined()
    expect(draft.get("general")).toBeDefined()
    expect(draft.get("explore")).toBeDefined()
  })

  test("V1 permission map 直译为 V2 ruleset（subagent 权限键来自单一来源）", () => {
    const { draft } = fakeDraft()
    registerWritingAgents(draft)
    for (const id of ["director", "pipeline"]) {
      const agent = draft.get(id)
      expect(agent?.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "allow" })
      expect(agent?.permissions.some((rule) => rule.action === "task")).toBe(false)
    }
    const pipeline = draft.get("pipeline")
    expect(pipeline?.system).toBe(pipelineAgent.prompt)
    expect(pipeline?.permissions).toContainEqual({ action: "read", resource: "*", effect: "allow" })
  })
})
