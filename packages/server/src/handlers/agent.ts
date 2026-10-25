import { AgentV2 } from "@opennovel-ai/core/agent"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers.handle("agent.list", () =>
    Effect.gen(function* () {
      // 插件 boot 是 forkScoped 的异步批（core plugin/internal），State.batch 在整批
      // 结束后才统一 commit，一次性 CLI 进程的首个查询可能在注册表落地前返回空。
      // boot 批按序加载，config-agent 排在内置 agent 插件之后：wait 返回时两者的
      // transform 均已注册（transform 注册在插件 effect 内完成），再手动 reload
      // 强制 materialize 已注册 transform，使读取与 boot 进度解耦；boot 异常时
      // 超时兜底返回当前注册表，避免请求挂死。
      const plugins = yield* PluginV2.Service
      yield* plugins.wait(PluginV2.ID.make("config-agent")).pipe(
        Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.void }),
      )
      // config-plugin 的第一方/文件路径外部插件随其 effect 同步装载（core
      // config/plugin/external）：wait 返回即代表这些插件的 agent transform 已注册，
      // 首查花名册不缺员；registry 第三方保持 fork 最终一致，不就绪兜底同左。
      yield* plugins.wait(PluginV2.ID.make("config-plugin")).pipe(
        Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.void }),
      )
      const agents = yield* AgentV2.Service
      yield* agents.reload()
      return yield* response(agents.all())
    }),
  ),
)
