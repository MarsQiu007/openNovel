import { Layer, ManagedRuntime } from "effect"
import { attach } from "./run-service"
import * as Observability from "@opennovel-ai/core/observability"

import { FSUtil } from "@opennovel-ai/core/fs-util"
import { Database } from "@opennovel-ai/core/database/database"
import { Auth } from "@/auth"
import { Account } from "@/account/account"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { Ripgrep } from "@opennovel-ai/core/ripgrep"
import { Storage } from "@/storage/storage"
import { Snapshot } from "@/snapshot"
import { Plugin } from "@/plugin"
import { ModelsDev } from "@opennovel-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { ProviderAuth } from "@/provider/auth"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Format } from "@/format"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { Worktree } from "@/worktree"
import { Installation } from "@/installation"
import { Npm } from "@opennovel-ai/core/npm"
import { memoMap } from "@opennovel-ai/core/effect/memo-map"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { AppNodeBuilderV1 } from "./app-node-builder-v1"
import { GlobalEventBridge } from "@/effect/global-event-bridge"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { V1Migration } from "@opennovel-ai/core/session/v1-migration"

export const AppLayer = AppNodeBuilderV1.build(
  LayerNode.group([
    Npm.node,
    FSUtil.node,
    Database.node,
    V1Migration.node,
    Auth.node,
    Account.node,
    Config.node,
    Git.node,
    Storage.node,
    Snapshot.node,
    Plugin.node,
    ModelsDev.node,
    Provider.node,
    ProviderAuth.node,
    Skill.node,
    Discovery.node,
    SessionProjector.node,
    GlobalEventBridge.node,
    RuntimeFlags.node,
    LSP.node,
    MCP.node,
    McpAuth.node,
    Format.node,
    InstanceStore.node,
    Project.node,
    Vcs.node,
    Worktree.node,
    Installation.node,
  ]),
).pipe(Layer.provideMerge(AppNodeBuilderV1.build(Ripgrep.node)), Layer.provideMerge(Observability.layer))

const rt = ManagedRuntime.make(AppLayer, { memoMap })
type Runtime = Pick<typeof rt, "runSync" | "runPromise" | "runPromiseExit" | "runFork" | "runCallback" | "dispose">

/** Services provided by AppRuntime — i.e. what an Effect run via AppRuntime.runPromise can yield. */
export type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof rt>
const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never

export const AppRuntime: Runtime = {
  runSync(effect) {
    return rt.runSync(wrap(effect))
  },
  runPromise(effect, options) {
    return rt.runPromise(wrap(effect), options)
  },
  runPromiseExit(effect, options) {
    return rt.runPromiseExit(wrap(effect), options)
  },
  runFork(effect) {
    return rt.runFork(wrap(effect))
  },
  runCallback(effect) {
    return rt.runCallback(wrap(effect))
  },
  dispose: () => rt.dispose(),
}
