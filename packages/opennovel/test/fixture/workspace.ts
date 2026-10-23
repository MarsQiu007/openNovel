import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Database } from "@opennovel-ai/core/database/database"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionExecutionLocal } from "@opennovel-ai/core/session/execution/local"
import { Auth } from "../../src/auth"
import { Workspace } from "../../src/control-plane/workspace"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Vcs } from "../../src/project/vcs"
import { EventV2Bridge } from "../../src/event-v2-bridge"

export const workspaceLayerWithRuntimeFlags = (overrides: Partial<RuntimeFlags.Info>) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Workspace.node,
      Auth.node,
      SessionV2.node,
      Project.node,
      Vcs.node,
      Database.node,
      EventV2Bridge.node,
      FSUtil.node,
      InstanceStore.node,
    ]),
    [
      [SessionExecution.node, SessionExecutionLocal.node],
      [InstanceStore.bootstrapNode, InstanceBootstrap.node],
      [RuntimeFlags.node, RuntimeFlags.layer(overrides)],
    ],
  )
