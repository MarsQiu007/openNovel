import { Sync } from "@opennovel-ai/schema/sync"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/api/sync"
const openapi = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({ identifier, summary, description })

export class SyncErrorResponse extends Schema.ErrorClass<SyncErrorResponse>("SyncErrorResponse")(
  {
    name: Schema.Literal("SyncErrorResponse"),
    data: Schema.Struct({
      message: Schema.String,
      code: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

/**
 * 云盘同步是库级操作：连接与项目配对都是全局的，
 * 以设置的工作根目录为边界，不挂在单个项目 Location 上。
 */
export const SyncGroup = HttpApiGroup.make("server.sync")
  .add(
    HttpApiEndpoint.get("sync.status", `${root}/status`, {
      success: Sync.LibraryStatus,
      error: SyncErrorResponse,
    }).annotateMerge(
      openapi("v2.sync.status", "Get sync status", "Get the library-level cloud sync status for the configured root directory."),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.connection.test", `${root}/connection/test`, {
      payload: Sync.ConnectionInput,
      success: Sync.TestResult,
    }).annotateMerge(
      openapi("v2.sync.connection.test", "Test connection", "Test a WebDAV connection without saving it."),
    ),
  )
  .add(
    HttpApiEndpoint.put("sync.connection.save", `${root}/connection`, {
      payload: Sync.ConnectionInput,
      success: Sync.LibraryStatus,
      error: SyncErrorResponse,
    }).annotateMerge(
      openapi(
        "v2.sync.connection.save",
        "Save connection",
        "Test, then persist the cloud drive connection. The password goes to the credential store.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.delete("sync.connection.remove", `${root}/connection`, {
      success: Sync.LibraryStatus,
      error: SyncErrorResponse,
    }).annotateMerge(
      openapi("v2.sync.connection.remove", "Remove connection", "Remove the cloud drive connection and credential."),
    ),
  )
  .add(
    HttpApiEndpoint.put("sync.root.set", `${root}/root`, {
      payload: Sync.RootInput,
      success: Sync.LibraryStatus,
      error: SyncErrorResponse,
    }).annotateMerge(
      openapi(
        "v2.sync.root.set",
        "Set root directory",
        "Set the local working root directory. Every non-hidden subdirectory containing .novel/ is a synced project.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.run", `${root}/run`, {
      success: Sync.RunOutput,
      error: SyncErrorResponse,
    }).annotateMerge(
      openapi(
        "v2.sync.run",
        "Sync now",
        "Sync the whole library: newer content wins on both directions; ambiguous cases come back as decisions.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.resolve", `${root}/resolve`, {
      payload: Sync.ResolveInput,
      success: Sync.LibraryStatus,
      error: SyncErrorResponse,
    }).annotateMerge(
      openapi(
        "v2.sync.resolve",
        "Resolve decision",
        "Execute a single decision item (keep local/remote/both, confirm deletions, or skip).",
      ),
    ),
  )
