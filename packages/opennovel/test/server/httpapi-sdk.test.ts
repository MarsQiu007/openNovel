import { afterEach, describe, expect } from "bun:test"
import { ConfigV1 } from "@opennovel-ai/core/v1/config/config"
import { Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import { HttpServer } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opennovel-ai/core/cross-spawn-spawner"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { createOpenNovelClient } from "@opennovel-ai/sdk/v2"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"

import type { Config } from "@/config/config"
import { errorMessage } from "../../src/util/error"
import { TestLLMServer } from "../lib/llm-server"
import { validateSession } from "../../src/cli/tui/validate-session"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { Database } from "@opennovel-ai/core/database/database"
import { httpApiLayer } from "./httpapi-layer"

const noopBootstrapLayer = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const appLayer = AppNodeBuilder.build(
  LayerNode.group([FSUtil.node, CrossSpawnSpawner.node, InstanceStore.node, Database.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

const original = {
  OPENNOVEL_SERVER_PASSWORD: Flag.OPENNOVEL_SERVER_PASSWORD,
  OPENNOVEL_SERVER_USERNAME: Flag.OPENNOVEL_SERVER_USERNAME,
}

type ServerPath = "default" | "raw"
type Sdk = ReturnType<typeof createOpenNovelClient>
type SdkResult = { response?: Response; data?: unknown; error?: unknown }
type Captured = { status: number; data?: unknown; error?: unknown }
type ProjectFixture = { sdk: Sdk; directory: string }
type LlmProjectFixture = ProjectFixture & { llm: TestLLMServer["Service"] }
type TestServices =
  | FSUtil.Service
  | ChildProcessSpawner.ChildProcessSpawner
  | InstanceStore.Service
  | HttpServer.HttpServer
type TestScope = Scope.Scope | TestServices

function client(
  serverPath: ServerPath,
  directory?: string,
  input?: {
    password?: string
    username?: string
    headers?: Record<string, string>
    workspaceID?: string
    onRequest?: (request: Request) => void
  },
) {
  return serverFetch(serverPath, input).pipe(
    Effect.map((fetch) =>
      createOpenNovelClient({
        baseUrl: "http://localhost",
        directory,
        experimental_workspaceID: input?.workspaceID,
        headers: input?.headers,
        fetch,
      }),
    ),
  )
}

function serverFetch(
  serverPath: ServerPath,
  input?: { password?: string; username?: string; onRequest?: (request: Request) => void },
) {
  return HttpServer.HttpServer.use((server) =>
    Effect.sync(() => {
      void serverPath
      Flag.OPENNOVEL_SERVER_PASSWORD = input?.password
      Flag.OPENNOVEL_SERVER_USERNAME = input?.username
      const baseUrl = HttpServer.formatAddress(server.address)
      return Object.assign(
        async (request: RequestInfo | URL, init?: RequestInit) => {
          const source = request instanceof Request ? request : new Request(request, init)
          input?.onRequest?.(source)
          const url = new URL(source.url)
          return globalThis.fetch(new Request(new URL(`${url.pathname}${url.search}`, baseUrl), source))
        },
        { preconnect: globalThis.fetch.preconnect },
      ) satisfies typeof globalThis.fetch
    }),
  )
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function call<T>(request: () => Promise<T>) {
  return Effect.promise(request)
}

function capture(request: () => Promise<SdkResult>) {
  return call(request).pipe(
    Effect.map((result) => ({
      status: result.response!.status,
      data: result.data,
      error: result.error,
    })),
  )
}

function captureThrown(request: () => Promise<unknown>) {
  return call(async () => {
    try {
      await request()
    } catch (error) {
      return error
    }
  })
}

function expectStatus(request: () => Promise<{ response?: Response }>, status: number) {
  return call(request).pipe(
    Effect.tap((result) => Effect.sync(() => expect(result.response!.status).toBe(status))),
    Effect.asVoid,
  )
}

function firstEvent(open: (signal: AbortSignal) => Promise<{ stream: AsyncIterator<unknown> }>) {
  return Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (controller) => Effect.sync(() => controller.abort()),
  ).pipe(
    Effect.flatMap((controller) =>
      Effect.acquireRelease(
        call(() => open(controller.signal)),
        (events) => call(async () => void (await events.stream.return?.(undefined))).pipe(Effect.ignore),
      ).pipe(
        Effect.flatMap((events) =>
          call(() => events.stream.next()).pipe(
            Effect.timeoutOrElse({
              duration: "1 second",
              orElse: () => Effect.fail(new Error("timed out waiting for SDK event")),
            }),
          ),
        ),
        Effect.map((result) => result.value),
      ),
    ),
  )
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function statuses(input: Record<string, Captured>) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.status]))
}

function httpapi<A, E>(name: string, effect: Effect.Effect<A, E, TestScope>) {
  it.live(name, effect)
}

function httpapiInstance<A, E>(
  name: string,
  options: {
    serverPath: ServerPath
    git?: boolean
    config?: Partial<ConfigV1.Info>
    setup?: (dir: string) => Effect.Effect<void, E, TestServices>
  },
  run: (input: ProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  it.instance(
    name,
    Effect.gen(function* () {
      const instance = yield* TestInstance
      yield* options.setup?.(instance.directory) ?? Effect.void
      return yield* run({ sdk: yield* client(options.serverPath, instance.directory), directory: instance.directory })
    }),
    { git: options.git ?? true, config: { formatter: false, lsp: false, ...options.config } },
  )
}

function serverPathParity<A, E>(name: string, scenario: (serverPath: ServerPath) => Effect.Effect<A, E, TestScope>) {
  it.live(name, scenario("raw"))
}

function withProject<A, E, E2 = never>(
  serverPath: ServerPath,
  options: {
    git?: boolean
    config?: Partial<ConfigV1.Info>
    setup?: (dir: string) => Effect.Effect<void, E2, TestServices>
  },
  run: (input: ProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  return Effect.gen(function* () {
    const directory = yield* tmpdirScoped({
      git: options.git ?? false,
      config: { formatter: false, lsp: false, ...options.config },
    })
    yield* options.setup?.(directory) ?? Effect.void
    return yield* run({ sdk: yield* client(serverPath, directory), directory })
  })
}

function withStandardProject<A, E>(
  serverPath: ServerPath,
  run: (input: ProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  return withProject(serverPath, { setup: writeStandardFiles }, run)
}

// V2 catalog 只认 ConfigV2 provider 形状（api/request）；V1 的 npm/options 字段
// 在解析时被丢弃，provider 永远不会进入 catalog.available。
function testProviderConfigV2(llmUrl: string) {
  return {
    formatter: false,
    lsp: false,
    providers: {
      test: {
        name: "Test",
        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llmUrl },
        request: { body: { apiKey: "test-key" } },
        models: {
          "test-model": {
            name: "Test Model",
            limit: { context: 100_000, output: 10_000 },
          },
        },
      },
    },
  } as unknown as Partial<ConfigV1.Info>
}

// Location 插件在 runtime 启动时异步填充 catalog，等 test/test-model 可见后再 prompt。
function awaitTestModel(sdk: Sdk) {
  return pollWithTimeout(
    call(() => sdk.v2.model.list()).pipe(
      Effect.map((result) =>
        result.data?.data.some((model) => model.providerID === "test" && model.id === "test-model")
          ? true
          : undefined,
      ),
    ),
    "test provider model was not loaded into the catalog",
  )
}

function withFakeLlm<A, E>(serverPath: ServerPath, run: (input: LlmProjectFixture) => Effect.Effect<A, E, TestScope>) {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    return yield* withProject(serverPath, { config: testProviderConfigV2(llm.url) }, (input) => run({ ...input, llm }))
  }).pipe(Effect.provide(TestLLMServer.layer))
}

function withFakeLlmProject<A, E>(
  serverPath: ServerPath,
  options: { setup?: (dir: string) => Effect.Effect<void, E, TestServices> },
  run: (input: LlmProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    return yield* withProject(
      serverPath,
      {
        config: testProviderConfigV2(llm.url),
        setup: options.setup,
      },
      (input) => run({ ...input, llm }),
    )
  }).pipe(Effect.provide(TestLLMServer.layer))
}

