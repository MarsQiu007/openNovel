import { Flag } from "@opennovel-ai/core/flag/flag"
import { Cause, Duration, Effect, Layer, Scope } from "effect"
import { call, callAuthProbe, seedSession } from "./backend"
import { original } from "./environment"
import { resetExerciseDatabase } from "./reset"
import { runtime } from "./runtime"
import type { ActiveScenario, Options, Result, Scenario, ScenarioContext, SeededContext } from "./types"

export function runScenario(options: Options) {
  return (scenario: Scenario) => {
    if (scenario.kind === "todo") return Effect.succeed({ status: "skip", scenario } as Result)
    return runActive(options, scenario).pipe(
      Effect.timeoutOrElse({
        duration: options.scenarioTimeout,
        orElse: () => Effect.die(new Error(`scenario timed out after ${Duration.format(options.scenarioTimeout)}`)),
      }),
      Effect.as({ status: "pass", scenario } as Result),
      Effect.catchCause((cause) => Effect.succeed({ status: "fail" as const, scenario, message: Cause.pretty(cause) })),
      Effect.scoped,
      Effect.flatMap((result) =>
        scenario.reset && options.mode !== "auth"
          ? resetState.pipe(
              Effect.as(result),
              Effect.catchCause((cause) =>
                Effect.succeed({
                  status: "fail" as const,
                  scenario,
                  message: `exercise reset failed: ${Cause.pretty(cause)}`,
                }),
              ),
            )
          : Effect.succeed(result),
      ),
    )
  }
}

function runActive(options: Options, scenario: ActiveScenario) {
  if (options.mode === "auth") return runAuth(scenario)

  return withContext(options, scenario, "shared", (ctx) =>
    Effect.gen(function* () {
      yield* trace(options, scenario, "request start")
      const result = yield* call(scenario, ctx)
      yield* trace(options, scenario, `response ${result.status}`)
      yield* trace(options, scenario, "expect start")
      yield* scenario.expect(ctx, ctx.state, result)
      yield* trace(options, scenario, "expect done")
    }),
  )
}

function runAuth(scenario: ActiveScenario) {
  return Effect.gen(function* () {
    const result = yield* callAuthProbe(scenario, "missing")
    if (scenario.auth === "protected") {
      if (result.status !== 401) throw new Error(`auth expected 401, got ${result.status}`)
      const authed = yield* callAuthProbe(scenario, "valid")
      if (authed.status === 401) throw new Error("auth rejected valid credentials")
      return
    }

    if (result.status === 401) throw new Error("auth expected public access, got 401")
    if (result.timedOut) throw new Error("auth expected public access, probe timed out")
  })
}

function withContext<A, E>(
  options: Options,
  scenario: ActiveScenario,
  label: string,
  use: (ctx: SeededContext<unknown>) => Effect.Effect<A, E>,
) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      yield* trace(options, scenario, `${label} context acquire start`)
      const project = scenario.project
      const dir = project
        ? yield* Effect.promise(async () =>
            (await runtime()).tmpdir({ git: project.git, config: project.config }),
          )
        : undefined
      yield* trace(options, scenario, `${label} context acquire done`)
      return { dir }
    }),
    (ctx) =>
      Effect.gen(function* () {
        yield* trace(options, scenario, `${label} tmpdir cleanup start`)
        yield* Effect.promise(async () => {
          await ctx.dir?.[Symbol.asyncDispose]()
        }).pipe(Effect.ignore)
        yield* trace(options, scenario, `${label} tmpdir cleanup done`)
      }),
  ).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        yield* trace(options, scenario, `${label} runtime start`)
        const modules = yield* Effect.promise(() => runtime())
        const scope = yield* Scope.Scope
        // 每场景在独立 scope 上全新构建 AppLayer，并配独立 MemoMap：AppLayer 是模块级
        // 单例，上一场景 scope 关闭后其层实例已 dispose，共享 MemoMap 会让本次构建命中
        // 死实例（服务指向已关闭的资源）。
        const app = yield* Layer.buildWithMemoMap(modules.AppLayer, Layer.makeMemoMapUnsafe(), scope)
        yield* trace(options, scenario, `${label} runtime done`)
        const path = context.dir?.path
        const instance = path
          ? yield* trace(options, scenario, `${label} instance load start`).pipe(
              Effect.andThen(
                modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
                  Effect.provide(app),
                  Effect.catchCause((cause) =>
                    Effect.sleep("100 millis").pipe(
                      Effect.andThen(
                        modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
                          Effect.provide(app),
                        ),
                      ),
                      Effect.catchCause(() => Effect.failCause(cause)),
                    ),
                  ),
                ),
              ),
              Effect.tap(() => trace(options, scenario, `${label} instance load done`)),
            )
          : undefined
        const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(Effect.provideService(modules.InstanceRef, instance), Effect.provide(app))
        const directory = () => {
          if (!context.dir?.path) throw new Error("scenario needs a project directory")
          return context.dir.path
        }
        const base: ScenarioContext = {
          directory: context.dir?.path,
          headers: (extra) => ({
            ...(context.dir?.path ? { "x-opennovel-directory": context.dir.path } : {}),
            ...extra,
          }),
          file: (name, content) =>
            Effect.promise(() => {
              return Bun.write(`${directory()}/${name}`, content)
            }).pipe(Effect.asVoid),
          session: (input) => seedSession(base, input),
          project: () =>
            Effect.sync(() => {
              if (!instance) throw new Error("scenario needs a project directory")
              return instance.project
            }),
          worktree: (input) => run(modules.Worktree.Service.use((svc) => svc.create(input).pipe(Effect.orDie))),
          worktreeRemove: (directory) =>
            run(modules.Worktree.Service.use((svc) => svc.remove({ directory })).pipe(Effect.ignore)),
        }
        yield* trace(options, scenario, `${label} seed start`)
        const state = yield* scenario.seed(base)
        yield* trace(options, scenario, `${label} seed done`)
        yield* trace(options, scenario, `${label} use start`)
        const result = yield* use({ ...base, state })
        yield* trace(options, scenario, `${label} use done`)
        return result
      }),
    ),
  )
}

function trace(options: Options, scenario: ActiveScenario, phase: string) {
  return Effect.sync(() => {
    if (!options.trace) return
    console.log(`[trace] ${scenario.name}: ${phase}`)
  })
}

const resetState = Effect.promise(async () => {
  Flag.OPENNOVEL_SERVER_PASSWORD = original.OPENNOVEL_SERVER_PASSWORD
  Flag.OPENNOVEL_SERVER_USERNAME = original.OPENNOVEL_SERVER_USERNAME
  await resetExerciseDatabase()
})
