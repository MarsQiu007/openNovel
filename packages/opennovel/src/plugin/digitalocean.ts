import type { Hooks, PluginInput } from "@opennovel-ai/plugin"
import type { Model } from "@opennovel-ai/sdk/v2"
import { InstallationVersion } from "@opennovel-ai/core/installation/version"
import { OauthCallbackPage } from "@opennovel-ai/core/oauth/page"
import { createServer } from "http"
import open from "open"

const DO_OAUTH_CLIENT_ID = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82"
const DO_AUTHORIZE_URL = "https://cloud.digitalocean.com/v1/oauth/authorize"
const DO_API_BASE = "https://api.digitalocean.com"
const DO_GENAI_API = `${DO_API_BASE}/v2/gen-ai`
const DO_INFERENCE_BASE = "https://inference.do-ai.run/v1"
const OAUTH_PORT = 1456
const OAUTH_REDIRECT_PATH = "/auth/callback"
const OAUTH_TOKEN_PATH = "/auth/token"
const ROUTER_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const OAUTH_SCOPES = "genai:read inference:query"

interface ImplicitTokenPayload {
  access_token: string
  expires_in: number
  state: string
}

interface PendingOAuth {
  state: string
  resolve: (tokens: ImplicitTokenPayload) => void
  reject: (error: Error) => void
}

interface RouterEntry {
  name: string
  uuid?: string
  description?: string
}

let oauthServer: ReturnType<typeof createServer> | undefined
// 并发授权按 state 各自登记，避免后发起者覆盖前一个流程的 callback
const pendingOAuth = new Map<string, PendingOAuth>()

function takePending(state: string | undefined | null): PendingOAuth | undefined {
  if (!state) return undefined
  const pending = pendingOAuth.get(state)
  if (pending) pendingOAuth.delete(state)
  return pending
}

function failAllPending(message: string) {
  const others = [...pendingOAuth.values()]
  pendingOAuth.clear()
  for (const pending of others) pending.reject(new Error(message))
}

function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function redirectUri(): string {
  return `http://localhost:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`
}

function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "token",
    client_id: DO_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPES,
    state,
  })
  return `${DO_AUTHORIZE_URL}?${params.toString()}`
}

