import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("OPENNOVEL_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@opennovel/RuntimeFlags", {
  autoShare: bool("OPENNOVEL_AUTO_SHARE"),
  pure: bool("OPENNOVEL_PURE"),
  disableDefaultPlugins: bool("OPENNOVEL_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("OPENNOVEL_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("OPENNOVEL_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("OPENNOVEL_DISABLE_LSP_DOWNLOAD"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("OPENNOVEL_DISABLE_CLAUDE_CODE"),
    direct: bool("OPENNOVEL_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("OPENNOVEL_DISABLE_CLAUDE_CODE"),
    direct: bool("OPENNOVEL_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("OPENNOVEL_ENABLE_EXA"),
    legacy: bool("OPENNOVEL_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("OPENNOVEL_ENABLE_PARALLEL"),
    legacy: bool("OPENNOVEL_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("OPENNOVEL_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("OPENNOVEL_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("OPENNOVEL_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_PLAN_MODE"),
  experimentalCodeMode: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_CODE_MODE"),
  experimentalEventSystem: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("OPENNOVEL_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("OPENNOVEL_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("OPENNOVEL_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("OPENNOVEL_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("OPENNOVEL_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
