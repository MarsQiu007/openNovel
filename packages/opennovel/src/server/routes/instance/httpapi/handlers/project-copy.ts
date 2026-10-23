import * as InstanceState from "@/effect/instance-state"
import { Catalog } from "@opennovel-ai/core/catalog"
import { Integration } from "@opennovel-ai/core/integration"
import { Location } from "@opennovel-ai/core/location"
import { LocationServiceMap } from "@opennovel-ai/core/location-services"
import { ModelV2 } from "@opennovel-ai/core/model"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionRunnerModel } from "@opennovel-ai/core/session/runner/model"
import { Slug } from "@opennovel-ai/core/util/slug"
import { LLM, LLMClient } from "@opennovel-ai/llm"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const projectCopyHandlers = HttpApiBuilder.group(InstanceHttpApi, "projectCopyName", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const llm = yield* LLMClient.Service

    // Catalog/Integration 是位置树成员（LocationServiceMap 按 ref 构建），
    // 组构建期不可直取；请求内按实例目录 provide（与 fileHandlers 同模式）。
    const generate = Effect.fnUntraced(function* (text: string) {
      const catalog = yield* Catalog.Service
      const integrations = yield* Integration.Service
      // V2 选型：默认模型优先、同 provider 小模型更佳；均不支持 native 路由时
      // 回退 catalog 首个可流式模型（与 SessionRunnerModel.supported 口径一致）。
      const available = yield* catalog.model.available()
      const preferred = yield* catalog.model.default()
      const small = preferred ? yield* catalog.model.small(preferred.providerID) : undefined
      const info = [small, preferred, ...available].find(
        (model): model is ModelV2.Info => model !== undefined && SessionRunnerModel.supported(model),
      )
      if (!info) return Slug.create()
      const provider = yield* catalog.provider.get(info.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(info.providerID),
      )
      const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
      const model = yield* SessionRunnerModel.fromCatalogModel(info, credential)
      const response = yield* llm.generate(
        LLM.request({
          model,
          system: [],
          tools: [],
          prompt: `Generate a short 2-3 word name that describes this task:\n${text}`,
        }),
      )
      const output = response.text.trim()
      return output ? slugify(output.split(/\s+/).slice(0, 3).join(" ")) : Slug.create()
    })

    const generateName = Effect.fn("ProjectCopyHttpApi.generateName")(function* (context: string | undefined) {
      const text = context?.trim()
      if (!text) return Slug.create()
      const ctx = yield* InstanceState.context
      return yield* generate(text).pipe(
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))),
      )
    })

    return handlers.handle("generateName", (ctx) =>
      generateName(ctx.payload.context).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project copy name generation failed", {
            projectID: ctx.params.projectID,
            cause,
          }).pipe(Effect.as(Slug.create())),
        ),
        Effect.map((name) => ({ name })),
      ),
    )
  }),
)

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}
