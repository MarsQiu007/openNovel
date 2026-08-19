import { OpenNovel } from "@opennovel-ai/client/effect"
import { Credential } from "@opennovel-ai/core/credential"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Global } from "@opennovel-ai/core/global"
import { PermissionSaved } from "@opennovel-ai/core/permission/saved"
import { ApplicationTools } from "@opennovel-ai/core/tool/application-tools"
import { createEmbeddedRoutes } from "@opennovel-ai/server/routes"
import { Context, Effect, Layer, Scope } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"

export const create = Effect.fn("OpenNovel.create")(function* () {
  const scope = yield* Scope.Scope
  const memoMap = yield* Layer.makeMemoMap
  const context = yield* Layer.buildWithMemoMap(
    AppNodeBuilder.build(LayerNode.group([ApplicationTools.node, PermissionSaved.node, Global.node, Credential.node])),
    memoMap,
    scope,
  )
  const tools = Context.get(context, ApplicationTools.Service)
  const web = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        createEmbeddedRoutes().pipe(
          HttpRouter.provideRequest(
            Layer.mergeAll(
              Layer.succeed(PermissionSaved.Service, Context.get(context, PermissionSaved.Service)),
              Layer.succeed(Global.Service, Context.get(context, Global.Service)),
              Layer.succeed(Credential.Service, Context.get(context, Credential.Service)),
            ),
          ),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true, memoMap },
      ),
    ),
    (web) => Effect.promise(web.dispose),
  )
  const fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => web.handler(new Request(input, init)), {
    preconnect: () => undefined,
  }) satisfies typeof globalThis.fetch
  const client = yield* OpenNovel.make({ baseUrl: "http://opennovel.local" }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  )
  return {
    ...client,
    tools: { register: tools.register },
  }
})

export type Interface = Effect.Success<ReturnType<typeof create>>

export class Service extends Context.Service<Service, Interface>()("@opennovel-ai/sdk-next/OpenNovel") {}

export const layer = Layer.effect(Service, create())
