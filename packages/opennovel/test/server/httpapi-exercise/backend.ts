import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { parse } from "./assertions"
import { runtime, type Runtime } from "./runtime"
import type { ActiveScenario, BackendApp, CallResult, CaptureMode, ScenarioContext, SeededContext, SessionInfo } from "./types"

type CallOptions = {
  auth?: {
    password?: string
    username?: string
  }
}

export function call(scenario: ActiveScenario, ctx: SeededContext<unknown>, options: CallOptions = {}) {
  return Effect.promise(async () =>
    capture(await app(await runtime(), options).request(toRequest(scenario, ctx)), scenario.capture),
  )
}

export function callAuthProbe(scenario: ActiveScenario, credentials: "missing" | "valid" = "missing") {
  return Effect.promise(async () => {
    const controller = new AbortController()
    return Promise.race([
      Promise.resolve(
        app(await runtime(), { auth: { password: "secret" } }).request(
          toAuthProbeRequest(scenario, credentials, controller.signal),
        ),
      ).then((response) => capture(response, scenario.capture)),
      Bun.sleep(1_000).then(() => {
        controller.abort("auth probe timed out")
        return {
          status: 0,
          contentType: "",
          text: "auth probe timed out",
          body: undefined,
          timedOut: true,
        }
      }),
    ])
  })
}

type CachedApp = BackendApp & { readonly dispose: () => Promise<void> }

const appCache: Partial<Record<string, CachedApp>> = {}

export async function disposeApps() {
  const apps = Object.values(appCache)
  for (const key of Object.keys(appCache)) delete appCache[key]
  // CI linux 曾出现 effect 进程 summary 打印后挂满 30 分钟 step 超时（coverage/auth
  // 进程同样走本函数却正常退出）。逐 app 打点定位挂点，60s 超时兜底保证进程能退出；
  // 挂点根因（web.dispose 内某 finalizer 不返回）另行排查。
  for (const app of apps) {
    if (!app) continue
    console.log(`[dispose] app start ${new Date().toISOString()}`)
    await Promise.race([
      app.dispose(),
      Bun.sleep(60_000).then(() => console.log(`[dispose] app timed out after 60s ${new Date().toISOString()}`)),
    ])
  }
  console.log(`[dispose] all apps done ${new Date().toISOString()}`)
}

function app(modules: Runtime, options: CallOptions) {
  const username = options.auth?.username
  const password = options.auth?.password
  const cacheKey = `${username ?? ""}:${password ?? ""}`
  if (appCache[cacheKey]) return appCache[cacheKey]

  const web = HttpRouter.toWebHandler(
    modules.HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ OPENNOVEL_SERVER_PASSWORD: password, OPENNOVEL_SERVER_USERNAME: username }),
        ),
      ),
    ),
    { disableLogger: true, memoMap: Layer.makeMemoMapUnsafe() },
  )
  return (appCache[cacheKey] = {
    dispose: web.dispose,
    request(input: string | URL | Request, init?: RequestInit) {
      return web.handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        modules.HttpApiApp.context,
      )
    },
  })
}


// V2 会话种子走 HTTP 面：与场景后续请求命中同一个 SessionV2 实例（AppLayer 不再托管会话服务）。
export function seedSession(ctx: ScenarioContext, input?: { title?: string; parentID?: string }) {
  return Effect.promise(async () => {
    const response = await app(await runtime(), {}).request(
      new Request(new URL("/api/session", "http://localhost"), {
        method: "POST",
        headers: { "content-type": "application/json", ...ctx.headers() },
        body: JSON.stringify({
          ...(input?.title === undefined ? {} : { title: input.title }),
          ...(input?.parentID === undefined ? {} : { parentID: input.parentID }),
        }),
      }),
    )
    if (response.status !== 200) throw new Error(`session seed failed with status ${response.status}`)
    const body = (await response.json()) as { data: SessionInfo }
    return body.data
  })
}

function toRequest(scenario: ActiveScenario, ctx: SeededContext<unknown>) {
  const spec = scenario.request(ctx, ctx.state)
  return new Request(new URL(spec.path, "http://localhost"), {
    method: scenario.method,
    headers: spec.body === undefined ? spec.headers : { "content-type": "application/json", ...spec.headers },
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
  })
}

function toAuthProbeRequest(scenario: ActiveScenario, credentials: "missing" | "valid", signal: AbortSignal) {
  const spec = scenario.authProbe ?? {
    path: authProbePath(scenario.path),
    body: scenario.method === "GET" ? undefined : {},
  }
  const headers = {
    ...(spec.body === undefined ? {} : { "content-type": "application/json" }),
    ...spec.headers,
    ...(credentials === "valid" ? { authorization: basic("opennovel", "secret") } : {}),
  }
  return new Request(new URL(spec.path, "http://localhost"), {
    method: scenario.method,
    headers,
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
    signal,
  })
}

function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function authProbePath(path: string) {
  return path
    .replace(/\{([^}]+)\}/g, (_match, key: string) => `auth_${key}`)
    .replace(/:([^/]+)/g, (_match, key: string) => `auth_${key}`)
}

async function capture(response: Response, mode: CaptureMode): Promise<CallResult> {
  const text = mode === "stream" ? await captureStream(response) : await response.text()
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    body: parse(text),
    timedOut: false,
  }
}

async function captureStream(response: Response) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const read = reader.read().then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  )
  const winner = await Promise.race([read, Bun.sleep(1_000).then(() => ({ timeout: true }))])
  if ("timeout" in winner) {
    await reader.cancel("timed out waiting for stream chunk").catch(() => undefined)
    throw new Error("timed out waiting for stream chunk")
  }
  if ("error" in winner) throw winner.error
  await reader.cancel().catch(() => undefined)
  if (winner.result.done) return ""
  return new TextDecoder().decode(winner.result.value)
}
