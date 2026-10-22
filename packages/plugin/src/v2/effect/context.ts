import type { PluginOptions } from "../options.js"
import type { AgentHooks } from "./agent.js"
import type { AISDKHooks } from "./aisdk.js"
import type { CatalogHooks } from "./catalog.js"
import type { CommandHooks } from "./command.js"
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

export interface PluginContext {
  readonly options: PluginOptions
  readonly agent: AgentHooks & Reload
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks & Reload
  readonly command: CommandHooks & Reload
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

