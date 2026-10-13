import { listAdapters } from "@/control-plane/adapters"
import { Workspace } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Vcs } from "@/project/vcs"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"
import { ApiVcsApplyError } from "../groups/instance"
import { ApiWorkspaceCreateError, ApiWorkspaceWarpError, CreatePayload, WarpPayload } from "../groups/workspace"

export const workspaceHandlers = HttpApiBuilder.group(InstanceHttpApi, "workspace", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service

    const adapters = Effect.fn("WorkspaceHttpApi.adapters")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.sync(() => listAdapters(instance.project.id))
    })

    const list = Effect.fn("WorkspaceHttpApi.list")(function* () {
      return yield* workspace.list((yield* InstanceState.context).project)
    })

    // Plugin throws surface as defects (because EffectBridge.fromPromise uses Effect.promise),
    // bypassing Effect.mapError. Walk the cause to surface the real error to the client.
    const causeReason = (cause: Cause.Cause<unknown>): unknown => {
      const die = cause.reasons.find(Cause.isDieReason)
      const fail = cause.reasons.find(Cause.isFailReason)
      return die?.defect ?? fail?.error
    }

    const create = Effect.fn("WorkspaceHttpApi.create")(function* (ctx: { payload: typeof CreatePayload.Type }) {
      const instance = yield* InstanceState.context
      return yield* workspace
        .create({
          ...ctx.payload,
          extra: ctx.payload.extra ?? null,
          projectID: instance.project.id,
        })
        .pipe(
          Effect.catchCause((cause) => {
            const reason = causeReason(cause)
            const message = reason instanceof Error ? reason.message : "Workspace creation failed"
            return Effect.fail(
              new ApiWorkspaceCreateError({
                name: "WorkspaceCreateError",
                data: { message },
              }),
            )
          }),
        )
    })

    const syncList = Effect.fn("WorkspaceHttpApi.syncList")(function* () {
      yield* workspace.syncList((yield* InstanceState.context).project)
    })

    const status = Effect.fn("WorkspaceHttpApi.status")(function* () {
      const ids = new Set((yield* workspace.list((yield* InstanceState.context).project)).map((item) => item.id))
      return (yield* workspace.status()).filter((item) => ids.has(item.workspaceID))
    })

    const remove = Effect.fn("WorkspaceHttpApi.remove")(function* (ctx: { params: { id: Workspace.Info["id"] } }) {
      return yield* workspace.remove(ctx.params.id)
    })

    const warpError = (reason: unknown) => {
      if (reason instanceof Workspace.WorkspaceNotFoundError) return notFound(reason.message)
      if (reason instanceof Vcs.PatchApplyError) {
        return new ApiVcsApplyError({
          name: "VcsApplyError",
          data: {
            message: reason.message,
            reason: reason.reason,
          },
        })
      }
      const message = reason instanceof Error ? reason.message : "Workspace warp failed"
      return new ApiWorkspaceWarpError({
        name: "WorkspaceWarpError",
        data: { message },
      })
    }

    // 与 create 同口径：warp 也可能因插件 throw 产生 defect，只 mapError 会把 defect 裸抛给框架。
    const warp = Effect.fn("WorkspaceHttpApi.warp")(function* (ctx: { payload: typeof WarpPayload.Type }) {
      yield* workspace
        .sessionWarp({
          workspaceID: ctx.payload.id,
          sessionID: ctx.payload.sessionID,
          copyChanges: ctx.payload.copyChanges,
        })
        .pipe(Effect.catchCause((cause) => Effect.fail(warpError(causeReason(cause)))))
    })

    return handlers
      .handle("adapters", adapters)
      .handle("list", list)
      .handle("create", create)
      .handle("syncList", syncList)
      .handle("status", status)
      .handle("remove", remove)
      .handle("warp", warp)
  }),
)
