export * as Mcp from "./index"

import path from "node:path"
import { pathToFileURL } from "node:url"
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  ListRootsRequestSchema,
  type LoggingMessageNotification,
  LoggingMessageNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { McpEvent } from "@opennovel-ai/schema/mcp-event"
import { Mcp as McpSchema } from "@opennovel-ai/schema/mcp"
import { Cause, Context, Effect, Exit, FiberSet, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { makeLocationNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { CrossSpawnSpawner } from "../cross-spawn-spawner"
import { EventV2 } from "../event"
import { InstallationVersion } from "../installation/version"
import { Location } from "../location"
import { McpAuth } from "./auth"
import { McpBrowser } from "./browser"
import { McpCatalog } from "./catalog"
import { McpOAuthCallback } from "./oauth-callback"
import { McpOAuthProvider } from "./oauth-provider"

const DEFAULT_TIMEOUT = 30_000
const CLIENT_OPTIONS = {
  capabilities: {
    // elicitation 保持关闭（与 V1 实现一致）：fork 无表单服务承接服务器追问
    // sampling/tasks 同样不声明
    roots: {},
  },
} satisfies ClientOptions

export const Status = McpSchema.Status
export type Status = McpSchema.Status
export type ServerInfo = McpSchema.ServerInfo
export type AuthStatus = McpSchema.AuthStatus

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCP.NotFoundError", {
  name: Schema.String,
}) {}

export class ToolCallError extends Schema.TaggedErrorClass<ToolCallError>()("MCP.ToolCallError", {
  server: Schema.String,
  tool: Schema.String,
  message: Schema.String,
}) {}

// OAuth 流程的前置/状态失败（非 remote、显式禁用、URL 无效、state 不匹配、无在途流程）
export class AuthError extends Schema.TaggedErrorClass<AuthError>()("MCP.AuthError", {
  message: Schema.String,
}) {}

export interface ServerInstructions {
  name: string
  instructions: string
  tools: string[]
}

