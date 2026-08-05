import { AgentV2 } from "@opennovel-ai/core/agent"
import { AISDK } from "@opennovel-ai/core/aisdk"
import { Catalog } from "@opennovel-ai/core/catalog"
import { CommandV2 } from "@opennovel-ai/core/command"
import { Credential } from "@opennovel-ai/core/credential"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opennovel-ai/core/effect/app-node-platform"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { FileSystem } from "@opennovel-ai/core/filesystem"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { Integration } from "@opennovel-ai/core/integration"
import { Location } from "@opennovel-ai/core/location"
import { Npm } from "@opennovel-ai/core/npm"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { Reference } from "@opennovel-ai/core/reference"
import { SkillV2 } from "@opennovel-ai/core/skill"
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
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
