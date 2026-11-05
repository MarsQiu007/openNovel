import { ConfigV1 } from "@opennovel-ai/core/config/v1/config"
import { ConfigHealth } from "@opennovel-ai/core/config/health"
import { ConfigProviderV1 } from "@opennovel-ai/core/config/v1/provider"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { EventV2 } from "@opennovel-ai/core/event"
import { EventManifest } from "@/event-manifest"
import { InstanceDisposed } from "@/server/event"
import { InvalidRequestError } from "../errors"
import "@opennovel-ai/core/account"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
})

const SyncEventSchemas = EventManifest.Latest.values()
  .flatMap((definition) => {
    if (!definition.durable) return []
    return [
      Schema.Struct({
        type: Schema.Literal("sync"),
        id: EventV2.ID,
        syncEvent: Schema.Struct({
          type: Schema.Literal(EventV2.versionedType(definition.type, definition.durable.version)),
          id: EventV2.ID,
          seq: Schema.Finite,
          aggregateID: Schema.String,
          data: definition.data,
        }),
      }).annotate({ identifier: `SyncEvent.${definition.type}` }),
    ]
  })
  .toArray()

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([
    ...EventManifest.Latest.values()
      .map((definition) =>
        Schema.Struct({ id: EventV2.ID, type: Schema.Literal(definition.type), properties: definition.data }),
      )
      .toArray(),
    InstanceDisposed,
    ...SyncEventSchemas,
  ]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.optional(Schema.String),
})

const ConfigHealthFixInput = Schema.Struct({
  ids: Schema.Array(Schema.String),
})

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  config: "/global/config",
  configHealth: "/global/config/health",
  configHealthFix: "/global/config/health/fix",
  provider: "/global/config/provider/:providerID",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
} as const

const ProviderParams = Schema.Struct({
  providerID: ProviderV2.ID,
})

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the OpenNovel server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the OpenNovel system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(ConfigV1.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global OpenNovel configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: ConfigV1.Info,
        success: described(ConfigV1.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global OpenNovel configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.get("configHealth", GlobalPaths.configHealth, {
        success: described(Schema.Array(ConfigHealth.Issue), "Config health issues"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.health",
          summary: "Get config health",
          description:
            "Read-only health check of the global configuration: external plugin load failures, stale agent model overrides, and legacy agent definition leftovers.",
        }),
      ),
      HttpApiEndpoint.post("configHealthFix", GlobalPaths.configHealthFix, {
        payload: ConfigHealthFixInput,
        success: described(Schema.Array(ConfigHealth.Issue), "Remaining config health issues after fix"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.health.fix",
          summary: "Fix config health issues",
          description:
            "Apply user-confirmed fixes for the given config health issue ids, then return the remaining issues.",
        }),
      ),
      HttpApiEndpoint.put("providerSet", GlobalPaths.provider, {
        params: ProviderParams,
        payload: ConfigProviderV1.Info,
        success: described(Schema.Boolean, "Successfully saved custom provider configuration"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.provider.set",
          summary: "Save custom provider",
          description:
            "Replace the custom provider configuration wholesale (create or edit), and remove it from the disabled providers list.",
        }),
      ),
      HttpApiEndpoint.delete("providerRemove", GlobalPaths.provider, {
        params: ProviderParams,
        success: described(Schema.Boolean, "Successfully removed custom provider configuration"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.provider.remove",
          summary: "Remove custom provider",
          description:
            "Remove a custom provider configuration along with disabled/enabled list residue and stored credentials.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all OpenNovel instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: [HttpApiSchema.NoContent, GlobalUpgradeInput],
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade opennovel",
          description: "Upgrade opennovel to the specified version or latest if not specified.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
