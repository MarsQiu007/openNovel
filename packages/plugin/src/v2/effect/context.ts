import type { PluginOptions } from "../options.js"
import type { AgentHooks } from "./agent.js"
import type { AISDKHooks } from "./aisdk.js"
import type { CatalogHooks } from "./catalog.js"
import type { CommandHooks } from "./command.js"
import type { Event } from "./event.js"
import type { FileDomain } from "./file.js"
import type { IntegrationHooks } from "./integration.js"
import type { Location } from "./location.js"
import type { Path } from "./path.js"
import type { PluginDomain } from "./plugin.js"
import type { ReferenceHooks } from "./reference.js"
import type { SessionDomain } from "./session.js"
import type { SkillHooks } from "./skill.js"
import type { SystemContextDomain } from "./system-context.js"
import type { ToolHooks } from "./tool.js"
import type { Reload } from "./registration.js"

/**
 * 目录默认模型只读面：复测案例准备必须在用户确认前解析模型（案例摘要覆盖模型
 * 提供方/模型）。只暴露标识读取，不暴露目录改写。
 */
export interface CatalogModelReader {
  readonly defaultModel: () => Promise<{ readonly providerID: string; readonly modelID: string } | undefined>
}

export interface PluginContext {
  readonly options: PluginOptions
  readonly agent: AgentHooks & Reload
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks & Reload & CatalogModelReader
  readonly command: CommandHooks & Reload
  readonly event: Event
  readonly file: FileDomain
  readonly integration: IntegrationHooks & Reload
  readonly location: Location
  readonly paths: Path
  readonly plugin: PluginDomain
  readonly reference: ReferenceHooks & Reload
  readonly session: SessionDomain
  readonly skill: SkillHooks & Reload
  readonly systemContext: SystemContextDomain
  readonly tool: ToolHooks
}

