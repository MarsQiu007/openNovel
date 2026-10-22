/**
 * novel-writer V2 原生插件入口
 *
 * 以 `default { id, effect }` 契约把写作面注册进 V2 宿主：禁用编程内置
 * agent（build/plan）、注册 11 个写作 agent、默认 agent 设为 director；
 * 经 ctx.tool.transform 一次注册 88 个写作工具（从 V1 机械转换的 effect-Schema
 * 版，窗口期 V1 入口保留同名 zod 版）；`.novel/` 存在的 Location 条件注册
 * novel-writer/context SystemContext 源（非小说目录零注入）。权限以
 * agents/*.ts 的 permission map 为单一来源，就地转换为 V2 ruleset（task 工具在
 * V2 更名为 subagent）。
 *
 * 经 novel 项目配置 `plugins: ["@opennovel-ai/plugin/novel-writer-v2"]` 加载。
 */
import { Effect } from "effect"
import { existsSync } from "fs"
import { join } from "path"
import { createNovelContextSource } from "./novel-writer/context-source.js"
import { createNovelWriterTools } from "./novel-writer/tools/index.js"
import { architectAgent } from "./novel-writer/agents/architect.js"
import { auditorAgent } from "./novel-writer/agents/auditor.js"
import { directorAgent } from "./novel-writer/agents/director.js"
import { ideatorAgent } from "./novel-writer/agents/ideator.js"
import { librarianAgent } from "./novel-writer/agents/librarian.js"
import { observerAgent } from "./novel-writer/agents/observer.js"
import { outlinerAgent } from "./novel-writer/agents/outliner.js"
import { pipelineAgent } from "./novel-writer/agents/pipeline.js"
import { reflectorAgent } from "./novel-writer/agents/reflector.js"
import { reviserAgent } from "./novel-writer/agents/reviser.js"
import { writerAgent } from "./novel-writer/agents/writer.js"
import type { AgentDraft } from "./v2/effect/agent.js"
import { define } from "./v2/effect/index.js"

export default define({
  id: "novel-writer",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform(registerWritingAgents)

    const tools = createNovelWriterTools({ session: ctx.session })
    yield* ctx.tool.transform((editor) => {
      for (const [name, spec] of Object.entries(tools)) editor.add(name, spec)
    })

    // 条件注册：仅小说目录注入上下文源，非小说目录零污染
    if (existsSync(join(ctx.location.directory, ".novel"))) {
      yield* ctx.systemContext.register(
        createNovelContextSource({
          session: ctx.session,
          directory: ctx.location.directory,
          configDir: ctx.paths.config,
        }),
      )
    }
  }),
})

/** 注册写作 agent 家族：禁用 build/plan、upsert 11 个 agent、默认指向 director */
export function registerWritingAgents(draft: AgentDraft) {
  // 对齐 V1 hook 的 build/plan 无条件禁用
  draft.remove("build")
  draft.remove("plan")
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
    ideatorAgent,
  ]) {
    draft.update(agent.name, (item) => {
      item.description = agent.description
      item.mode = agent.mode
      item.category = agent.category
      item.system = agent.prompt
      item.permissions.push(...ruleset(agent.permission))
    })
  }
  draft.default("director")
}

/** V1 扁平 permission map → V2 ruleset；task 工具在 V2 更名为 subagent */
function ruleset(permission: Record<string, "allow" | "ask" | "deny">) {
  return Object.entries(permission).map(([action, effect]) => ({
    action: action === "task" ? "subagent" : action,
    resource: "*",
    effect,
  }))
}
