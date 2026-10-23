import * as InstanceState from "@/effect/instance-state"
import { LocationServiceMap, locationServiceMapLayer } from "@opennovel-ai/core/location-services"
import { Location } from "@opennovel-ai/core/location"
import { Mcp } from "@opennovel-ai/core/mcp"
import { ConfigMigrateV1 } from "@opennovel-ai/core/config/v1/migrate"
import { ConfigMCP } from "@opennovel-ai/core/config/mcp"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { McpServerNotFoundError } from "../errors"
import { AddPayload, AuthCallbackPayload, StatusMap, UnsupportedOAuthError } from "../groups/mcp"

export const mcpHandlers = HttpApiBuilder.group(InstanceHttpApi, "mcp", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service

    const mcp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(InstanceState.context, (context) =>
        effect.pipe(
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(context.directory) }))),
        ),
      )

    const status = Effect.fn("McpHttpApi.status")(function* () {
      return yield* mcp(Mcp.Service.use((mcp) => mcp.status()))
    })

    const add = Effect.fn("McpHttpApi.add")(function* (ctx: { payload: typeof AddPayload.Type }) {
      // wire 保持 V1 形状（SDK 客户端契约），handler 内转 V2 ServerConfig
      const config = yield* Schema.decodeUnknownEffect(ConfigMCP.Server)(
        ConfigMigrateV1.migrateMcp(ctx.payload.config),
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const result = (yield* mcp(Mcp.Service.use((mcp) => mcp.add(ctx.payload.name, config)))).status
      return yield* Schema.decodeUnknownEffect(StatusMap)(
        "status" in result ? { [ctx.payload.name]: result } : result,
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    // 约定：AuthError 映射到端点已声明的 400 系错误（wire 契约不变）
    const authStart = Effect.fn("McpHttpApi.authStart")(
      function* (ctx: { params: { name: string } }) {
        if (!(yield* mcp(Mcp.Service.use((mcp) => mcp.supportsOAuth(ctx.params.name))))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        const result = yield* mcp(Mcp.Service.use((mcp) => mcp.startAuth(ctx.params.name)))
        return { authorizationUrl: result.authorizationUrl, oauthState: result.oauthState }
      },
      Effect.catchTags({
        "MCP.NotFoundError": (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        "MCP.AuthError": (error) => Effect.fail(new UnsupportedOAuthError({ error: error.message })),
      }),
    )

    const authCallback = Effect.fn("McpHttpApi.authCallback")(
      function* (ctx: { params: { name: string }; payload: typeof AuthCallbackPayload.Type }) {
        return yield* mcp(Mcp.Service.use((mcp) => mcp.finishAuth(ctx.params.name, ctx.payload.code)))
      },
      Effect.catchTags({
        "MCP.NotFoundError": (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        "MCP.AuthError": () => Effect.fail(new HttpApiError.BadRequest({})),
      }),
    )

    const authAuthenticate = Effect.fn("McpHttpApi.authAuthenticate")(
      function* (ctx: { params: { name: string } }) {
        if (!(yield* mcp(Mcp.Service.use((mcp) => mcp.supportsOAuth(ctx.params.name))))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        return yield* mcp(Mcp.Service.use((mcp) => mcp.authenticate(ctx.params.name)))
      },
      Effect.catchTags({
        "MCP.NotFoundError": (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        "MCP.AuthError": (error) => Effect.fail(new UnsupportedOAuthError({ error: error.message })),
      }),
    )

    const authRemove = Effect.fn("McpHttpApi.authRemove")(function* (ctx: { params: { name: string } }) {
      const status = yield* mcp(Mcp.Service.use((mcp) => mcp.status()))
      if (!(ctx.params.name in status))
        return yield* new McpServerNotFoundError({
          name: ctx.params.name,
          message: `MCP server not found: ${ctx.params.name}`,
        })
      yield* mcp(Mcp.Service.use((mcp) => mcp.removeAuth(ctx.params.name)))
      return { success: true as const }
    })

    const connect = Effect.fn("McpHttpApi.connect")(function* (ctx: { params: { name: string } }) {
      yield* mcp(Mcp.Service.use((mcp) => mcp.connect(ctx.params.name))).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(
            new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
          ),
        ),
      )
      return true
    })

    const disconnect = Effect.fn("McpHttpApi.disconnect")(function* (ctx: { params: { name: string } }) {
      yield* mcp(Mcp.Service.use((mcp) => mcp.disconnect(ctx.params.name))).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(
            new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
          ),
        ),
      )
      return true
    })

    return handlers
      .handle("status", status)
      .handle("add", add)
      .handle("authStart", authStart)
      .handle("authCallback", authCallback)
      .handle("authAuthenticate", authAuthenticate)
      .handle("authRemove", authRemove)
      .handle("connect", connect)
      .handle("disconnect", disconnect)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
