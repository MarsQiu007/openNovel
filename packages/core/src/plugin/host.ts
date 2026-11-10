export * as PluginHost from "./host"

import type {
  AnyToolSpec,
  AskInput,
  BackgroundSessionAuthorization,
  ConfirmRetestInput,
  PluginContext as Interface,
  SystemContextSource,
  ToolEditor,
} from "@opennovel-ai/plugin/v2/effect"
import { ToolResult } from "@opennovel-ai/plugin/v2/effect"
import { Definitions } from "@opennovel-ai/schema/session-event"
import { Effect, Exit, Option, Schema, Scope, Stream } from "effect"
import { AgentV2 } from "../agent"
import { AISDK } from "../aisdk"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Credential } from "../credential"
import { EventV2 } from "../event"
import { Global } from "../global"
import { Integration } from "../integration"
import { Location } from "../location"
import { LocationServiceMap } from "../location-service-map"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { PluginV2 } from "../plugin"
import { PluginFile } from "./file"
import { QuestionV2 } from "../question"
import { RetestAuthorization } from "./retest-authorization"
import { PluginSession } from "./session"
import { SessionPurpose } from "./session-purpose"
import { ProviderV2 } from "../provider"
import { Reference } from "../reference"
import type { DeepMutable } from "../schema"
import { SessionExecution } from "../session/execution"
import { SessionSchema } from "../session/schema"
import { SessionStore } from "../session/store"
import { SessionV2 } from "../session"
import { SkillV2 } from "../skill"
import { SystemContext } from "../system-context/index"
import { SystemContextRegistry } from "../system-context/registry"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"

const mutable = <T>(value: T) => value as DeepMutable<T>

// 插件回调传入的 source/method 来自插件侧（未受信）：解码失败时抛出点名标签的错误，
// 而不是让裸 SchemaError 以 defect 形式冲击 reload 管线。
function decodeHostValue<S extends Schema.Decoder<unknown>>(label: string, schema: S, value: unknown) {
  const decoded = Schema.decodeUnknownOption(schema)(value)
  if (Option.isSome(decoded)) return decoded.value
  throw new Error(`Plugin host received an invalid ${label}`)
}

