import type { AgentV2Info, CommandV2Info, Project, ProviderListResponse } from "@opennovel-ai/sdk/v2/client"
import { NormalizedProviderListResponse } from "@opennovel-ai/session-ui/context"
export { pathKey as directoryKey, type PathKey as DirectoryKey } from "@/utils/path-key"

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// V2 面适配：/api/agent 的 AgentV2Info（id 命名、permissions 为 V2 规则集）与
// /api/command 的 CommandV2Info 映射为应用消费的最小形状；legacy /agent、/command
// 端点已裁撤（PermissionV1 内嵌无法保留 legacy wire）。
export type Agent = {
  name: string
  description?: string
  mode: AgentV2Info["mode"]
  hidden?: boolean
  color?: AgentV2Info["color"]
  category?: AgentV2Info["category"]
  model?: { providerID: string; modelID: string }
  variant?: string
}

export type Command = {
  name: string
  description?: string
  template: string
  agent?: string
  subtask?: boolean
}

export function mapAgent(info: AgentV2Info): Agent {
  return {
    name: info.id,
    mode: info.mode,
    hidden: info.hidden,
    ...(info.description === undefined ? {} : { description: info.description }),
    ...(info.color === undefined ? {} : { color: info.color }),
    ...(info.category === undefined ? {} : { category: info.category }),
    ...(info.model === undefined
      ? {}
      : {
          model: { providerID: info.model.providerID, modelID: info.model.id },
          ...(info.model.variant === undefined ? {} : { variant: info.model.variant }),
        }),
  }
}

export function mapCommand(info: CommandV2Info): Command {
  return {
    name: info.name,
    template: info.template,
    ...(info.description === undefined ? {} : { description: info.description }),
    ...(info.agent === undefined ? {} : { agent: info.agent }),
    ...(info.subtask === undefined ? {} : { subtask: info.subtask }),
  }
}

export function normalizeProviderList(input: ProviderListResponse): NormalizedProviderListResponse {
  return {
    ...input,
    all: new Map(
      input.all.map(
        (provider) =>
          [
            provider.id,
            {
              ...provider,
              models: Object.fromEntries(
                Object.entries(provider.models).filter(([, info]) => info.status !== "deprecated"),
              ),
            },
          ] as const,
      ),
    ),
  }
}

export function sanitizeProject(project: Project) {
  if (!project.icon?.url && !project.icon?.override) return project
  return {
    ...project,
    icon: {
      ...project.icon,
      url: undefined,
      override: undefined,
    },
  }
}
