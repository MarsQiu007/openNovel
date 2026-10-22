import { EOL } from "os"
import { basename } from "path"
import { Effect } from "effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { Location } from "@opennovel-ai/core/location"
import { buildLocationServiceMap, LocationServiceMap } from "@opennovel-ai/core/location-services"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionExecutionLocal } from "@opennovel-ai/core/session/execution/local"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { iife } from "../../../util/iife"
import { fail } from "../../effect-cmd"

// 同进程内 SessionV2 与位置服务必须共享同一个 LocationServiceMap 实例：
// 权限评估（SessionStore / AgentV2 都经 map 构建）要与会话写入落在同一张服务图上
// （server.ts 的组合同款，layer 值复用经共享 memoMap 去重）。
const locationServiceMap = buildLocationServiceMap()
const sessionV2Layer = AppNodeBuilder.build(SessionV2.node, [
  [LocationServiceMap.node, locationServiceMap],
  [SessionExecution.node, SessionExecutionLocal.node],
])

export const debugAgent = Effect.fn("Cli.debug.agent")(function* (args: {
  name: string
  tool?: string
  params?: string
}) {
  // V2 服务是 Location 作用域；调试命令就地构建当前目录的位置服务，不走 V1 实例
  const ref = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
  return yield* run(args, ref).pipe(
    Effect.provide(LocationServiceMap.Service.get(ref)),
    Effect.provide(sessionV2Layer),
    Effect.provide(locationServiceMap),
  )
})

const run = Effect.fn("Cli.debug.agent.body")(function* (
  args: { name: string; tool?: string; params?: string },
  ref: Location.Ref,
) {
  const agentName = args.name
  const plugins = yield* PluginV2.Service
  const agents = yield* AgentV2.Service
  // 插件 boot 是 forkScoped 异步批（core plugin/internal），State.batch 整批结束才
  // commit；config-agent 排在内置 agent 插件之后，wait 返回时两者的 transform 均已
  // 注册，手动 reload 强制 materialize，使读取与 boot 进度解耦（同 server agent.list）
  yield* plugins.wait(PluginV2.ID.make("config-agent")).pipe(
    Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.void }),
  )
  yield* agents.reload()
  const agent = yield* agents.get(AgentV2.ID.make(agentName))
  if (!agent) {
    process.stderr.write(
      `Agent ${agentName} not found, run '${basename(process.execPath)} agent list' to get an agent list` + EOL,
    )
    return yield* fail("", 1)
  }

  const registry = yield* ToolRegistry.Service
  // materialize 只返回未被整体禁用的工具；对照全量与按 agent 权限过滤的两份定义
  // 得出每个工具的启用状态
  const all = yield* registry.materialize()
  const enabled = yield* registry.materialize(agent.permissions)
  const enabledTools = new Set(enabled.definitions.map((item) => item.name))
  const resolved = Object.fromEntries(all.definitions.map((item) => [item.name, enabledTools.has(item.name)]))

  const toolID = args.tool
  if (toolID) {
    if (!all.definitions.some((item) => item.name === toolID)) {
      process.stderr.write(`Tool ${toolID} not found for agent ${agentName}` + EOL)
      return yield* fail("", 1)
    }
    if (!enabledTools.has(toolID)) {
      process.stderr.write(`Tool ${toolID} is disabled for agent ${agentName}` + EOL)
      return yield* fail("", 1)
    }
    const params = parseToolParams(args.params)
    // 叶子工具的权限评估按 sessionID 读 SessionStore（合成 ID 会 NotFound），
    // 与 V1 行为对齐：建真实调试会话再执行
    const sessionV2 = yield* SessionV2.Service
    const session = yield* sessionV2
      .create({ title: `Debug tool run (${agentName})`, agent: agent.id, location: ref })
      .pipe(Effect.orDie)
    const settlement = yield* enabled
      .settle({
        sessionID: session.id,
        agent: agent.id,
        assistantMessageID: SessionMessage.ID.create(),
        call: { type: "tool-call", id: `call_debug_${Date.now()}`, name: toolID, input: params },
      })
      .pipe(Effect.orDie)
    process.stdout.write(JSON.stringify({ tool: toolID, input: params, result: settlement.result }, null, 2) + EOL)
    return
  }

  const output = {
    ...agent,
    tools: resolved,
  }
  process.stdout.write(JSON.stringify(output, null, 2) + EOL)
})

function parseToolParams(input?: string) {
  if (!input) return {}
  const trimmed = input.trim()
  if (trimmed.length === 0) return {}

  const parsed = iife(() => {
    try {
      return JSON.parse(trimmed)
    } catch (jsonError) {
      try {
        return new Function(`return (${trimmed})`)()
      } catch (evalError) {
        throw new Error(
          `Failed to parse --params. Use JSON or a JS object literal. JSON error: ${jsonError}. Eval error: ${evalError}.`,
          { cause: evalError },
        )
      }
    }
  })

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool params must be an object.")
  }
  return parsed as Record<string, unknown>
}