async function startOAuthServer(): Promise<void> {
  if (oauthServer) return
  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`)

    if (req.method === "GET" && url.pathname === OAUTH_REDIRECT_PATH) {
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(OauthCallbackPage.bootstrap({ tokenPath: OAUTH_TOKEN_PATH, provider: "DigitalOcean" }))
      return
    }

    if (req.method === "POST" && url.pathname === OAUTH_TOKEN_PATH) {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8")
        let body: Record<string, string> = {}
        try {
          body = raw ? JSON.parse(raw) : {}
        } catch {
          body = {}
        }
        // state 无法匹配时不得牵连其他在途流程：只回 409，真实流程留给自己的超时收敛
        const pending = takePending(body.state)
        if (!pending) {
          res.writeHead(409, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "no_pending_oauth" }))
          return
        }
        if (body.error) {
          const message = body.error_description || body.error || "OAuth error"
          pending.reject(new Error(String(message)))
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
          return
        }
        if (!body.access_token) {
          pending.reject(new Error("Missing access_token in callback"))
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "missing_access_token" }))
          return
        }
        const expires = parseInt(body.expires_in || "0", 10)
        pending.resolve({
          access_token: body.access_token,
          expires_in: Number.isFinite(expires) && expires > 0 ? expires : 60 * 60 * 24 * 30,
          state: body.state,
        })
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  // 端口被占用时 listen 只发 error 事件：转成可读失败并清理引用，authorize 才不会拿到裸异常或误判已在运行
  const bound = await new Promise<boolean>((resolve, reject) => {
    oauthServer!.once("error", (error) => reject(error))
    oauthServer!.listen(OAUTH_PORT, () => resolve(true))
  }).catch(() => false)
  if (!bound) {
    oauthServer = undefined
    throw new Error(`DigitalOcean OAuth callback server failed to bind port ${OAUTH_PORT}`)
  }
}

function stopOAuthServer() {
  if (!oauthServer) return
  oauthServer.close()
  oauthServer = undefined
}

function waitForOAuthCallback(state: string): Promise<ImplicitTokenPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (!pendingOAuth.delete(state)) return
        reject(new Error("OAuth callback timeout - authorization took too long"))
        if (pendingOAuth.size === 0) stopOAuthServer()
      },
      5 * 60 * 1000,
    )
    pendingOAuth.set(state, {
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    })
  })
}

async function listRouters(
  bearer: string,
): Promise<{ ok: true; routers: RouterEntry[] } | { ok: false; status: number }> {
  const res = await fetch(`${DO_GENAI_API}/models/routers`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
      "User-Agent": `opennovel/${InstallationVersion}`,
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  if (!res) return { ok: false, status: 0 }
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await res.json().catch(() => undefined)) as { model_routers?: RouterEntry[] } | undefined
  return { ok: true, routers: body?.model_routers ?? [] }
}

function routerModel(router: RouterEntry, providerID: string): Model {
  const id = `router:${router.name}`
  return {
    id,
    providerID,
    name: router.name,
    family: "digitalocean-inference-routers",
    api: { id, url: DO_INFERENCE_BASE, npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

function parseRoutersJSON(raw: string | undefined): RouterEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((r) =>
      r && typeof r.name === "string" ? [{ name: r.name, uuid: r.uuid, description: r.description }] : [],
    )
  } catch {
    return []
  }
}

export async function DigitalOceanAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    provider: {
      id: "digitalocean",
      async models(provider, ctx) {
        const baseModels = provider.models
        if (ctx.auth?.type !== "api") return baseModels

        const metadata = ctx.auth.metadata ?? {}
        const oauthAccess = metadata["oauth_access"]
        const oauthExpires = parseInt(metadata["oauth_expires"] || "0", 10)
        const fetchedAt = parseInt(metadata["routers_fetched_at"] || "0", 10)
        const cached = parseRoutersJSON(metadata["routers"])

        let routers = cached
        const stale = Date.now() - fetchedAt > ROUTER_REFRESH_INTERVAL_MS
        const bearerValid = oauthAccess && oauthExpires > Date.now()

        if (bearerValid && stale) {
          const result = await listRouters(oauthAccess)
          if (result.ok) {
            routers = result.routers
            const updated: Record<string, string> = {
              ...metadata,
              routers: JSON.stringify(routers.map((r) => ({ name: r.name, uuid: r.uuid, description: r.description }))),
              routers_fetched_at: String(Date.now()),
            }
            await input.client.auth
              .set({
                path: { id: "digitalocean" },
                body: { type: "api", key: ctx.auth.key, metadata: updated },
              })
              .catch(() => {})
          } else if (result.status === 401 || result.status === 403) {
          } else if (result.status !== 0) {
          }
        }

        const merged: Record<string, Model> = { ...baseModels }
        for (const router of routers) {
          const id = `router:${router.name}`
          if (merged[id]) continue
          merged[id] = routerModel(router, "digitalocean")
        }
        return merged
      },
    },
    auth: {
      provider: "digitalocean",
      methods: [
        {
          type: "oauth",
          label: "Login with DigitalOcean",
          async authorize() {
            await startOAuthServer()
            const state = generateState()
            const callbackPromise = waitForOAuthCallback(state)
            const url = buildAuthorizeUrl(state)
            await open(url).catch(() => undefined)
            return {
              url,
              instructions:
                "Sign in to DigitalOcean in your browser. OpenNovel will use your DigitalOcean API token directly for inference and load your Inference Routers. Re-run /connect to refresh routers later.",
              method: "auto" as const,
              async callback() {
                try {
                  const tokens = await callbackPromise
                  const routerResult = await listRouters(tokens.access_token)
                  const routers = routerResult.ok ? routerResult.routers : []
                  if (!routerResult.ok) {
                  }
                  return {
                    type: "success" as const,
                    provider: "digitalocean",
                    key: tokens.access_token,
                    metadata: {
                      oauth_access: tokens.access_token,
                      oauth_expires: String(Date.now() + tokens.expires_in * 1000),
                      oauth_scopes: OAUTH_SCOPES,
                      routers: JSON.stringify(
                        routers.map((r) => ({ name: r.name, uuid: r.uuid, description: r.description })),
                      ),
                      routers_fetched_at: String(Date.now()),
                    },
                  }
                } catch (err) {
                  return { type: "failed" as const }
                } finally {
                  stopOAuthServer()
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Paste Model Access Key",
        },
      ],
    },
  }
}