export interface ListedTool {
  readonly server: string
  readonly def: McpCatalog.ToolDef
  readonly timeout?: number
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly instructions: () => Effect.Effect<ServerInstructions[]>
  readonly tools: () => Effect.Effect<Record<string, ListedTool>>
  readonly callTool: (input: {
    readonly server: string
    readonly name: string
    readonly args?: Record<string, unknown>
  }) => Effect.Effect<CallToolResult, NotFoundError | ToolCallError>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: (clientName?: string) => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly resourceTemplates: (
    clientName?: string,
  ) => Effect.Effect<Record<string, ResourceTemplateInfo & { client: string }>>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<Client["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<Client["readResource"]>> | undefined>
  readonly add: (name: string, mcp: ServerConfig) => Effect.Effect<{ status: Record<string, Status> }>
  readonly connect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly disconnect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly startAuth: (
    mcpName: string,
  ) => Effect.Effect<{ authorizationUrl: string; oauthState: string; client?: Client }, NotFoundError | AuthError>
  readonly authenticate: (
    mcpName: string,
    onAuthorization?: (authorizationUrl: string) => void,
  ) => Effect.Effect<Status, NotFoundError | AuthError>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status, NotFoundError | AuthError>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean, NotFoundError>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/MCP") {}

type ServerConfig = Schema.Schema.Type<typeof ConfigMCP.Server>
type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
type CallToolResult = import("@modelcontextprotocol/sdk/types.js").CallToolResult
type PromptInfo = Awaited<ReturnType<Client["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<Client["listResources"]>>["resources"][number]
type ResourceTemplateInfo = Awaited<ReturnType<Client["listResourceTemplates"]>>["resourceTemplates"][number]

type Entry = {
  config: ServerConfig
  status: Status
  client?: Client
  defs?: McpCatalog.ToolDef[]
  instructions?: string
}

function createClient(directory: string) {
  const client = new Client({ name: "opennovel", version: InstallationVersion }, CLIENT_OPTIONS)
  client.setRequestHandler(ListRootsRequestSchema, () =>
    Promise.resolve({ roots: [{ uri: pathToFileURL(directory).href }] }),
  )
  return client
}

function remoteURL(value: string) {
  if (URL.canParse(value)) return new URL(value)
}

function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP connection timed out after ${timeout}ms`)), timeout)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const configService = yield* Config.Service
    const auth = yield* McpAuth.Service
    const events = yield* EventV2.Service
    const browser = yield* McpBrowser.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fork = yield* FiberSet.makeRuntime<never, void, never>()

    const entries = new Map<string, Entry>()
    // 运行时 add 的服务器叠加在配置文件之上；remove 通过 false 墓碑隐藏配置项
    const overrides = new Map<string, ServerConfig | false>()
    const pendingOAuthTransports = new Map<string, { transport: TransportWithAuth; provider?: McpOAuthProvider.PendingProvider }>()
    // 串行化每台服务器的生命周期操作；连接回调内取锁必须保持 forked
    const locks = KeyedMutex.makeUnsafe<string>()

    const configured = Effect.fnUntraced(function* () {
      const mcp = Config.latest(yield* configService.entries(), "mcp")
      const servers = new Map<string, ServerConfig>()
      for (const [name, server] of Object.entries(mcp?.servers ?? {})) servers.set(name, server)
      for (const [name, server] of overrides) {
        if (server === false) servers.delete(name)
        else servers.set(name, server)
      }
      return { servers, timeout: mcp?.timeout }
    })

    const publishToolsChanged = (name: string) =>
      events.publish(McpEvent.ToolsChanged, { server: name }).pipe(Effect.ignore)

    /**
     * Connect a client via the given transport with resource safety:
     * on failure the transport is closed; on success the caller owns it.
     */
    const connectTransport = Effect.fnUntraced(function* (transport: Transport, timeout: number) {
      return yield* Effect.acquireUseRelease(
        Effect.succeed(transport),
        (t) =>
          Effect.tryPromise({
            try: () => {
              const client = createClient(location.directory)
              return withTimeout(client.connect(t), timeout).then(() => client)
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
        (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
      )
    })

    const connectRemote = Effect.fnUntraced(function* (
      key: string,
      mcp: ServerConfig & { type: "remote" },
      startupTimeout: number,
    ) {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      const url = remoteURL(mcp.url)
      if (!url) {
        return { client: undefined as Client | undefined, status: { status: "failed", error: `Invalid MCP URL for "${key}"` } as Status }
      }
      const authProvider = oauthDisabled
        ? undefined
        : new McpOAuthProvider.Provider(
            key,
            mcp.url,
            {
              clientId: oauthConfig?.client_id,
              clientSecret: oauthConfig?.client_secret,
              scope: oauthConfig?.scope,
              callbackPort: oauthConfig?.callback_port,
              redirectUri: oauthConfig?.redirect_uri,
            },
            { onRedirect: async () => {} },
            auth,
          )

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      let lastStatus: Status | undefined
      for (const { transport } of transports) {
        const result = yield* connectTransport(transport, startupTimeout).pipe(
          Effect.map((client) => ({ client })),
          Effect.catch((error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError =
              error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

            if (isAuthError) {
              if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                lastStatus = {
                  status: "needs_client_registration",
                  error: "Server does not support dynamic client registration. Please provide client_id in config.",
                }
              } else {
                pendingOAuthTransports.set(key, { transport })
                lastStatus = { status: "needs_auth" }
              }
              return Effect.logWarning("MCP server requires authentication", { server: key, status: lastStatus.status }).pipe(
                Effect.as(undefined),
              )
            }

            lastStatus = { status: "failed", error: lastError.message }
            return Effect.void
          }),
        )
        if (result) return { client: result.client, status: { status: "connected" } as Status }
        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        client: undefined as Client | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
      }
    })

    const connectLocal = Effect.fnUntraced(function* (
      mcp: ServerConfig & { type: "local" },
      startupTimeout: number,
    ) {
      const [cmd, ...args] = mcp.command
      const cwd = mcp.cwd ? path.resolve(location.directory, mcp.cwd) : location.directory
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opennovel" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })

      return yield* connectTransport(transport, startupTimeout).pipe(
        Effect.map((client): { client: Client | undefined; status: Status } => ({
          client,
          status: { status: "connected" },
        })),
        Effect.catch((error): Effect.Effect<{ client: Client | undefined; status: Status }> => {
          const msg = error instanceof Error ? error.message : String(error)
          return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
        }),
      )
    })

    function watch(entry: Entry, name: string, client: Client, requestTimeout?: number) {
      client.onclose = () => {
        if (entries.get(name)?.client !== client) return
        entry.client = undefined
        entry.defs = undefined
        entry.instructions = undefined
        entry.status = { status: "failed", error: "Connection closed" }
        fork(Effect.logWarning("MCP connection closed", { server: name }).pipe(Effect.andThen(publishToolsChanged(name))))
      }

      client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
        fork(serverLog(name, notification.params))
      })

      if (!client.getServerCapabilities()?.tools) return
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        fork(
          Effect.gen(function* () {
            if (entries.get(name)?.client !== client || entry.status.status !== "connected") return
            const listed = yield* McpCatalog.defs(client, requestTimeout)
            if (!listed) return
            if (entries.get(name)?.client !== client || entry.status.status !== "connected") return
            entry.defs = listed
            yield* publishToolsChanged(name)
          }),
        )
      })
    }

    const connectServer = Effect.fnUntraced(function* (name: string, entry: Entry) {
      const configuredTimeout = yield* configured().pipe(Effect.map((c) => c.timeout))
      const startupTimeout = entry.config.timeout?.startup ?? configuredTimeout?.startup ?? DEFAULT_TIMEOUT
      const requestTimeout = entry.config.timeout?.request ?? configuredTimeout?.request
      if (entry.config.disabled) {
        entry.status = { status: "disabled" }
        return
      }
      entry.status = { status: "disabled" }
      const { client, status } =
        entry.config.type === "remote"
          ? yield* connectRemote(name, entry.config, startupTimeout)
          : yield* connectLocal(entry.config, startupTimeout)
      entry.status = status
      if (!client) {
        yield* Effect.logWarning("mcp server unavailable", { server: name, type: entry.config.type, status: status.status })
        return
      }
      const listed = client.getServerCapabilities()?.tools ? yield* McpCatalog.defs(client, requestTimeout) : []
      if (!listed) {
        entry.status = { status: "failed", error: "Failed to get tools" }
        yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
        return
      }
      entry.client = client
      entry.defs = listed
      entry.status = { status: "connected" }
      const instructions = client.getInstructions()?.trim()
      entry.instructions = instructions || undefined
      watch(entry, name, client, requestTimeout)
      yield* Effect.logInfo("mcp connected", { server: name, tools: listed.length })
      yield* publishToolsChanged(name)
    })

    const stopServer = Effect.fnUntraced(function* (name: string, entry: Entry) {
      const client = entry.client
      entry.client = undefined
      entry.defs = undefined
      entry.instructions = undefined
      if (!client) return
      const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
      if (typeof pid === "number") {
        const pids = yield* descendants(pid)
        for (const dpid of pids) {
          yield* Effect.sync(() => {
            try {
              process.kill(dpid, "SIGTERM")
            } catch {}
          })
        }
      }
      yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      yield* publishToolsChanged(name)
    })

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === "win32") return [] as number[]
        const pids: number[] = []
        const queue = [pid]
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index]
          const handle = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          for (const tok of text.split("\n")) {
            const cpid = parseInt(tok, 10)
            if (!isNaN(cpid) && !pids.includes(cpid)) {
              pids.push(cpid)
              queue.push(cpid)
            }
          }
        }
        return pids
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[])),
    )

    const requireEntry = Effect.fnUntraced(function* (name: string) {
      const entry = entries.get(name)
      if (!entry) return yield* new NotFoundError({ name })
      return entry
    })

    // 初始连接保持异步：一台慢服务器不能阻塞 Location 启动
    yield* Effect.gen(function* () {
      const { servers } = yield* configured()
      for (const [name, server] of servers) {
        const entry: Entry = { config: server, status: { status: "disabled" } }
        entries.set(name, entry)
        if (server.disabled) continue
        fork(connectServer(name, entry).pipe(locks.withLock(name)))
      }
    })

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const all = Array.from(entries.entries())
        entries.clear()
        yield* Effect.forEach(all, ([name, entry]) => stopServer(name, entry), { discard: true })
        yield* Effect.promise(() => McpOAuthCallback.stop())
      }).pipe(Effect.ignore),
    )

    const status = Effect.fn("MCP.status")(function* () {
      const { servers } = yield* configured()
      const result: Record<string, Status> = {}
      for (const name of servers.keys()) {
        result[name] = entries.get(name)?.status ?? { status: "disabled" }
      }
      for (const [name, entry] of entries) {
        result[name] = entry.status
      }
      return result
    })

    const instructions = Effect.fn("MCP.instructions")(function* () {
      return Array.from(entries)
        .filter(([, entry]) => entry.status.status === "connected" && entry.instructions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, entry]) => ({
          name,
          instructions: entry.instructions!,
          tools: (entry.defs ?? []).map((tool) => McpCatalog.toolName(name, tool.name)),
        }))
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      const result: Record<string, ListedTool> = {}
      for (const [name, entry] of entries) {
        if (entry.status.status !== "connected") continue
        if (!entry.defs) {
          yield* Effect.logWarning("missing cached tools for connected server", { clientName: name })
          continue
        }
        for (const def of entry.defs) {
          result[McpCatalog.toolName(name, def.name)] = {
            server: name,
            def,
            timeout: entry.config.timeout?.request,
          }
        }
      }
      return result
    })

    const callTool = Effect.fn("MCP.callTool")(function* (input: {
      server: string
      name: string
      args?: Record<string, unknown>
    }) {
      const entry = yield* requireEntry(input.server)
      const client = entry.client
      if (!client) {
        return yield* new ToolCallError({
          server: input.server,
          tool: input.name,
          message: `MCP server "${input.server}" is not connected (status: ${entry.status.status})`,
        })
      }
      const { timeout } = yield* configured()
      const requestTimeout = entry.config.timeout?.request ?? timeout?.request ?? DEFAULT_TIMEOUT
      return yield* Effect.tryPromise({
        try: () =>
          client.callTool({ name: input.name, arguments: input.args ?? {} }, CallToolResultSchema, {
            resetTimeoutOnProgress: true,
            timeout: requestTimeout,
            // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
            onprogress: () => {},
          }),
        catch: (error) =>
          new ToolCallError({
            server: input.server,
            tool: input.name,
            message: `MCP tool "${input.name}" on server "${input.server}" failed: ${error instanceof Error ? error.message : String(error)}`,
          }),
      })
    })

    function collectFromConnected<T extends { name: string }>(
      listFn: (c: Client, timeout?: number) => Promise<T[]>,
      label: string,
      key?: (item: T) => string,
      targetClientName?: string,
    ) {
      return Effect.gen(function* () {
        const { timeout } = yield* configured()
        return yield* Effect.forEach(
          Array.from(entries).filter(
            ([name, entry]) => entry.client !== undefined && (!targetClientName || name === targetClientName),
          ),
          ([clientName, entry]) =>
            McpCatalog.fetch(
              clientName,
              entry.client!,
              (c) => listFn(c, entry.config.timeout?.request ?? timeout?.request),
              label,
              key,
            ).pipe(Effect.map((items) => Object.entries(items ?? {}))),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
      })
    }

    const prompts = Effect.fn("MCP.prompts")(function* () {
      return yield* collectFromConnected(McpCatalog.prompts, "prompts")
    })

    const resources = Effect.fn("MCP.resources")(function* (clientName?: string) {
      return yield* collectFromConnected(McpCatalog.resources, "resources", (resource) => resource.uri, clientName)
    })

    const resourceTemplates = Effect.fn("MCP.resourceTemplates")(function* (clientName?: string) {
      return yield* collectFromConnected(
        McpCatalog.resourceTemplates,
        "resource templates",
        (template) => template.uriTemplate,
        clientName,
      )
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: Client, timeout?: number) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>,
    ) {
      const entry = entries.get(clientName)
      if (!entry?.client) {
        yield* Effect.logWarning(`client not found for ${label}`, { clientName })
        return undefined
      }
      const { timeout } = yield* configured()
      return yield* Effect.tryPromise({
        try: () => fn(entry.client!, entry.config.timeout?.request ?? timeout?.request),
        catch: (error) => error,
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError(`failed to ${label}`, {
            clientName,
            ...meta,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
        Effect.orElseSucceed(() => undefined),
      )
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(
        clientName,
        (client, timeout) => client.getPrompt({ name, arguments: args }, { timeout }),
        "getPrompt",
        { promptName: name },
      )
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(
        clientName,
        (client, timeout) => client.readResource({ uri: resourceUri }, { timeout }),
        "readResource",
        { resourceUri },
      )
    })

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const { servers } = yield* configured()
      return servers.get(mcpName)
    })

    const requireMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return yield* new NotFoundError({ name: mcpName })
      return mcpConfig
    })

    const replaceEntry = Effect.fnUntraced(function* (name: string, mcp: ServerConfig) {
      const previous = entries.get(name)
      if (previous) yield* stopServer(name, previous)
      const entry: Entry = { config: mcp, status: { status: "disabled" } }
      entries.set(name, entry)
      yield* connectServer(name, entry)
      return entry
    })

    const add = Effect.fn("MCP.add")(function* (name: string, mcp: ServerConfig) {
      overrides.set(name, mcp)
      yield* replaceEntry(name, mcp).pipe(locks.withLock(name))
      return { status: yield* status() }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const mcpConfig = yield* requireMcpConfig(name)
      const enabled = { ...mcpConfig, disabled: undefined } as ServerConfig
      yield* replaceEntry(name, enabled).pipe(locks.withLock(name))
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      yield* requireMcpConfig(name)
      const entry = yield* requireEntry(name)
      yield* stopServer(name, entry).pipe(locks.withLock(name))
      entry.status = { status: "disabled" }
    })

    // 回收某个 server 的在途授权：移除 Map 条目并关闭 transport，避免死条目与 PKCE verifier 悬挂
    const dropPendingAuth = Effect.fnUntraced(function* (mcpName: string) {
      const stale = pendingOAuthTransports.get(mcpName)
      if (!stale) return
      pendingOAuthTransports.delete(mcpName)
      yield* Effect.tryPromise(() => stale.transport.close()).pipe(Effect.ignore)
    })

    const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
      const mcpConfig = yield* requireMcpConfig(mcpName)
      if (mcpConfig.type !== "remote") return yield* new AuthError({ message: `MCP server ${mcpName} is not a remote server` })
      if (mcpConfig.oauth === false)
        return yield* new AuthError({ message: `MCP server ${mcpName} has OAuth explicitly disabled` })
      const url = remoteURL(mcpConfig.url)
      if (!url) return yield* new AuthError({ message: `Invalid MCP URL for "${mcpName}"` })

      // 同一 server 重复发起授权会覆盖在途流程：先取消旧的回调等待并回收旧 transport
      McpOAuthCallback.cancelPending(mcpName)
      yield* dropPendingAuth(mcpName)

      // OAuth config is optional - if not provided, we'll use auto-discovery
      const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined

      // Resolve effective redirect URI: explicit redirect_uri > callback_port shorthand > default
      const effectiveRedirectUri =
        oauthConfig?.redirect_uri ??
        (oauthConfig?.callback_port
          ? `http://127.0.0.1:${oauthConfig.callback_port}${McpOAuthProvider.OAUTH_CALLBACK_PATH}`
          : undefined)

      // Start the callback server with custom redirectUri if configured
      yield* Effect.promise(() => McpOAuthCallback.ensureRunning(effectiveRedirectUri))

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      yield* auth.updateOAuthState(mcpName, oauthState)
      let capturedUrl: URL | undefined
      const authProvider = new McpOAuthProvider.PendingProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.client_id,
          clientSecret: oauthConfig?.client_secret,
          scope: oauthConfig?.scope,
          redirectUri: effectiveRedirectUri,
        },
        {
          onRedirect: async (url) => {
            capturedUrl = url
          },
        },
        auth,
      )

      const transport = new StreamableHTTPClientTransport(url, {
        authProvider,
        requestInit: mcpConfig.headers ? { headers: mcpConfig.headers } : undefined,
      })

      return yield* Effect.tryPromise({
        try: () => {
          const client = createClient(location.directory)
          return client.connect(transport).then(async () => {
            await authProvider.commit()
            return { authorizationUrl: "", oauthState, client }
          })
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => {
          if (error instanceof UnauthorizedError && capturedUrl) {
            pendingOAuthTransports.set(mcpName, { transport, provider: authProvider })
            return Effect.succeed({ authorizationUrl: capturedUrl.toString(), oauthState, client: undefined })
          }
          return Effect.die(error)
        }),
      )
    })

    const storeAuthClient = Effect.fnUntraced(function* (
      mcpName: string,
      mcpConfig: ServerConfig,
      client: Client,
    ) {
      const requestTimeout = mcpConfig.timeout?.request
      const listed = client.getServerCapabilities()?.tools ? yield* McpCatalog.defs(client, requestTimeout) : []
      if (!listed) {
        yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
        return { status: "failed", error: "Failed to get tools" } as Status
      }
      const previous = entries.get(mcpName)
      if (previous) yield* stopServer(mcpName, previous)
      const entry: Entry = {
        config: mcpConfig,
        status: { status: "connected" },
        client,
        defs: listed,
        instructions: client.getInstructions()?.trim() || undefined,
      }
      entries.set(mcpName, entry)
      watch(entry, mcpName, client, requestTimeout)
      yield* publishToolsChanged(mcpName)
      return entry.status
    })

    const authenticate = Effect.fn("MCP.authenticate")(function* (
      mcpName: string,
      onAuthorization?: (authorizationUrl: string) => void,
    ) {
      const result = yield* startAuth(mcpName)
      if (!result.authorizationUrl) {
        const client = result.client
        const mcpConfig = yield* requireMcpConfig(mcpName).pipe(
          Effect.tapError(() => Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)),
        )
        if (!client) return { status: "failed", error: "Failed to get tools" } as Status
        yield* auth.clearOAuthState(mcpName)
        return yield* storeAuthClient(mcpName, mcpConfig, client)
      }

      const callbackPromise = McpOAuthCallback.waitForCallback(result.oauthState, mcpName)
      onAuthorization?.(result.authorizationUrl)

      yield* browser.open(result.authorizationUrl).pipe(
        Effect.catch(() => {
          // 浏览器打不开就永远等不到回调：终止本次授权，让下面的 await 走失败与回收路径
          McpOAuthCallback.cancelPending(mcpName)
          return events
            .publish(McpEvent.BrowserOpenFailed, { mcpName, url: result.authorizationUrl })
            .pipe(Effect.ignore)
        }),
      )

      const callback = yield* Effect.promise(() => callbackPromise).pipe(Effect.exit)
      if (Exit.isFailure(callback)) {
        // 超时或取消后不会再有人 finishAuth：回收在途 transport，避免 Map 留下死条目
        yield* dropPendingAuth(mcpName)
        return yield* Effect.failCause(callback.cause)
      }
      const code = callback.value

      const storedState = yield* auth.getOAuthState(mcpName)
      if (storedState !== result.oauthState) {
        yield* auth.clearOAuthState(mcpName)
        return yield* new AuthError({ message: "OAuth state mismatch - potential CSRF attack" })
      }
      yield* auth.clearOAuthState(mcpName)
      return yield* finishAuth(mcpName, code)
    })

    const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
      yield* requireMcpConfig(mcpName)
      const pending = pendingOAuthTransports.get(mcpName)
      if (!pending) return yield* new AuthError({ message: `No pending OAuth flow for MCP server: ${mcpName}` })

      const error = yield* Effect.tryPromise({
        try: () => pending.transport.finishAuth(authorizationCode),
        catch: (error) => error,
      }).pipe(
        Effect.match({
          onFailure: (error) => (error instanceof Error ? error.message : String(error)),
          onSuccess: () => undefined,
        }),
      )

      if (error) return { status: "failed", error: `OAuth completion failed: ${error}` } as Status

      yield* Effect.promise(() => pending.provider?.commit() ?? Promise.resolve())
      yield* auth.clearCodeVerifier(mcpName)
      pendingOAuthTransports.delete(mcpName)

      const mcpConfig = yield* requireMcpConfig(mcpName)
      const enabled = { ...mcpConfig, disabled: undefined } as ServerConfig
      const entry = yield* replaceEntry(mcpName, enabled)
      return entry.status
    })

    const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
      yield* auth.remove(mcpName)
      McpOAuthCallback.cancelPending(mcpName)
      pendingOAuthTransports.delete(mcpName)
    })

    const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
      const mcpConfig = yield* requireMcpConfig(mcpName)
      return mcpConfig.type === "remote" && mcpConfig.oauth !== false
    })

    const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      return !!entry?.tokens
    })

    const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig || mcpConfig.type !== "remote") return "not_authenticated" as AuthStatus
      const entry = yield* auth.getForUrl(mcpName, mcpConfig.url)
      if (!entry?.tokens) return "not_authenticated" as AuthStatus
      if (entry.tokens.expiresAt && entry.tokens.expiresAt < Date.now() / 1000) return "expired" as AuthStatus
      return "authenticated" as AuthStatus
    })

    return Service.of({
      status,
      instructions,
      tools,
      callTool,
      prompts,
      resources,
      resourceTemplates,
      getPrompt,
      readResource,
      add,
      connect,
      disconnect,
      startAuth,
      authenticate,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, Config.node, EventV2.node, McpAuth.node, McpBrowser.node, CrossSpawnSpawner.node],
})

function serverLog(name: string, params: LoggingMessageNotification["params"]) {
  const fields = { server: name, logger: params.logger, level: params.level, data: params.data }
  switch (params.level) {
    case "debug":
      return Effect.logDebug("MCP server log", fields)
    case "info":
    case "notice":
      return Effect.logInfo("MCP server log", fields)
    case "warning":
      return Effect.logWarning("MCP server log", fields)
    case "error":
    case "critical":
    case "alert":
    case "emergency":
      return Effect.logError("MCP server log", fields)
  }
}
