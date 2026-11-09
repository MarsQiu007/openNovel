/**
 * novel-writer V2 原生插件入口
 *
 * 以 `default { id, effect }` 契约把写作面注册进 V2 宿主：禁用编程内置
 * agent（build/plan）、注册 12 个写作 agent、默认 agent 设为 director；
 * 经 ctx.tool.transform 一次注册 89 个写作工具（从 V1 机械转换的 effect-Schema
 * 版，窗口期 V1 入口保留同名 zod 版）；`.novel/` 存在的 Location 条件注册
 * novel-writer/context SystemContext 源（非小说目录零注入）、会话事件惰性计数
 * 与 /evaluate 模板命令（自评价）。权限以
 * agents/*.ts 的 permission map 为单一来源，逐键直译为 V2 ruleset。
 *
 * 经 novel 项目配置 `plugins: ["@opennovel-ai/plugin/novel-writer-v2"]` 加载。
 */
import { Effect } from "effect"
import { existsSync } from "fs"
import { join } from "path"
import { createNovelContextSource } from "./novel-writer/context-source.js"
import { registerEvaluateCommand } from "./novel-writer/evaluate/command.js"
import { watchSessionEvents } from "./novel-writer/evaluate/events.js"
import { createNovelWriterTools } from "./novel-writer/tools/index.js"
import { insightOrganizerAgent } from "./novel-writer/agents/insight-organizer.js"
import { watchToolInsightEvents } from "./tool-insight/collector.js"
import { createToolInsightOrganizer } from "./tool-insight/organizer.js"
import { createToolInsightTool } from "./tool-insight/tool.js"
import { architectAgent } from "./novel-writer/agents/architect.js"
import { auditorAgent } from "./novel-writer/agents/auditor.js"
import { directorAgent } from "./novel-writer/agents/director.js"
import { ideatorAgent } from "./novel-writer/agents/ideator.js"
import { librarianAgent } from "./novel-writer/agents/librarian.js"
import { observerAgent } from "./novel-writer/agents/observer.js"
import { outlinerAgent } from "./novel-writer/agents/outliner.js"
import { pipelineAgent } from "./novel-writer/agents/pipeline.js"
import { reflectorAgent } from "./novel-writer/agents/reflector.js"
import { researchAgent } from "./novel-writer/agents/research.js"
import { reviserAgent } from "./novel-writer/agents/reviser.js"
import { writerAgent } from "./novel-writer/agents/writer.js"
import type { AgentDraft } from "./v2/effect/agent.js"
import { define } from "./v2/effect/index.js"

export default define({
  id: "novel-writer",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform(registerWritingAgents)

    // 后台归因整理队列（任务 4.1/4.2）：独立于事件采集器，tool_insight 的
    // record/supplement/reorganize 与采集器落盘都汇入同一队列
    const organizer = createToolInsightOrganizer({
      ctx,
      projectDirectory: ctx.location.directory,
      session: ctx.session,
    })

    const tools = createNovelWriterTools({ session: ctx.session })
    yield* ctx.tool.transform((editor) => {
      for (const [name, spec] of Object.entries(tools)) editor.add(name, spec)
      // 工具改进日志的主动入口：任何目录都可记录问题（含写作外流程问题），
      // 运行时由全局开关决定是否落盘
      editor.add("tool_insight", createToolInsightTool({ configDir: ctx.paths.config, file: ctx.file, enqueue: organizer.enqueue }))
    })

    // 启动崩溃恢复（任务 4.2）：装载后按当前项目与日志根只补一次 pending
    yield* Effect.promise(() => organizer.recoverOnce())

    // 条件注册：仅小说目录注入上下文源，非小说目录零污染
    if (existsSync(join(ctx.location.directory, ".novel"))) {
      yield* ctx.systemContext.register(
        createNovelContextSource({
          session: ctx.session,
          directory: ctx.location.directory,
          configDir: ctx.paths.config,
        }),
      )
      yield* watchSessionEvents(ctx, ctx.location.directory)
      // 事件证据采集器（任务 3.1）：自身带全局开关门，未启用时零落盘；
      // 证据落盘即汇入归因整理队列
      yield* watchToolInsightEvents({ ctx, projectDirectory: ctx.location.directory, onDocumented: organizer.enqueue })
      yield* ctx.command.transform(registerEvaluateCommand)
    }
  }),
})

/** 注册写作 agent 家族：禁用 build/plan、upsert 写作 agent 与内部归因器、默认指向 director */
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
    researchAgent,
    insightOrganizerAgent,
  ]) {
    draft.update(agent.name, (item) => {
      item.description = agent.description
      item.mode = agent.mode
      item.category = agent.category
      item.system = agent.prompt
      item.permissions.push(...ruleset(agent.permission))
      // 内部归因器（hidden: true）不出现在用户可选列表
      item.hidden = "hidden" in agent ? agent.hidden === true : false
    })
  }
  draft.default("director")
}

/** V1 扁平 permission map → V2 ruleset（逐键直译，resource 恒为 "*"） */
function ruleset(permission: Record<string, "allow" | "ask" | "deny">) {
  return Object.entries(permission).map(([action, effect]) => ({
    action,
    resource: "*",
    effect,
  }))
}
