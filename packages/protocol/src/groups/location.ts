import { Location } from "@opennovel-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const TechniqueLibrary = Schema.Literals(["book", "global", "all"]).annotate({
  identifier: "TechniqueLibrary",
  description: "技法库范围：book=本书库（缺省）；global=全局通用库；all=双库合并",
})

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
  library: Schema.optional(TechniqueLibrary),
}).annotate({ identifier: "LocationQuery" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

export const LocationGroup = HttpApiGroup.make("server.location").add(
  HttpApiEndpoint.get("location.get", "/api/location", {
    query: LocationQuery,
    success: Location.Info,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.location.get",
        summary: "Get location",
        description: "Resolve the requested location or the server default location.",
      }),
    ),
)