export const make = Effect.fn("PluginHost.make")(function* (plugin: PluginV2.Interface) {
  const agents = yield* AgentV2.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* CommandV2.Service
  const globalPaths = yield* Global.Service
  const integration = yield* Integration.Service
  const location = yield* Location.Service
  const permission = yield* PermissionV2.Service
  const events = yield* EventV2.Service
  const reference = yield* Reference.Service
  const sessions = yield* SessionStore.Service
  const skill = yield* SkillV2.Service
  // SessionV2 运行栈惰性绑定：宿主图经 PluginV2.node 依赖声明送达（见 serve 组合根
  // AppNodeBuilderV1.build 的 SessionExecution 绑定）；仅装配 recording 层的测试环境
  // 保持原 R 不变，后台能力以 fail-closed 拒绝，不静默绕过
  const sessionV2 = yield* Effect.serviceOption(SessionV2.Service)
  const execution = yield* Effect.serviceOption(SessionExecution.Service)
  const locations = yield* Effect.serviceOption(LocationServiceMap.Service)
  // 降级原因透出缺失服务：端上走查见到拒绝文本即可定位组合根断裂点
  const runtimeMissing = Option.isNone(sessionV2)
    ? "SessionV2"
    : Option.isNone(execution)
      ? "SessionExecution"
      : Option.isNone(locations)
        ? "LocationServiceMap"
        : undefined
  // 复测确认走原会话的 QuestionV2：仅装配了 Question 层的环境注入 confirm，
  // 降级环境（recording 层测试）不注入，插件侧 confirm 为 undefined
  const questions = yield* Effect.serviceOption(QuestionV2.Service)
  const sessionFull =
    Option.isSome(sessionV2) && Option.isSome(execution) && Option.isSome(locations)
      ? yield* PluginSession.make({
          sessions: sessionV2.value,
          execution: execution.value,
          pluginID: "host",
          withinLocation: PluginSession.withinLocationFrom(locations.value),
        })
      : undefined
  const systemContexts = yield* SystemContextRegistry.Service
  const tools = yield* Tools.Service

  const askPermission = (input: AskInput, context: Tool.Context) =>
    permission
      .assert({
        sessionID: context.sessionID,
        action: input.permission,
        resources: [...input.patterns],
        save: [...input.always],
        metadata: input.metadata,
        source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        agent: context.agent,
      })
      .pipe(
        Effect.catchTag("PermissionV2.CorrectedError", (error) => Effect.fail(new Error(error.feedback))),
        Effect.catchTag("Session.NotFoundError", () => Effect.fail(new Error("Session not found"))),
      )

  const CONFIRM_APPROVE_LABEL = "执行复测"
  const CONFIRM_CANCEL_LABEL = "取消"

  /**
   * 系统复测确认（任务 5.2）：经 QuestionV2.ask 在原会话展示问题、运行次数、修复
   * 版本与案例摘要，只提供执行/取消两个选项且不保存 always 权限。入参非法（次数
   * 非 1–20 整数、修复版本或摘要为空、白名单为空）不弹确认直接拒绝；用户确认后
   * 签发随机执行授权并登记绑定，取消/拒绝/未装配 Question 层返回 undefined。
   */
  const confirmRetest = (input: ConfirmRetestInput, context: Tool.Context): Promise<BackgroundSessionAuthorization | undefined> =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (!RetestAuthorization.validateConfirmInput(input)) return undefined
        const questionService = Option.getOrUndefined(questions)
        if (questionService === undefined) return undefined
        const answers = yield* questionService
          .ask({
            sessionID: SessionSchema.ID.make(context.sessionID),
            questions: [
              {
                question: `${input.question}（运行 ${input.runs} 次，修复版本 ${input.fixVersion}，案例摘要 ${input.caseDigest.slice(0, 12)}…）`,
                header: "隔离复测确认",
                options: [
                  { label: CONFIRM_APPROVE_LABEL, description: `在隔离临时项目中执行 ${input.expectedTools.join("、")}，共 ${input.runs} 次` },
                  { label: CONFIRM_CANCEL_LABEL, description: "不执行，本次复测取消" },
                ],
                custom: false,
              },
            ],
            tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
          })
          .pipe(Effect.catchTag("QuestionV2.RejectedError", () => Effect.succeed(undefined)))
        const approved = answers !== undefined && answers[0]?.includes(CONFIRM_APPROVE_LABEL)
        if (!approved) return undefined
        const issued = RetestAuthorization.issue({
          sessionID: context.sessionID,
          caseDigest: input.caseDigest,
          runs: input.runs,
          model: input.model,
          expectedTools: [...input.expectedTools],
        })
        return { id: issued.id, caseDigest: issued.caseDigest }
      }),
    )

  const wrapTool = (spec: AnyToolSpec) => {
    const tool = Tool.make({
      description: spec.description,
      input: spec.args,
      output: ToolResult,
      execute: (input, context) =>
        Effect.tryPromise({
          try: () =>
            spec.execute(input, {
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.assistantMessageID,
              directory: location.directory,
              ask: (ask) => Effect.runPromise(askPermission(ask, context)),
              ...(Option.isSome(questions)
                ? { confirm: (confirm) => confirmRetest(confirm, context) }
                : {}),
            }),
          catch: (cause) => new Tool.Failure({ message: cause instanceof Error ? cause.message : String(cause) }),
        }),
      toModelOutput: ({ output }) => [{ type: "text" as const, text: typeof output === "string" ? output : output.output }],
    })
    return spec.permission ? Tool.withPermission(tool, spec.permission) : tool
  }

  const registerSource = (source: SystemContextSource<any>) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const key = SystemContext.Key.make(source.key)
        const context = SystemContext.make({
          key,
          codec: source.codec,
          load: Effect.flatMap(SystemContext.CurrentSessionID, (sessionID) =>
            source.load({ sessionID: Option.getOrUndefined(sessionID) }),
          ).pipe(Effect.map(Option.getOrElse(() => SystemContext.unavailable))),
          baseline: source.baseline,
          update: source.update,
          ...(source.removed ? { removed: source.removed } : {}),
        })
        // 与 tool transform 同款子 scope：dispose 只摘除本次注册的源
        const scope = yield* Scope.Scope
        const child = yield* Scope.fork(scope)
        yield* systemContexts.register({ key, load: Effect.succeed(context) }).pipe(Scope.provide(child))
        let active = true
        const dispose = Effect.uninterruptible(
          Effect.suspend(() => {
            if (!active) return Effect.void
            active = false
            return Scope.close(child, Exit.void)
          }),
        )
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      }),
    )

  // V2 插件面事件订阅的宿主侧适配（v2/effect PLAN.md §8）：公开类型字符串 → schema Definition，
  // 委托 EventV2.Service.subscribe；SDK 公开形状以 properties 承载 data，此处做字段搬运。
  // 内部会话的事件经进程级 purpose 注册表在信封上回填标记；普通会话事件形状不变。
  const sessionEventByType: Map<string, EventV2.Definition> = new Map(
    Definitions.map((definition) => [definition.type, definition]),
  )
  const event: Interface["event"] = {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 泛型 Type→EventMap[Type] 映射只能经单次断言落地（类型字符串查表擦除了索引关联）
    subscribe: ((type: string) => {
      const definition = sessionEventByType.get(type)
      if (!definition) return Stream.fail(new Error(`PluginHost: unsupported event type "${type}"`))
      return events.subscribe(definition).pipe(
        Stream.map((payload) => {
          // 宿主信封在公开类型外携带 sessionID：Reflect.get 安全读取，无需断言
          const rawSessionID = typeof payload.data === "object" && payload.data !== null ? Reflect.get(payload.data, "sessionID") : undefined
          const sessionID = typeof rawSessionID === "string" ? rawSessionID : undefined
          const purpose = sessionID === undefined ? undefined : SessionPurpose.lookup(sessionID)
          const base = { id: payload.id, type: payload.type, properties: payload.data }
          return purpose === undefined ? base : { ...base, purpose }
        }),
      )
    }) as Interface["event"]["subscribe"],
  }

  const degraded = PluginSession.unavailable(runtimeMissing)
  return {
    options: {},
    event,
    file: PluginFile.makeFileDomain(),
    location: {
      directory: location.directory,
      project: { directory: location.project.directory },
    },
    paths: {
      home: globalPaths.home,
      data: globalPaths.data,
      cache: globalPaths.cache,
      config: globalPaths.config,
      state: globalPaths.state,
      tmp: globalPaths.tmp,
    },
    session:
      sessionFull ??
      {
        // 降级 get：仅装配 recording 层时以 SessionStore 兜底（不含 purpose 回填，链读取同语义）
        get: (id) =>
          Effect.runPromise(
            sessions.get(SessionSchema.ID.make(id)).pipe(
              Effect.map((info) =>
                info === undefined
                  ? undefined
                  : {
                      id: info.id as string,
                      parentID: info.parentID as string | undefined,
                      location: info.location.directory,
                    },
              ),
            ),
          ),
        settled: degraded.settled,
        startBackground: degraded.startBackground,
      },
    systemContext: {
      register: registerSource,
    },
    tool: {
      transform: (callback) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const staged = new Map<string, AnyToolSpec>()
            const editor: ToolEditor = {
              list: () => Array.from(staged.keys()),
              get: (name) => staged.get(name),
              add: (name, spec) => {
                Effect.runSync(Tool.validateName(name))
                staged.set(name, spec)
              },
              update: (name, spec) => {
                if (!staged.has(name)) return
                staged.set(name, spec)
              },
              remove: (name) => {
                staged.delete(name)
              },
            }
            yield* Effect.suspend(() => {
              const result = callback(editor)
              return Effect.isEffect(result) ? Effect.asVoid(result).pipe(Effect.orDie) : Effect.void
            })
            // 独立子 scope 承接整批注册：dispose 只摘除本次 transform 的工具，
            // 露出注册表里的上一个同名注册（registry overlay 语义）。
            const scope = yield* Scope.Scope
            const child = yield* Scope.fork(scope)
            yield* tools
              .register(Object.fromEntries(Array.from(staged, ([name, spec]) => [name, wrapTool(spec)])))
              .pipe(Effect.orDie, Scope.provide(child))
            let active = true
            const dispose = Effect.uninterruptible(
              Effect.suspend(() => {
                if (!active) return Effect.void
                active = false
                return Scope.close(child, Exit.void)
              }),
            )
            yield* Scope.addFinalizer(scope, dispose)
            return { dispose }
          }),
        ),
    },
    agent: {
      reload: agents.reload,
      transform: (callback) =>
        agents.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(AgentV2.ID.make(id))),
            default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
            update: (id, update) => draft.update(AgentV2.ID.make(id), update),
            remove: (id) => draft.remove(AgentV2.ID.make(id)),
          }),
        ),
    },
    aisdk: {
      sdk: (callback) =>
        aisdk.hook.sdk((event) => {
          const output = {
            model: mutable(event.model),
            package: event.package,
            options: event.options,
            sdk: event.sdk,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
          )
        }),
      language: (callback) =>
        aisdk.hook.language((event) => {
          const output = {
            model: mutable(event.model),
            sdk: event.sdk,
            options: event.options,
            language: event.language,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        }),
    },
    catalog: {
      reload: catalog.reload,
      // 复测案例准备需在用户确认前解析模型（案例摘要覆盖模型提供方/模型）：
      // 只读当前目录默认模型标识，未配置返回 undefined；可用性校验由 startBackground
      // 预检统一失败关闭
      defaultModel: () =>
        Effect.runPromise(
          catalog.model.default().pipe(
            Effect.map((info) => (info === undefined ? undefined : { providerID: info.providerID, modelID: info.id })),
          ),
        ),
      transform: (callback) =>
        catalog.transform((draft) =>
          callback({
            provider: {
              list: () => mutable(draft.provider.list()),
              get: (id) => mutable(draft.provider.get(ProviderV2.ID.make(id))),
              update: (id, update) => draft.provider.update(ProviderV2.ID.make(id), update),
              remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) =>
                mutable(draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))),
              update: (providerID, modelID, update) =>
                draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), update),
              remove: (providerID, modelID) =>
                draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              },
            },
          }),
        ),
    },
    command: {
      reload: commands.reload,
      transform: commands.transform,
    },
    integration: {
      reload: integration.reload,
      connection: {
        active: (id) => integration.connection.active(Integration.ID.make(id)),
        resolve: (connection) =>
          integration.connection.resolve(
            connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
          ),
      },
      transform: (callback) =>
        integration.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(Integration.ID.make(id))),
            update: (id, update) => draft.update(Integration.ID.make(id), update),
            remove: (id) => draft.remove(Integration.ID.make(id)),
            method: {
              list: (id) => mutable(draft.method.list(Integration.ID.make(id))),
              update: (input) => {
                if ("authorize" in input) {
                  const methodID = Integration.MethodID.make(input.method.id)
                  const refresh = input.refresh
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { ...input.method, id: methodID },
                    authorize: (inputs) =>
                      input.authorize(inputs).pipe(
                        Effect.map((authorization) => {
                          if (authorization.mode === "auto") {
                            return {
                              ...authorization,
                              callback: authorization.callback.pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                            }
                          }
                          return {
                            ...authorization,
                            callback: (code: string) =>
                              authorization.callback(code).pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                          }
                        }),
                      ),
                    ...(refresh
                      ? {
                          refresh: (value: Credential.OAuth) =>
                            refresh(value).pipe(
                              Effect.map((next) =>
                                Credential.OAuth.make({
                                  ...next,
                                  methodID: Integration.MethodID.make(next.methodID),
                                }),
                              ),
                            ),
                        }
                      : {}),
                    ...(input.label ? { label: input.label } : {}),
                  })
                  return
                }
                if (input.method.type === "env") {
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { type: "env", names: input.method.names },
                  })
                  return
                }
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { type: "key", label: input.method.label },
                })
              },
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), decodeHostValue("integration method", Integration.Method, method)),
            },
          }),
        ),
    },
    plugin: {
      add: (input) => plugin.add(PluginV2.ID.make(input.id), input.effect),
      remove: (id) => plugin.remove(PluginV2.ID.make(id)),
    },
    reference: {
      reload: reference.reload,
      transform: (callback) =>
        reference.transform((draft) =>
          callback({
            add: (name, source) => draft.add(name, decodeHostValue("reference source", Reference.Source, source)),
            remove: draft.remove,
            list: draft.list,
          }),
        ),
    },
    skill: {
      reload: skill.reload,
      transform: (callback) =>
        skill.transform((draft) =>
          callback({
            source: (source) => draft.source(decodeHostValue("skill source", SkillV2.Source, source)),
            list: draft.list,
          }),
        ),
    },
  } satisfies Interface
})
