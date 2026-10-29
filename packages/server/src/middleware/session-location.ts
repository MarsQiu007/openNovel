import { Database } from "@opennovel-ai/core/database/database"
import { LocationServiceMap } from "@opennovel-ai/core/location-services"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { WorkspaceV2 } from "@opennovel-ai/core/workspace"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "@opennovel-ai/protocol/errors"
import { sharedRef, type LocationServices } from "../location"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@opennovel/HttpApiSessionLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

const decodeSessionID = Schema.decodeUnknownEffect(SessionV2.ID)

export const sessionLocationLayer = Layer.effect(
  SessionLocationMiddleware,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* LocationServiceMap.Service

    return SessionLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        const sessionID = yield* decodeSessionID(route.params.sessionID).pipe(
          Effect.mapError(
            () =>
              new InvalidRequestError({
                message: "Invalid session ID",
                field: "sessionID",
              }),
          ),
        )
        const row = yield* db
          .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row)
          return yield* new SessionNotFoundError({
            sessionID,
            message: `Session not found: ${sessionID}`,
          })

        // 复用 sharedRef 的去重：session 系请求若每次新建 Ref 对象，LayerMap 会按
        // 对象 identity 逐请求新建 location 层树（与 LocationMiddleware 的树分裂，
        // AgentV2 registry/插件 boot 状态互不相通）。
        return yield* effect.pipe(
          Effect.provide(
            locations.get(
              sharedRef(
                row.directory,
                row.workspaceID ? WorkspaceV2.ID.make(row.workspaceID) : undefined,
              ),
            ),
          ),
        )
      }),
    )
  }),
)