function writeStandardFiles(dir: string) {
  return FSUtil.Service.use((fs) =>
    Effect.all([
      fs.writeWithDirs(path.join(dir, "hello.txt"), "hello"),
      fs.writeWithDirs(path.join(dir, "needle.ts"), "export const needle = 'sdk-parity'\n"),
    ]).pipe(Effect.asVoid),
  )
}

function writeProjectSkill(dir: string) {
  return FSUtil.Service.use((fs) =>
    fs.writeWithDirs(
      path.join(dir, ".opennovel", "skills", "project-rest-skill", "SKILL.md"),
      `---
name: project-rest-skill
description: A project skill visible to REST API prompts.
---

# Project REST Skill
`,
    ),
  )
}

afterEach(async () => {
  Flag.OPENNOVEL_SERVER_PASSWORD = original.OPENNOVEL_SERVER_PASSWORD
  Flag.OPENNOVEL_SERVER_USERNAME = original.OPENNOVEL_SERVER_USERNAME
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi SDK", () => {
  httpapi(
    "uses the generated SDK for global and control routes",
    Effect.gen(function* () {
      const sdk = yield* client("raw")
      const health = yield* call(() => sdk.global.health())
      const log = yield* call(() => sdk.app.log({ service: "httpapi-sdk-test", level: "info", message: "hello" }))

      expect(health.response!.status).toBe(200)
      expect(health.data).toMatchObject({ healthy: true })
      expect(yield* firstEvent((signal) => sdk.global.event({ signal }))).toMatchObject({
        payload: { type: "server.connected" },
      })
      expect(log.response!.status).toBe(200)
      expect(log.data).toBe(true)
      yield* expectStatus(() => sdk.auth.set({ providerID: "test" }), 400)
    }),
  )

  httpapiInstance(
    "uses the generated SDK for safe instance routes",
    { serverPath: "raw", git: false, setup: writeStandardFiles },
    ({ sdk, directory }) =>
      Effect.gen(function* () {
        const file = yield* call(() => sdk.file.read({ path: "hello.txt" }))
        const session = yield* call(() => sdk.v2.session.create({ agent: "build", location: { directory } }))
        const listed = yield* call(() => sdk.v2.session.list({ roots: true, limit: 10 }))

        // bun 的 toMatchObject 会把非对称匹配器写回被测对象，先取 id 再断言。
        const sessionID = session.data?.data.id

        expect(file.response!.status).toBe(200)
        expect(file.data).toMatchObject({ content: "hello" })
        expect(session.response!.status).toBe(200)
        expect(typeof sessionID).toBe("string")
        expect(listed.response!.status).toBe(200)
        expect(listed.data?.data.map((item) => item.id)).toContain(sessionID)

        yield* Effect.all([
          expectStatus(() => sdk.project.current(), 200),
          expectStatus(() => sdk.config.get(), 200),
          expectStatus(() => sdk.config.providers(), 200),
          expectStatus(() => sdk.find.files({ query: "hello", limit: 10 }), 200),
        ])
      }),
  )

  httpapi(
    "routes configured SDK directory and workspace for v2 location GETs",
    withProject("raw", { setup: writeStandardFiles }, ({ directory }) =>
      Effect.gen(function* () {
        const workspaceID = "wrk_sdk"
        let request: Request | undefined
        const sdk = yield* client("raw", directory, {
          workspaceID,
          onRequest: (value) => (request = value),
        })
        const found = yield* pollWithTimeout(
          call(() => sdk.v2.fs.find({ query: "hello", type: "file" })).pipe(
            Effect.map((result) =>
              result.data?.data.some((item) => item.path === "hello.txt") ? result : undefined,
            ),
          ),
          "SDK file search index was not ready",
        )
        const url = new URL(request!.url)

        expect(found.response!.status).toBe(200)
        expect(found.data?.data.find((item) => item.path === "hello.txt")).toMatchObject({
          path: "hello.txt",
          type: "file",
        })
        expect(url.searchParams.get("directory")).toBe(directory)
        expect(url.searchParams.get("workspace")).toBe(workspaceID)
        expect(url.searchParams.get("location[directory]")).toBe(directory)
        expect(url.searchParams.get("location[workspace]")).toBe(workspaceID)
        expect(request!.headers.has("x-opennovel-directory")).toBe(false)
        expect(request!.headers.has("x-opennovel-workspace")).toBe(false)
      }),
    ),
  )

  serverPathParity("matches generated SDK global and control behavior", (serverPath) =>
    Effect.gen(function* () {
      const sdk = yield* client(serverPath)
      const health = yield* capture(() => sdk.global.health())
      const log = yield* capture(() => sdk.app.log({ service: "sdk-parity", level: "info", message: "hello" }))
      const invalidAuth = yield* capture(() => sdk.auth.set({ providerID: "test" }))

      return {
        statuses: statuses({ health, log, invalidAuth }),
        health: record(health.data).healthy,
        log: log.data,
      }
    }),
  )

  serverPathParity("matches generated SDK global event stream", (serverPath) =>
    Effect.gen(function* () {
      const sdk = yield* client(serverPath)
      const event = yield* firstEvent((signal) => sdk.global.event({ signal }))
      return { type: record(record(event).payload).type }
    }),
  )

  serverPathParity("matches generated SDK instance event stream", (serverPath) =>
    withStandardProject(serverPath, ({ sdk }) =>
      firstEvent((signal) => sdk.event.subscribe(undefined, { signal })).pipe(
        Effect.map((event) => ({ type: record(record(event).payload).type })),
      ),
    ),
  )

  serverPathParity("matches generated SDK missing session errors", (serverPath) =>
    withStandardProject(serverPath, ({ sdk }) =>
      Effect.gen(function* () {
        const sessionID = "ses_missing"
        const expected = {
          _tag: "SessionNotFoundError",
          sessionID,
          message: `Session not found: ${sessionID}`,
        }
        const missing = yield* capture(() => sdk.v2.session.get({ sessionID }))
        const thrown = yield* captureThrown(() => sdk.v2.session.get({ sessionID }, { throwOnError: true }))

        // Result-tuple path: error body is preserved as-is so existing
        // consumers reading `result.error` / `JSON.stringify(error)`
        // keep working byte-for-byte.
        expect(missing.status).toBe(404)
        expect(missing.error).toEqual(expected)
        // throwOnError path: SDK wraps the body in a real Error with the
        // server's message, with the original parsed body preserved under
        // `.cause.body`.
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toBe(expected.message)
        expect(((thrown as Error).cause as { body: unknown }).body).toEqual(expected)
        return {
          status: missing.status,
          error: missing.error,
          thrown,
        }
      }),
    ),
  )

  serverPathParity("formats missing session validation errors for -s", (serverPath) =>
    withStandardProject(serverPath, ({ directory }) =>
      Effect.gen(function* () {
        const sessionID = "ses_206f84f18ffeZ6hhD7pFYAiW5T"
        const fetch = yield* serverFetch(serverPath)
        const thrown = yield* captureThrown(() =>
          validateSession({
            url: "http://localhost",
            directory,
            sessionID,
            fetch,
          }),
        )
        expect(errorMessage(thrown)).toBe(`Session not found: ${sessionID}`)
        return errorMessage(thrown)
      }),
    ),
  )

  httpapiInstance(
    "uses generated SDK basic auth behavior",
    { serverPath: "raw", setup: writeStandardFiles },
    ({ directory }) =>
      Effect.gen(function* () {
        const missingSdk = yield* client("raw", directory, { password: "secret" })
        const missing = yield* capture(() => missingSdk.file.read({ path: "hello.txt" }))
        const badSdk = yield* client("raw", directory, {
          password: "secret",
          headers: { authorization: authorization("opennovel", "wrong") },
        })
        const bad = yield* capture(() => badSdk.file.read({ path: "hello.txt" }))
        const goodSdk = yield* client("raw", directory, {
          password: "secret",
          headers: { authorization: authorization("opennovel", "secret") },
        })
        const good = yield* capture(() => goodSdk.file.read({ path: "hello.txt" }))

        return {
          statuses: statuses({ missing, bad, good }),
          content: record(good.data).content,
        }
      }),
  )

  serverPathParity("matches generated SDK instance read routes", (serverPath) =>
    withProject(serverPath, { git: true, setup: writeStandardFiles }, ({ sdk, directory }) =>
      Effect.gen(function* () {
        const project = yield* capture(() => sdk.project.current())
        const projects = yield* capture(() => sdk.project.list())
        const paths = yield* capture(() => sdk.path.get())
        const config = yield* capture(() => sdk.config.get())
        const providers = yield* capture(() => sdk.config.providers())
        const file = yield* capture(() => sdk.file.read({ path: "hello.txt" }))
        const files = yield* capture(() => sdk.file.list({ path: "." }))
        const fileStatus = yield* capture(() => sdk.file.status())
        const findFiles = yield* capture(() => sdk.find.files({ query: "hello", limit: 10 }))
        const findText = yield* capture(() => sdk.find.text({ pattern: "sdk-parity" }))
        const agents = yield* capture(() => sdk.app.agents())
        const skills = yield* capture(() => sdk.app.skills())
        const tools = yield* capture(() => sdk.tool.ids())
        const vcs = yield* capture(() => sdk.vcs.get())
        const formatter = yield* capture(() => sdk.formatter.status())
        const lsp = yield* capture(() => sdk.lsp.status())

        return {
          statuses: statuses({
            project,
            projects,
            paths,
            config,
            providers,
            file,
            files,
            fileStatus,
            findFiles,
            findText,
            agents,
            skills,
            tools,
            vcs,
            formatter,
            lsp,
          }),
          project: { worktreeSelected: record(project.data).worktree === directory },
          paths: { directorySelected: record(paths.data).directory === directory },
          file: record(file.data).content,
          hasProject: array(projects.data).length > 0,
          foundFile: JSON.stringify(findFiles.data).includes("hello.txt"),
          foundText: JSON.stringify(findText.data ?? null).includes("sdk-parity"),
          listedFile: JSON.stringify(files.data).includes("hello.txt"),
          vcs: { hasBranch: typeof record(vcs.data).branch === "string" },
        }
      }),
    ),
  )

  serverPathParity("matches generated SDK prompt streaming through fake LLM", (serverPath) =>
    withFakeLlm(serverPath, ({ sdk, llm, directory }) =>
      Effect.gen(function* () {
        yield* llm.text("fake world", { usage: { input: 11, output: 7 } })
        yield* awaitTestModel(sdk)
        const session = yield* capture(() =>
          sdk.v2.session.create({
            agent: "build",
            model: { id: "test-model", providerID: "test" },
            location: { directory },
          }),
        )
        const sessionID = String(record(record(session.data).data).id)
        const prompt = yield* capture(() => sdk.v2.session.prompt({ sessionID, prompt: { text: "hello llm" } }))
        const waited = yield* capture(() => sdk.v2.session.wait({ sessionID }))
        const messages = yield* capture(() => sdk.v2.session.messages({ sessionID }))
        const inputs = yield* llm.inputs

        expect(session.status).toBe(200)
        expect(prompt.status).toBe(200)
        expect(waited.status).toBe(204)
        expect(messages.status).toBe(200)
        expect(inputs.length).toBe(1)
        expect(inputs[0]?.model).toBe("test-model")
        expect(JSON.stringify(messages.data)).toContain("fake world")
        expect(JSON.stringify(messages.data)).toContain("hello llm")
        return {
          statuses: statuses({ session, prompt, messages }),
          calls: inputs.length,
          requestedModel: inputs[0]?.model,
        }
      }),
    ),
  )

  httpapi(
    "includes project skills in REST API prompt context",
    withFakeLlmProject("default", { setup: writeProjectSkill }, ({ sdk, llm, directory }) =>
      Effect.gen(function* () {
        yield* llm.text("skill context ok", { usage: { input: 11, output: 7 } })
        yield* awaitTestModel(sdk)
        const session = yield* capture(() =>
          sdk.v2.session.create({
            agent: "build",
            model: { id: "test-model", providerID: "test" },
            location: { directory },
          }),
        )
        const sessionID = String(record(record(session.data).data).id)
        const prompt = yield* capture(() =>
          sdk.v2.session.prompt({ sessionID, prompt: { text: "hello skill context" } }),
        )
        const waited = yield* capture(() => sdk.v2.session.wait({ sessionID }))
        const inputs = yield* llm.inputs

        expect(session.status).toBe(200)
        expect(prompt.status).toBe(200)
        expect(waited.status).toBe(204)
        expect(JSON.stringify(inputs[0])).toContain("project-rest-skill")
      }),
    ),
  )

  serverPathParity("matches generated SDK project git initialization", (serverPath) =>
    withProject(serverPath, {}, ({ sdk, directory }) =>
      Effect.gen(function* () {
        const before = yield* capture(() => sdk.project.current())
        const init = yield* capture(() => sdk.project.initGit())
        const after = yield* capture(() => sdk.project.current())

        return {
          statuses: statuses({ before, init, after }),
          before: {
            vcs: record(before.data).vcs ?? null,
            worktree: record(before.data).worktree,
          },
          init: {
            vcs: record(init.data).vcs,
            worktreeSelected: record(init.data).worktree === directory,
          },
          after: {
            vcs: record(after.data).vcs,
            worktreeSelected: record(after.data).worktree === directory,
          },
        }
      }),
    ),
  )
})
