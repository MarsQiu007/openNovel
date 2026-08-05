import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@opennovel-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~opennovel/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~opennovel/WorkspaceRef", {
  defaultValue: () => undefined,
})
