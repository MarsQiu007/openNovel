import { AgentV2 } from "@opennovel-ai/core/agent"
import { AISDK } from "@opennovel-ai/core/aisdk"
import { Catalog } from "@opennovel-ai/core/catalog"
import { CommandV2 } from "@opennovel-ai/core/command"
import { Config } from "@opennovel-ai/core/config"
import { Credential } from "@opennovel-ai/core/credential"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opennovel-ai/core/effect/app-node-platform"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { FileSystem } from "@opennovel-ai/core/filesystem"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { Global } from "@opennovel-ai/core/global"
import { Integration } from "@opennovel-ai/core/integration"
import { Location } from "@opennovel-ai/core/location"
import { Npm } from "@opennovel-ai/core/npm"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { PermissionSaved } from "@opennovel-ai/core/permission/saved"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { Policy } from "@opennovel-ai/core/policy"
import { Reference } from "@opennovel-ai/core/reference"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { SkillV2 } from "@opennovel-ai/core/skill"
import { SystemContextRegistry } from "@opennovel-ai/core/system-context/registry"
import { ApplicationTools } from "@opennovel-ai/core/tool/application-tools"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { ToolOutputStore } from "@opennovel-ai/core/tool-output-store"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    Database.node,
    EventV2.node,
    Global.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    ApplicationTools.node,
    Catalog.node,
    CommandV2.node,
    Config.node,
    Integration.node,
    PermissionSaved.node,
    PermissionV2.node,
    Policy.node,
    Reference.node,
    SessionStore.node,
    SkillV2.node,
    SystemContextRegistry.node,
    ToolOutputStore.node,
    ToolRegistry.node,
    ToolRegistry.toolsNode,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
