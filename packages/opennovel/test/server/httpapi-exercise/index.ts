/**
 * End-to-end exerciser for the Effect HttpApi routes.
 *
 * The goal is not to be a normal unit test file. This is a route-coverage harness:
 * every public route should have a small scenario that proves the route decodes
 * requests, uses the right instance context, mutates storage when expected, and
 * returns the expected response shape.
 *
 * The script intentionally isolates `OPENNOVEL_DB` before importing modules that touch
 * storage. Scenarios may create/delete sessions and reset the database after each run,
 * so this must never point at a developer's real session database.
 *
 * DSL shape:
 * - `http.protected.get/post/...` starts a scenario for one OpenAPI route key.
 * - `.seeded(...)` creates typed per-scenario state using Effect helpers on `ctx`.
 * - `.at(...)` builds the request from that typed state.
 * - `.json(...)` / `.jsonEffect(...)` assert response shape and optional side effects.
 * - `.mutating()` tells the runner to reset isolated state after destructive routes.
 */
import { Effect } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import path from "path"
import { array, check, isRecord, message, object } from "./assertions"
import { controlledPtyInput, http, route } from "./dsl"
import {
  cleanupExercisePaths,
  exerciseConfigDirectory,
  exerciseDataDirectory,
  exerciseDatabasePath,
  exerciseGlobalRoot,
} from "./environment"
import { color, printHeader, printResults } from "./report"
import { coverageResult, parseOptions, routeKey, routeKeys, selectedScenarios } from "./routing"
import { runScenario } from "./runner"
import { disposeApps } from "./backend"
import { runtime } from "./runtime"
import { type Scenario, type ScenarioContext } from "./types"
import {
  createCharacterMapPin,
  createWorldMap,
  createWorldMapFeature,
  getDb,
  PendingSettingTable,
  StagedChangeTable,
  uploadSettingImage,
  WorldEntryConflictTable,
} from "@opennovel-ai/novel-store"
import {
  createNovel,
  bindSession,
  createChapterEndpoint,
  updateChapterContent,
  submitApproval,
  createVolumeEndpoint,
  createCharacter,
  createCharacterStateEndpoint,
  createRelationshipEndpoint,
  createTensionPoint,
  createPlotThread,
  createForeshadowing,
  createWorldEntry,
  createAnnotationEndpoint,
  createAnnotationRoundEndpoint,
  updateOutline,
  updateStyleGuideEndpoint,
} from "@opennovel-ai/server/handlers/novel"

function cursor(input: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(input)).toString("base64url")
}

function data(validate: (value: any) => void) {
  return (body: any) => {
    object(body)
    validate(body.data)
  }
}

function locationData(validate: (value: any) => void) {
  return (body: any) => {
    object(body)
    object(body.location)
    object(body.location.project)
    validate(body.data)
  }
}

const scenarios: Scenario[] = [
  http.protected
    .get("/global/health", "global.health")
    .global()
    .json(200, (body) => {
      object(body)
      check(body.healthy === true, "server should report healthy")
    }),
  http.protected
    .get("/global/event", "global.event")
    .global()
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "global event should be an SSE stream")
          check(result.text.includes("server.connected"), "global event should emit initial connection event")
        }),
      "status",
    ),
  http.protected.get("/global/config", "global.config.get").global().json(),
  http.protected
    .patch("/global/config", "global.config.update")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseConfigDirectory, "opennovel.jsonc"),
          JSON.stringify({ username: "httpapi-global" }, null, 2),
        ),
      ),
    )
    .at(() => ({ path: "/global/config", body: { username: "httpapi-global" } }))
    .jsonEffect(
      200,
      (body) =>
        Effect.gen(function* () {
          object(body)
          check(body.username === "httpapi-global", "global config update should return patched config")
          const text = yield* Effect.promise(() =>
            Bun.file(path.join(exerciseConfigDirectory, "opennovel.jsonc")).text(),
          )
          check(text.includes('"username": "httpapi-global"'), "global config update should write isolated config file")
        }),
      "status",
    ),
  http.protected
    .post("/global/dispose", "global.dispose")
    .global()
    .mutating()
    .json(
      200,
      (body) => {
        check(body === true, "global dispose should return true")
      },
      "status",
    ),
  http.protected.get("/path", "path.get").json(200, (body, ctx) => {
    object(body)
    check(body.directory === ctx.directory, "directory should resolve from x-opennovel-directory")
    check(body.worktree === ctx.directory, "worktree should resolve from x-opennovel-directory")
  }),
  http.protected.get("/vcs", "vcs.get").json(),
  http.protected.get("/vcs/status", "vcs.status").json(200, array),
  http.protected
    .get("/vcs/diff", "vcs.diff")
    .at((ctx) => ({ path: "/vcs/diff?mode=git", headers: ctx.headers() }))
    .json(200, array),
  http.protected.get("/vcs/diff/raw", "vcs.diff.raw").status(
    200,
    (_ctx, result) =>
      Effect.sync(() => {
        check(typeof result.text === "string", "raw VCS diff should return text")
      }),
    "status",
  ),
  http.protected
    .post("/vcs/apply", "vcs.apply")
    .inProject({ git: false })
    .at((ctx) => ({ path: "/vcs/apply", headers: ctx.headers(), body: { patch: "" } }))
    .status(400, undefined, "status"),
  http.protected.get("/skill", "app.skills").json(200, array, "status"),
  http.protected.get("/lsp", "lsp.status").json(200, array),
  http.protected.get("/formatter", "formatter.status").json(200, array),
  http.protected.get("/config", "config.get").json(200, undefined, "status"),
  http.protected
    .patch("/config", "config.update")
    .mutating()
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: "httpapi-local" } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.username === "httpapi-local", "local config update should return patched config")
      },
      "status",
    ),
  http.protected
    .patch("/config", "config.update.invalid")
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: 1 } }))
    .status(400),
  http.protected.get("/config/providers", "config.providers").json(),
  http.protected.get("/project", "project.list").json(200, array, "status"),
  http.protected.get("/project/current", "project.current").json(
    200,
    (body, ctx) => {
      object(body)
      check(body.worktree === ctx.directory, "current project should resolve from scenario directory")
    },
    "status",
  ),
  http.protected
    .patch("/project/{projectID}", "project.update")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/project/{projectID}", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: { name: "HTTP API Project", commands: { start: "bun --version" } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.name === "HTTP API Project", "project update should return patched name")
        check(
          isRecord(body.commands) && body.commands.start === "bun --version",
          "project update should return patched command",
        )
      },
      "status",
    ),
  http.protected
    .patch("/project/{projectID}", "project.update.missing")
    .mutating()
    .at((ctx) => ({
      path: route("/project/{projectID}", { projectID: "project_httpapi_missing" }),
      headers: ctx.headers(),
      body: { name: "Missing Project" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/project/git/init", "project.initGit")
    .mutating()
    .inProject({ git: false })
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.worktree === ctx.directory, "git init should return current project")
        check(body.vcs === "git", "git init should mark the project as git-backed")
      },
      "status",
    ),
  http.protected
    .get("/project/{projectID}/directories", "project.directories")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/project/{projectID}/directories", { projectID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, array, "status"),
  http.protected
    .post("/experimental/project/{projectID}/copy/generate-name", "experimental.projectCopy.generateName")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy/generate-name", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => {
      object(body)
      check(typeof body.name === "string" && body.name.length > 0, "generated copy name should be non-empty")
    }),
  http.protected
    .post("/experimental/project/{projectID}/copy", "experimental.projectCopy.create")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .delete("/experimental/project/{projectID}/copy", "experimental.projectCopy.remove")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .post("/experimental/project/{projectID}/copy/refresh", "experimental.projectCopy.refresh")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy/refresh", { projectID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected.get("/provider", "provider.list").json(),
  http.protected.get("/provider/auth", "provider.auth").json(),
  http.protected
    .post("/provider/{providerID}/oauth/authorize", "provider.oauth.authorize")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/authorize", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http.protected
    .post("/provider/{providerID}/oauth/callback", "provider.oauth.callback")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/callback", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http.protected
    .get("/file", "file.list")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file?${new URLSearchParams({ path: "." })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/file/content", "file.read")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "hello.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.content === "hello", `content should match seeded file: ${JSON.stringify(body)}`)
    }),
  http.protected
    .get("/file/content", "file.read.missing")
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "missing.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.type === "text" && body.content === "", "missing file content should return an empty text result")
    }),
  http.protected.get("/file/status", "file.status").json(200, array),
  http.protected
    .get("/find", "find.text")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/find?${new URLSearchParams({ pattern: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/find/file", "find.files")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({
      path: `/find/file?${new URLSearchParams({ query: "hello", dirs: "false" })}`,
      headers: ctx.headers(),
    }))
    .json(200, array),
  http.protected
    .get("/find/symbol", "find.symbols")
    .seeded((ctx) => ctx.file("hello.ts", "export const hello = 1\n"))
    .at((ctx) => ({ path: `/find/symbol?${new URLSearchParams({ query: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/event", "event.stream")
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "event should be an SSE stream")
          check(result.text.includes("server.connected"), "event should emit initial connection event")
        }),
      "status",
    ),
  http.protected.get("/mcp", "mcp.status").json(),
  http.protected
    .post("/mcp", "mcp.add")
    .mutating()
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-disabled", config: { type: "local", command: ["bun", "--version"], enabled: false } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body["httpapi-disabled"])
        check(body["httpapi-disabled"].status === "disabled", "disabled MCP server should be added without spawning")
      },
      "status",
    ),
  http.protected
    .post("/mcp", "mcp.add.invalid")
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-invalid", config: { type: "invalid" } },
    }))
    .status(400),
  http.protected
    .post("/mcp/{name}/auth", "mcp.auth.start")
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .delete("/mcp/{name}/auth", "mcp.auth.remove")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/auth/authenticate", "mcp.auth.authenticate")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/authenticate", { name: "httpapi-missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/auth/callback", "mcp.auth.callback")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/callback", { name: "httpapi-missing" }),
      headers: ctx.headers(),
      body: { code: "code" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/connect", "mcp.connect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/connect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/disconnect", "mcp.disconnect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/disconnect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected.get("/pty/shells", "pty.shells").json(200, array),
  http.protected.get("/pty", "pty.list").json(200, array),
  http.protected
    .post("/pty", "pty.create")
    .mutating()
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: controlledPtyInput("HTTP API PTY") }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.title === "HTTP API PTY", "PTY create should return requested title")
        check(body.command === process.execPath, "PTY create should use controlled shell command")
        check(body.cwd === ctx.directory, "PTY create should default cwd to scenario directory")
      },
      "status",
    ),
  http.protected
    .post("/pty", "pty.create.invalid")
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: { command: 1 } }))
    .status(400),
  http.protected
    .post("/pty/{ptyID}/connect-token", "pty.connectToken.invalid")
    .at((ctx) => ({
      path: route("/pty/{ptyID}/connect-token", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(403, undefined, "status"),
  http.protected
    .get("/pty/{ptyID}", "pty.get")
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404),
  http.protected
    .put("/pty/{ptyID}", "pty.update")
    .mutating()
    .at((ctx) => ({
      path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
      body: { size: { rows: 0, cols: 0 } },
    }))
    .status(400),
  http.protected
    .delete("/pty/{ptyID}", "pty.remove")
    .mutating()
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .get("/pty/{ptyID}/connect", "pty.connect")
    .at((ctx) => ({ path: route("/pty/{ptyID}/connect", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404, undefined, "none"),
  http.protected.get("/experimental/console", "experimental.console.get").json(),
  http.protected.get("/experimental/console/orgs", "experimental.console.listOrgs").json(),
  http.protected
    .post("/experimental/console/switch", "experimental.console.switchOrg")
    .at((ctx) => ({
      path: "/experimental/console/switch",
      headers: ctx.headers(),
      body: { accountID: "httpapi-account", orgID: "httpapi-org" },
    }))
    .status(400, undefined, "none"),
  http.protected.get("/experimental/workspace/adapter", "experimental.workspace.adapter.list").json(200, array),
  http.protected.get("/experimental/workspace", "experimental.workspace.list").json(200, array),
  http.protected.get("/experimental/workspace/status", "experimental.workspace.status").json(200, array),
  http.protected
    .post("/experimental/workspace", "experimental.workspace.create")
    .at((ctx) => ({ path: "/experimental/workspace", headers: ctx.headers(), body: {} }))
    .status(400),
  http.protected
    .post("/experimental/workspace/sync-list", "experimental.workspace.syncList")
    .status(204, undefined, "status"),
  http.protected
    .delete("/experimental/workspace/{id}", "experimental.workspace.remove")
    .mutating()
    .at((ctx) => ({
      path: route("/experimental/workspace/{id}", { id: "wrk_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(200),
  http.protected
    .post("/experimental/workspace/warp", "experimental.workspace.warp")
    .at((ctx) => ({
      path: "/experimental/workspace/warp",
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .post("/experimental/control-plane/move-session", "experimental.controlPlane.moveSession")
    .global()
    .at(() => ({
      path: "/experimental/control-plane/move-session",
      body: {},
    }))
    .status(400),
  http.protected.get("/experimental/worktree", "worktree.list").json(200, array),
  http.protected
    .post("/experimental/worktree", "worktree.create")
    .mutating()
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: "api-dsl" } }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(typeof body.directory === "string", "created worktree should include directory")
          yield* ctx.worktreeRemove(body.directory)
        }),
      "status",
    ),
  http.protected
    .post("/experimental/worktree", "worktree.create.invalid")
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: 1 } }))
    .status(400),
  http.protected
    .delete("/experimental/worktree", "worktree.remove")
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-remove" }))
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { directory: ctx.state.directory } }))
    .json(200, (body) => {
      check(body === true, "worktree remove should return true")
    }),
  http.protected
    .post("/experimental/worktree/reset", "worktree.reset")
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-reset" }))
    .at((ctx) => ({
      path: "/experimental/worktree/reset",
      headers: ctx.headers(),
      body: { directory: ctx.state.directory },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "worktree reset should return true")
        yield* ctx.worktreeRemove(ctx.state.directory)
      }),
    ),
  http.protected.get("/experimental/resource", "experimental.resource.list").json(),
  http.protected
    .post("/instance/dispose", "instance.dispose")
    .mutating()
    .json(200, (body) => {
      check(body === true, "instance dispose should return true")
    }),
  http.protected
    .post("/log", "app.log")
    .global()
    .at(() => ({ path: "/log", body: { service: "httpapi-exercise", level: "info", message: "route coverage" } }))
    .json(200, (body) => {
      check(body === true, "log route should return true")
    }),
  http.protected
    .put("/auth/{providerID}", "auth.set")
    .global()
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }), body: { type: "api", key: "test-key" } }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth set should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(isRecord(auth.test) && auth.test.key === "test-key", "auth set should write isolated auth file")
      }),
    ),
  http.protected
    .delete("/auth/{providerID}", "auth.remove")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseDataDirectory, "auth.json"),
          JSON.stringify({ test: { type: "api", key: "remove-me" } }),
        ),
      ),
    )
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }) }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth remove should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(auth.test === undefined, "auth remove should delete provider from isolated auth file")
      }),
    ),
  http.protected.get("/api/health", "v2.health.get").json(200, (body) => {
    object(body)
    check(body.healthy === true, "v2 server should report healthy")
  }),
  http.protected.get("/api/location", "v2.location.get").json(200, object),
  http.protected.get("/api/agent", "v2.agent.list").json(200, locationData(array)),
  http.protected.get("/api/model", "v2.model.list").json(200, locationData(array)),
  http.protected.get("/api/provider", "v2.provider.list").json(200, locationData(array)),
  http.protected.get("/api/integration", "v2.integration.list").json(200, locationData(array)),
  http.protected
    .get("/api/integration/{integrationID}", "v2.integration.get")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}", { integrationID: "missing" }),
      headers: ctx.headers(),
    }))
    .json(200, object),
  http.protected
    .post("/api/integration/{integrationID}/connect/key", "v2.integration.connect.key")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}/connect/key", { integrationID: "missing" }),
      headers: ctx.headers(),
      body: { key: "test" },
    }))
    .status(500, undefined, "status"),
  http.protected
    .post("/api/integration/{integrationID}/connect/oauth", "v2.integration.connect.oauth")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}/connect/oauth", { integrationID: "missing" }),
      headers: ctx.headers(),
      body: { methodID: "missing", inputs: {} },
    }))
    .status(500, undefined, "status"),
  http.protected
    .get("/api/integration/attempt/{attemptID}", "v2.integration.attempt.status")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}", { attemptID: "con_missing" }),
      headers: ctx.headers(),
    }))
    .status(500, undefined, "status"),
  http.protected
    .post("/api/integration/attempt/{attemptID}/complete", "v2.integration.attempt.complete")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}/complete", { attemptID: "con_missing" }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(500, undefined, "status"),
  http.protected
    .delete("/api/integration/attempt/{attemptID}", "v2.integration.attempt.cancel")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}", { attemptID: "con_missing" }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected
    .delete("/api/credential/{credentialID}", "v2.credential.remove")
    .at((ctx) => ({
      path: route("/api/credential/{credentialID}", { credentialID: "cred_missing" }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected
    .patch("/api/credential/{credentialID}", "v2.credential.update")
    .at((ctx) => ({
      path: route("/api/credential/{credentialID}", { credentialID: "cred_missing" }),
      headers: ctx.headers(),
      body: { label: "Work" },
    }))
    .status(204, undefined, "status"),
  http.protected.get("/api/command", "v2.command.list").json(200, locationData(array)),
  http.protected.get("/api/skill", "v2.skill.list").json(200, locationData(array)),
  http.protected
    .get("/api/event", "v2.event.subscribe")
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "v2 event should be an SSE stream")
          check(result.text.includes("server.connected"), "v2 event should emit initial connection event")
          check(!result.text.includes('"location"'), "v2 connection event should not be scoped to a location")
        }),
      "status",
    ),
  http.protected
    .get("/api/fs/read/*", "v2.fs.read")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: "/api/fs/read/hello.txt", headers: ctx.headers() }))
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.text === "hello\n", "v2 fs read should return the file body")
          check(result.contentType.includes("text/plain"), "v2 fs read should return the file content type")
        }),
      "status",
    ),
  http.protected.get("/api/fs/list", "v2.fs.list").json(200, locationData(array)),
  http.protected
    .get("/api/fs/find", "v2.fs.find")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: "/api/fs/find?query=hello&type=file", headers: ctx.headers() }))
    .json(200, locationData(array)),
  http.protected.get("/api/pty", "v2.pty.list").json(200, locationData(array)),
  http.protected
    .post("/api/pty", "v2.pty.create")
    .mutating()
    .at((ctx) => ({ path: "/api/pty", headers: ctx.headers(), body: controlledPtyInput("HTTP API V2 PTY") }))
    .json(200, locationData(object)),
  http.protected
    .get("/api/pty/{ptyID}", "v2.pty.get")
    .at((ctx) => ({ path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .put("/api/pty/{ptyID}", "v2.pty.update")
    .mutating()
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
      body: { title: "missing" },
    }))
    .json(404, object, "status"),
  http.protected
    .delete("/api/pty/{ptyID}", "v2.pty.remove")
    .mutating()
    .at((ctx) => ({ path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/api/pty/{ptyID}/connect-token", "v2.pty.connectToken")
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}/connect-token", { ptyID: "pty_httpapi_missing" }),
      headers: { ...ctx.headers(), "x-opennovel-ticket": "1" },
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/pty/{ptyID}/connect", "v2.pty.connect")
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}/connect", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "none"),
  http.protected.get("/api/reference", "v2.reference.list").json(200, object),
  http.protected
    .get("/api/provider/{providerID}", "v2.provider.get")
    .at((ctx) => ({ path: route("/api/provider/{providerID}", { providerID: "missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected.get("/api/permission/request", "v2.permission.request.list").json(200, (body) => {
    object(body)
    object(body.location)
    array(body.data)
  }),
  http.protected.get("/api/question/request", "v2.question.request.list").json(200, (body) => {
    object(body)
    object(body.location)
    array(body.data)
  }),
  http.protected
    .post("/api/session/{sessionID}/permission", "v2.session.permission.create")
    .seeded((ctx) => ctx.session({ title: "Permission create owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { action: "read", resources: [".env"] },
    }))
    .json(200, (body) => {
      object(body)
      object(body.data)
      check(typeof body.data.id === "string", "permission create should return an ID")
      check(body.data.effect === "ask", "permission create should create a pending request")
    }),
  http.protected
    .get("/api/session/{sessionID}/permission", "v2.session.permission.list")
    .seeded((ctx) => ctx.session({ title: "Permission list owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .get("/api/session/{sessionID}/permission/{requestID}", "v2.session.permission.get")
    .seeded((ctx) => ctx.session({ title: "Permission get owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission/{requestID}", {
        sessionID: ctx.state.id,
        requestID: "per_httpapi_missing",
      }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/question", "v2.session.question.list")
    .seeded((ctx) => ctx.session({ title: "Question list owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .post("/api/session/{sessionID}/permission/{requestID}/reply", "v2.session.permission.reply")
    .seeded((ctx) => ctx.session({ title: "Permission owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission/{requestID}/reply", {
        sessionID: ctx.state.id,
        requestID: "per_httpapi_missing",
      }),
      headers: ctx.headers(),
      body: { reply: "once" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/question/{requestID}/reply", "v2.session.question.reply")
    .seeded((ctx) => ctx.session({ title: "Question reply owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question/{requestID}/reply", {
        sessionID: ctx.state.id,
        requestID: "que_httpapi_missing",
      }),
      headers: ctx.headers(),
      body: { answers: [] },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/question/{requestID}/reject", "v2.session.question.reject")
    .seeded((ctx) => ctx.session({ title: "Question reject owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question/{requestID}/reject", {
        sessionID: ctx.state.id,
        requestID: "que_httpapi_missing",
      }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected.get("/api/permission/saved", "v2.permission.saved.list").json(200, (body) => {
    object(body)
    array(body.data)
  }),
  http.protected
    .delete("/api/permission/saved/{id}", "v2.permission.saved.remove")
    .at((ctx) => ({ path: route("/api/permission/saved/{id}", { id: "psv_httpapi_missing" }), headers: ctx.headers() }))
    .status(204, undefined, "status"),
  http.protected
    .get("/api/session", "v2.session.list")
    .at((ctx) => ({ path: "/api/session?roots=true", headers: ctx.headers() }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.filters")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        limit: "2",
        order: "asc",
        path: ".",
        roots: "false",
        start: "0",
        search: "missing",
        directory: ctx.directory ?? "",
      })}`,
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.cursor")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        limit: "2",
        cursor: cursor({
          order: "desc",
          directory: ctx.directory,
          anchor: { id: "ses_httpapi_missing", time: 0, direction: "next" },
        }),
      })}`,
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.cursor.invalid")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        cursor: "invalid",
      })}`,
      headers: ctx.headers(),
    }))
    .status(400, undefined, "none"),
  http.protected.get("/api/session/active", "v2.session.active").json(200, data(object), "none"),
  http.protected
    .post("/api/session", "v2.session.create")
    .at((ctx) => ({
      path: "/api/session",
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: {},
    }))
    .json(200, data(object)),
  http.protected
    .get("/api/session/{sessionID}", "v2.session.get")
    .seeded((ctx) => ctx.session({ title: "Session get" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(object)),
  http.protected
    .post("/api/session/{sessionID}/agent", "v2.session.switchAgent")
    .seeded((ctx) => ctx.session({ title: "Switch agent" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/agent", { sessionID: ctx.state.id }),
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: { agent: "plan" },
    }))
    .status(204, undefined, "none"),
  http.protected
    .post("/api/session/{sessionID}/model", "v2.session.switchModel")
    .seeded((ctx) => ctx.session({ title: "Switch model" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/model", { sessionID: ctx.state.id }),
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: { model: { providerID: "opennovel", id: "big-pickle" } },
    }))
    .status(204, undefined, "none"),
  http.protected
    .get("/api/session/{sessionID}/context", "v2.session.context")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/context", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/revert/stage", "v2.session.revert.stage")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/revert/stage", { sessionID: "ses_httpapi_missing" }),
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: { messageID: "msg_httpapi_missing" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/revert/clear", "v2.session.revert.clear")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/revert/clear", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/revert/commit", "v2.session.revert.commit")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/revert/commit", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.params")
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" })}?${new URLSearchParams({
        limit: "2",
        order: "asc",
      })}`,
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.cursor")
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" })}?${new URLSearchParams({
        limit: "2",
        directory: ctx.directory ?? "",
        cursor: cursor({ id: "msg_httpapi_missing", time: 0, order: "desc", direction: "next" }),
      })}`,
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.cursor.invalid")
    .seeded((ctx) => ctx.session({ title: "Invalid message cursor owner" }))
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: ctx.state.id })}?${new URLSearchParams({
        cursor: cursor({ id: "msg_httpapi_missing", time: 0, order: "desc", direction: "next" }),
        order: "asc",
      })}`,
      headers: ctx.headers(),
    }))
    .status(400, undefined, "none"),
  http.protected
    .get("/api/session/{sessionID}/history", "v2.session.history")
    .seeded((ctx) => ctx.session({ title: "Session history" }))
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/history", { sessionID: ctx.state.id })}?${new URLSearchParams({
        after: "0",
        limit: "2",
      })}`,
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        check(typeof body.hasMore === "boolean", "Expected a history exhaustion signal")
      },
      "none",
    ),
  http.protected
    .get("/api/session/{sessionID}/history", "v2.session.history.missing")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/history", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/history", "v2.session.history.invalid")
    .seeded((ctx) => ctx.session({ title: "Invalid history sequence" }))
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/history", { sessionID: ctx.state.id })}?after=-1`,
      headers: ctx.headers(),
    }))
    .json(400, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/event", "v2.session.events.missing")
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/event", { sessionID: "ses_httpapi_missing" })}?after=0`,
      headers: ctx.headers(),
    }))
    .status(404, undefined, "status"),
  http.protected
    .post("/api/session/{sessionID}/interrupt", "v2.session.interrupt")
    .seeded((ctx) => ctx.session({ title: "Interrupt session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/interrupt", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "none"),
  http.protected
    .get("/api/session/{sessionID}/message/{messageID}", "v2.session.message.missing")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/message/{messageID}", {
        sessionID: "ses_httpapi_missing",
        messageID: "msg_httpapi_missing",
      }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/prompt", "v2.session.prompt.invalid")
    .seeded((ctx) => ctx.session({ title: "Invalid prompt owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/prompt", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/api/session/{sessionID}/compact", "v2.session.compact")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/compact", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "status"),
  http.protected
    .post("/api/session/{sessionID}/wait", "v2.session.wait")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/wait", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "status"),
  http.protected
    .patch("/api/session/{sessionID}", "v2.session.update")
    .seeded((ctx) => ctx.session({ title: "Update session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: { title: "renamed session" },
    }))
    .json(200, data(object)),
  http.protected
    .delete("/api/session/{sessionID}", "v2.session.delete")
    .seeded((ctx) => ctx.session({ title: "Delete session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "none"),
  http.protected
    .get("/api/session/{sessionID}/todo", "v2.session.todo")
    .seeded((ctx) => ctx.session({ title: "Todo session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/todo", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .get("/api/session/{sessionID}/diff", "v2.session.diff")
    .seeded((ctx) => ctx.session({ title: "Diff session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/diff", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .post("/api/session/{sessionID}/command", "v2.session.command")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/command", { sessionID: "ses_httpapi_missing" }),
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: { command: "missing", resume: false },
    }))
    .status(404, undefined, "status"),
  http.protected
    .post("/global/upgrade", "global.upgrade")
    .global()
    .probe({ path: "/global/upgrade", body: { target: 1 } })
    .at(() => ({ path: "/global/upgrade", body: { target: 1 } }))
    .status(400),
  ...novelScenarios(),
]

function novelDirectory(ctx: ScenarioContext) {
  if (!ctx.directory) throw new Error("novel scenarios require a project directory")
  return ctx.directory
}

function seedNovel(ctx: ScenarioContext, title = "种子小说") {
  return Effect.orDie(
    Effect.map(createNovel(novelDirectory(ctx), { title, genre: "玄幻", synopsis: "种子简介" }), (novel) => ({
      novelID: novel.id,
    })),
  )
}

function seedChapter(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const chapter = yield* createChapterEndpoint(novelID, { title: "第一章" }, novelDirectory(ctx))
      return { novelID, chapterID: chapter.id }
    }),
  )
}

function seedVersionedChapter(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedChapter(ctx)
      yield* updateChapterContent(state.novelID, state.chapterID, { content: "正文包含关键词。" }, novelDirectory(ctx))
      return state
    }),
  )
}

function seedReviewedChapter(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedChapter(ctx)
      yield* submitApproval(state.novelID, state.chapterID, { action: "approve", comment: "通过" }, novelDirectory(ctx))
      return state
    }),
  )
}

function seedCharacter(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const character = yield* createCharacter(novelID, { name: "林天" }, novelDirectory(ctx))
      return { novelID, characterID: character.id }
    }),
  )
}

function seedCharacterState(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedCharacter(ctx)
      const chapter = yield* createChapterEndpoint(state.novelID, { title: "角色状态章节" }, novelDirectory(ctx))
      const entry = yield* createCharacterStateEndpoint(
        state.novelID,
        state.characterID,
        { chapterId: chapter.id, place: "青云门" },
        novelDirectory(ctx),
      )
      return { ...state, chapterID: chapter.id, stateID: entry.id }
    }),
  )
}

function seedRelationship(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const charA = yield* createCharacter(novelID, { name: "林天" }, novelDirectory(ctx))
      const charB = yield* createCharacter(novelID, { name: "苏瑶" }, novelDirectory(ctx))
      const relationship = yield* createRelationshipEndpoint(
        novelID,
        { charAId: charA.id, charBId: charB.id, type: "道侣" },
        novelDirectory(ctx),
      )
      return { novelID, relationshipID: relationship.id }
    }),
  )
}

function seedVolume(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const volume = yield* createVolumeEndpoint(novelID, { title: "第一卷" }, novelDirectory(ctx))
      return { novelID, volumeID: volume.id }
    }),
  )
}

function seedTension(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const point = yield* createTensionPoint(novelID, { chapterNumber: 1, level: 5 }, novelDirectory(ctx))
      return { novelID, pointID: point.id }
    }),
  )
}

function seedForeshadow(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const entry = yield* createForeshadowing(novelID, { content: "神秘戒指" }, novelDirectory(ctx))
      return { novelID, entryID: entry.id }
    }),
  )
}

function seedPlotThread(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const thread = yield* createPlotThread(novelID, { title: "复仇主线" }, novelDirectory(ctx))
      return { novelID, threadID: thread.id }
    }),
  )
}

function seedActiveWorldMap(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const map = yield* Effect.promise(() =>
        createWorldMap(novelID, { status: "active", title: "演练正式地图" }, novelDirectory(ctx)),
      )
      return { novelID, mapID: map.id }
    }),
  )
}

function seedDraftWorldMap(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const map = yield* Effect.promise(() =>
        createWorldMap(novelID, { status: "draft", title: "演练草稿地图" }, novelDirectory(ctx)),
      )
      return { novelID, mapID: map.id }
    }),
  )
}

function seedWorldMapFeature(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedDraftWorldMap(ctx)
      const feature = yield* Effect.promise(() =>
        createWorldMapFeature(
          state.novelID,
          state.mapID,
          {
            kind: "region",
            name: "青云山脉",
            polygon: [
              { x: 100, y: 100 },
              { x: 900, y: 100 },
              { x: 900, y: 900 },
            ],
          },
          novelDirectory(ctx),
        ),
      )
      return { ...state, featureID: feature.id }
    }),
  )
}

function seedMapCharacter(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedWorldMapFeature(ctx)
      const character = yield* createCharacter(state.novelID, { name: "林天" }, novelDirectory(ctx))
      return { ...state, characterID: character.id }
    }),
  )
}

function seedCharacterMapPin(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedMapCharacter(ctx)
      const pin = yield* Effect.promise(() =>
        createCharacterMapPin(
          state.novelID,
          state.mapID,
          { characterId: state.characterID, x: 250, y: 350 },
          novelDirectory(ctx),
        ),
      )
      return { ...state, pinID: pin.id }
    }),
  )
}

function seedWorldEntry(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const entry = yield* createWorldEntry(novelID, { category: "势力", title: "青云门" }, novelDirectory(ctx))
      return { novelID, entryID: entry.id }
    }),
  )
}

// 1x1 透明 PNG 的 data URL，满足设定图片上传的解码校验。
const SETTING_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function seedSettingImageOwner(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const entry = yield* createWorldEntry(novelID, { category: "势力", title: "青云门" }, novelDirectory(ctx))
      return { novelID, ownerID: entry.id }
    }),
  )
}

function seedSettingImage(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedSettingImageOwner(ctx)
      const image = yield* Effect.promise(() =>
        uploadSettingImage(
          state.novelID,
          { ownerType: "world_entry", ownerId: state.ownerID, filename: "gate.png", dataUrl: SETTING_IMAGE_DATA_URL },
          novelDirectory(ctx),
        ),
      )
      return { ...state, imageID: image.id }
    }),
  )
}

// 段落批注要求 quote 与设定内容精确匹配，这里固定一段内容并据此计算偏移量。
const SETTING_ANNOTATION_CONTENT = "青云门立于青云山脉九峰之巅，三千弟子分驻各峰。"
const SETTING_ANNOTATION_QUOTE = "三千弟子"
const SETTING_ANNOTATION_SPAN = {
  paragraphIndex: 0,
  startOffset: SETTING_ANNOTATION_CONTENT.indexOf(SETTING_ANNOTATION_QUOTE),
  endOffset: SETTING_ANNOTATION_CONTENT.indexOf(SETTING_ANNOTATION_QUOTE) + SETTING_ANNOTATION_QUOTE.length,
}

function seedSettingAnnotationsEntry(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx)
      const entry = yield* createWorldEntry(
        novelID,
        { category: "势力", title: "青云门", content: SETTING_ANNOTATION_CONTENT },
        novelDirectory(ctx),
      )
      return { novelID, entryID: entry.id }
    }),
  )
}

function seedWorldEntryAnnotation(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedSettingAnnotationsEntry(ctx)
      const annotation = yield* createAnnotationEndpoint(
        state.novelID,
        {
          targetType: "world_entry",
          targetId: state.entryID,
          field: "content",
          ...SETTING_ANNOTATION_SPAN,
          quote: SETTING_ANNOTATION_QUOTE,
          comment: "三千弟子与后文人数描述不一致",
        },
        novelDirectory(ctx),
      )
      return { ...state, annotationID: annotation.id }
    }),
  )
}

function seedWorldEntryAnnotationRound(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedSettingAnnotationsEntry(ctx)
      const round = yield* createAnnotationRoundEndpoint(
        state.novelID,
        {
          targetType: "world_entry",
          targetId: state.entryID,
          annotationsSnapshot: [],
          status: "completed",
          resultSummary: "首轮整理完成，无遗留批注",
        },
        novelDirectory(ctx),
      )
      return { ...state, roundID: round.id }
    }),
  )
}

// 同一小说下同时存在章节与设定批注，用于验证按目标查询的跨目标隔离
function seedCrossTargetAnnotations(ctx: ScenarioContext) {
  return Effect.orDie(
    Effect.gen(function* () {
      const state = yield* seedWorldEntryAnnotation(ctx)
      const chapter = yield* createChapterEndpoint(state.novelID, { title: "第一章" }, novelDirectory(ctx))
      yield* updateChapterContent(
        state.novelID,
        chapter.id,
        { content: "第一段文字。\n\n第二段文字。" },
        novelDirectory(ctx),
      )
      yield* createAnnotationEndpoint(
        state.novelID,
        {
          targetType: "chapter",
          targetId: chapter.id,
          field: "content",
          paragraphIndex: 0,
          startOffset: 0,
          endOffset: 3,
          quote: "第一段",
          comment: "章节批注不应出现在设定目标查询里",
        },
        novelDirectory(ctx),
      )
      return state
    }),
  )
}

// 收件箱种子：正式条目 + 待审候选 + 未解决冲突 + 暂存草案，覆盖统一列表的三类来源
const REVIEW_INBOX_ENTRY_CONTENT = "青云门立于青云山脉九峰之巅，三千弟子分驻各峰。"

function seedReviewInbox(ctx: ScenarioContext, candidateCount = 1) {
  return Effect.orDie(
    Effect.gen(function* () {
      const { novelID } = yield* seedNovel(ctx, "收件箱小说")
      const entry = yield* createWorldEntry(
        novelID,
        { category: "势力", title: "青云门", content: REVIEW_INBOX_ENTRY_CONTENT },
        novelDirectory(ctx),
      )
      const rows = yield* Effect.try({
        try: () => {
          const db = getDb(novelDirectory(ctx))
          const pendingIDs: string[] = []
          for (let i = 0; i < candidateCount; i++) {
            const id = crypto.randomUUID()
            db.insert(PendingSettingTable)
              .values({
                id,
                novel_id: novelID,
                candidate_type: "world_entry",
                suggested_entity_id: `world_${id.slice(0, 8)}`,
                payload_json: JSON.stringify({
                  category: "势力",
                  title: "藏经阁",
                  content: "藏经阁收藏青云门历代功法典籍。",
                }),
                display_title: "藏经阁",
                importance: 2,
              })
              .run()
            pendingIDs.push(id)
          }
          const conflictID = crypto.randomUUID()
          db.insert(WorldEntryConflictTable)
            .values({
              id: conflictID,
              novel_id: novelID,
              world_entry_id: entry.id,
              conflict_kind: "semantic_conflict",
              conflict_note: "弟子人数与第三章描述不一致",
            })
            .run()
          const stagedID = crypto.randomUUID()
          db.insert(StagedChangeTable)
            .values({
              id: stagedID,
              novel_id: novelID,
              kind: "update",
              entity_type: "world_entry",
              entry_ids: JSON.stringify([entry.id]),
              before_json: JSON.stringify({ content: REVIEW_INBOX_ENTRY_CONTENT }),
              after_json: JSON.stringify({ content: `${REVIEW_INBOX_ENTRY_CONTENT}门规森严，分执法、藏经两堂。` }),
              reason: "补全门规描述",
              evidence_json: JSON.stringify({ source: "batch" }),
            })
            .run()
          return { pendingIDs, conflictID, stagedID }
        },
        catch: (error) => new Error(`收件箱种子写入失败：${String(error)}`),
      })
      return { novelID, entryID: entry.id, ...rows }
    }),
  )
}

function novelScenarios(): Scenario[] {
  const jsonHeaders = (ctx: ScenarioContext) => ({ ...ctx.headers(), "content-type": "application/json" })
  const isObject = (body: unknown) => object(body)
  const isArray = (body: unknown) => array(body)
  const isDeleted = (body: unknown) => {
    object(body)
    check((body as Record<string, unknown>).deleted === true, "delete should return deleted: true")
  }
  return [
    http.protected
      .get("/api/novel", "novel.list")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({ path: "/api/novel", headers: ctx.headers() }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/for-session/{sessionID}", "novel.for-session")
      .seeded((ctx) =>
        Effect.orDie(
          Effect.gen(function* () {
            const { novelID } = yield* seedNovel(ctx)
            const sessionID = crypto.randomUUID()
            yield* bindSession(novelID, { sessionID }, novelDirectory(ctx))
            return { sessionID }
          }),
        ),
      )
      .at((ctx) => ({
        path: route("/api/novel/for-session/{sessionID}", { sessionID: ctx.state.sessionID }),
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}", "novel.detail")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({ path: route("/api/novel/{novelID}", { novelID: ctx.state.novelID }), headers: ctx.headers() }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/chapters", "novel.chapters")
      .seeded((ctx) => seedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/chapters/{chapterID}", "novel.chapter")
      .seeded((ctx) => seedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/chapters/{chapterID}/reviews", "novel.chapter-reviews")
      .seeded((ctx) => seedReviewedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}/reviews", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/chapters/{chapterID}/versions", "novel.chapter-versions")
      .seeded((ctx) => seedVersionedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}/versions", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/characters", "novel.characters")
      .seeded((ctx) => seedCharacter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/characters", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/characters/{characterID}/states", "novel.character-states")
      .seeded((ctx) => seedCharacterState(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/characters/{characterID}/states", {
          novelID: ctx.state.novelID,
          characterID: ctx.state.characterID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/character-states", "novel.all-character-states")
      .seeded((ctx) => seedCharacterState(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/character-states", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/export", "novel.export")
      .seeded((ctx) => seedVersionedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/export", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/foreshadowing", "novel.foreshadowing")
      .seeded((ctx) => seedForeshadow(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/foreshadowing", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/outline", "novel.outline")
      .seeded((ctx) =>
        Effect.orDie(
          Effect.gen(function* () {
            const state = yield* seedNovel(ctx)
            yield* updateOutline(state.novelID, { section: "master", markdown: "# 总纲" }, novelDirectory(ctx))
            return state
          }),
        ),
      )
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/outline", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/plot-threads", "novel.plot-threads")
      .seeded((ctx) => seedPlotThread(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/plot-threads", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/relationships", "novel.relationships")
      .seeded((ctx) => seedRelationship(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/relationships", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/search", "novel.search")
      .seeded((ctx) => seedVersionedChapter(ctx))
      .at((ctx) => ({
        path: `${route("/api/novel/{novelID}/search", { novelID: ctx.state.novelID })}?q=${encodeURIComponent("关键词")}`,
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/style-guide", "novel.style-guide")
      .seeded((ctx) =>
        Effect.orDie(
          Effect.gen(function* () {
            const state = yield* seedNovel(ctx)
            yield* updateStyleGuideEndpoint(state.novelID, { tone: "热血" }, novelDirectory(ctx))
            return state
          }),
        ),
      )
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/style-guide", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/ai-artifacts", "novel.ai-artifacts")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/ai-artifacts", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/tension", "novel.tension")
      .seeded((ctx) => seedTension(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/tension", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/volumes", "novel.volumes")
      .seeded((ctx) => seedVolume(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/volumes", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .get("/api/novel/{novelID}/world-entries", "novel.world-entries")
      .seeded((ctx) => seedWorldEntry(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/world-entries", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .post("/api/novel", "novel.create")
      .at((ctx) => ({
        path: "/api/novel",
        headers: jsonHeaders(ctx),
        body: { title: "创建测试", genre: "玄幻", synopsis: "种子简介" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/bind", "novel.bind")
      .seeded((ctx) =>
        Effect.orDie(
          Effect.gen(function* () {
            const { novelID } = yield* seedNovel(ctx)
            return { novelID, sessionID: crypto.randomUUID() }
          }),
        ),
      )
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/bind", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { sessionID: ctx.state.sessionID },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/chapters", "novel.create-chapter")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { title: "第一章" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/chapters/{chapterID}/approval", "novel.approval")
      .seeded((ctx) => seedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}/approval", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: jsonHeaders(ctx),
        body: { action: "approve", comment: "通过" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/chapters/{chapterID}/rollback", "novel.rollback")
      .seeded((ctx) => seedVersionedChapter(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}/rollback", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: jsonHeaders(ctx),
        body: {},
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/characters", "novel.create-character")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/characters", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { name: "林天", role: "主角" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/characters/{characterID}/states", "novel.create-character-state")
      .seeded((ctx) =>
        Effect.orDie(
          Effect.gen(function* () {
            const state = yield* seedCharacter(ctx)
            const chapter = yield* createChapterEndpoint(state.novelID, { title: "状态章节" }, novelDirectory(ctx))
            return { ...state, chapterID: chapter.id }
          }),
        ),
      )
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/characters/{characterID}/states", {
          novelID: ctx.state.novelID,
          characterID: ctx.state.characterID,
        }),
        headers: jsonHeaders(ctx),
        body: { chapterId: ctx.state.chapterID, place: "青云门" },
      }))
      .json(200, (body, ctx) => {
        object(body)
        check(body.chapterId === ctx.state.chapterID, "character state should bind to its chapter")
      }),
    http.protected
      .post("/api/novel/{novelID}/foreshadowing", "novel.create-foreshadowing")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/foreshadowing", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { content: "神秘戒指" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/plot-threads", "novel.create-plot-thread")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/plot-threads", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { title: "复仇主线" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/relationships", "novel.create-relationship")
      .seeded((ctx) =>
        Effect.orDie(
          Effect.gen(function* () {
            const { novelID } = yield* seedNovel(ctx)
            const charA = yield* createCharacter(novelID, { name: "林天" }, novelDirectory(ctx))
            const charB = yield* createCharacter(novelID, { name: "苏瑶" }, novelDirectory(ctx))
            return { novelID, charAId: charA.id, charBId: charB.id }
          }),
        ),
      )
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/relationships", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { charAId: ctx.state.charAId, charBId: ctx.state.charBId, type: "道侣" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/tension", "novel.create-tension")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/tension", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { chapterNumber: 1, level: 5 },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/volumes", "novel.create-volume")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/volumes", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { title: "第一卷" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/world-entries", "novel.create-world-entry")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/world-entries", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { category: "势力", title: "青云门" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}", "novel.update")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { synopsis: "改后的简介" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/chapters/{chapterID}", "novel.update-chapter")
      .seeded((ctx) => seedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: jsonHeaders(ctx),
        body: { title: "第一章·改" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/chapters/{chapterID}/content", "novel.update-content")
      .seeded((ctx) => seedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}/content", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: jsonHeaders(ctx),
        body: { content: "新的正文内容。" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/chapters/{chapterID}/move", "novel.move-chapter")
      .seeded((ctx) =>
        Effect.orDie(
          Effect.gen(function* () {
            const { novelID } = yield* seedNovel(ctx)
            yield* createChapterEndpoint(novelID, { title: "第一章" }, novelDirectory(ctx))
            const second = yield* createChapterEndpoint(novelID, { title: "第二章" }, novelDirectory(ctx))
            return { novelID, chapterID: second.id }
          }),
        ),
      )
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}/move", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: jsonHeaders(ctx),
        body: { action: "up" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/chapters/{chapterID}/restore", "novel.restore-version")
      .seeded((ctx) => seedVersionedChapter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}/restore", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: jsonHeaders(ctx),
        body: { version: 1 },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/character-states/{stateID}", "novel.update-character-state")
      .seeded((ctx) => seedCharacterState(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/character-states/{stateID}", {
          novelID: ctx.state.novelID,
          stateID: ctx.state.stateID,
        }),
        headers: jsonHeaders(ctx),
        body: { place: "后山" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/characters/{characterID}", "novel.update-character")
      .seeded((ctx) => seedCharacter(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/characters/{characterID}", {
          novelID: ctx.state.novelID,
          characterID: ctx.state.characterID,
        }),
        headers: jsonHeaders(ctx),
        body: { name: "林天·改" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/foreshadowing/{entryID}", "novel.update-foreshadowing")
      .seeded((ctx) => seedForeshadow(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/foreshadowing/{entryID}", {
          novelID: ctx.state.novelID,
          entryID: ctx.state.entryID,
        }),
        headers: jsonHeaders(ctx),
        body: { content: "伏笔·改" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/outline", "novel.update-outline")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/outline", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { section: "master", markdown: "# 总纲" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/plot-threads/{threadID}", "novel.update-plot-thread")
      .seeded((ctx) => seedPlotThread(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/plot-threads/{threadID}", {
          novelID: ctx.state.novelID,
          threadID: ctx.state.threadID,
        }),
        headers: jsonHeaders(ctx),
        body: { title: "主线·改" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/relationships/{relationshipID}", "novel.update-relationship")
      .seeded((ctx) => seedRelationship(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/relationships/{relationshipID}", {
          novelID: ctx.state.novelID,
          relationshipID: ctx.state.relationshipID,
        }),
        headers: jsonHeaders(ctx),
        body: { type: "宿敌" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/style-guide", "novel.update-style-guide")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/style-guide", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { tone: "热血" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/tension/{pointID}", "novel.update-tension")
      .seeded((ctx) => seedTension(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/tension/{pointID}", {
          novelID: ctx.state.novelID,
          pointID: ctx.state.pointID,
        }),
        headers: jsonHeaders(ctx),
        body: { level: 8 },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/volumes/{volumeID}", "novel.update-volume")
      .seeded((ctx) => seedVolume(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/volumes/{volumeID}", {
          novelID: ctx.state.novelID,
          volumeID: ctx.state.volumeID,
        }),
        headers: jsonHeaders(ctx),
        body: { title: "第一卷·改" },
      }))
      .json(200, isObject),
    http.protected
      .put("/api/novel/{novelID}/world-entries/{entryID}", "novel.update-world-entry")
      .seeded((ctx) => seedWorldEntry(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/world-entries/{entryID}", {
          novelID: ctx.state.novelID,
          entryID: ctx.state.entryID,
        }),
        headers: jsonHeaders(ctx),
        body: { title: "青云门·改" },
      }))
      .json(200, isObject),
    http.protected
      .delete("/api/novel/{novelID}", "novel.delete")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({ path: route("/api/novel/{novelID}", { novelID: ctx.state.novelID }), headers: ctx.headers() }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/chapters/{chapterID}", "novel.delete-chapter")
      .seeded((ctx) => seedChapter(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/chapters/{chapterID}", {
          novelID: ctx.state.novelID,
          chapterID: ctx.state.chapterID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/character-states/{stateID}", "novel.delete-character-state")
      .seeded((ctx) => seedCharacterState(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/character-states/{stateID}", {
          novelID: ctx.state.novelID,
          stateID: ctx.state.stateID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/characters/{characterID}", "novel.delete-character")
      .seeded((ctx) => seedCharacter(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/characters/{characterID}", {
          novelID: ctx.state.novelID,
          characterID: ctx.state.characterID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/foreshadowing/{entryID}", "novel.delete-foreshadowing")
      .seeded((ctx) => seedForeshadow(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/foreshadowing/{entryID}", {
          novelID: ctx.state.novelID,
          entryID: ctx.state.entryID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/plot-threads/{threadID}", "novel.delete-plot-thread")
      .seeded((ctx) => seedPlotThread(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/plot-threads/{threadID}", {
          novelID: ctx.state.novelID,
          threadID: ctx.state.threadID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/relationships/{relationshipID}", "novel.delete-relationship")
      .seeded((ctx) => seedRelationship(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/relationships/{relationshipID}", {
          novelID: ctx.state.novelID,
          relationshipID: ctx.state.relationshipID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/tension/{pointID}", "novel.delete-tension")
      .seeded((ctx) => seedTension(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/tension/{pointID}", {
          novelID: ctx.state.novelID,
          pointID: ctx.state.pointID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/volumes/{volumeID}", "novel.delete-volume")
      .seeded((ctx) => seedVolume(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/volumes/{volumeID}", {
          novelID: ctx.state.novelID,
          volumeID: ctx.state.volumeID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .delete("/api/novel/{novelID}/world-entries/{entryID}", "novel.delete-world-entry")
      .seeded((ctx) => seedWorldEntry(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/world-entries/{entryID}", {
          novelID: ctx.state.novelID,
          entryID: ctx.state.entryID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .get("/api/novel/{novelID}/annotations", "novel.annotations")
      .seeded((ctx) => seedCrossTargetAnnotations(ctx))
      .at((ctx) => ({
        path: `${route("/api/novel/{novelID}/annotations", { novelID: ctx.state.novelID })}?targetType=world_entry&targetId=${ctx.state.entryID}`,
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        array(body)
        check(body.length === 1, "跨目标隔离：只返回设定目标下的批注")
        const item = body[0]
        check(isRecord(item) && item.targetType === "world_entry", "批注 targetType 应为 world_entry")
      }),
    http.protected
      .post("/api/novel/{novelID}/annotations", "novel.create-annotation")
      .seeded((ctx) => seedSettingAnnotationsEntry(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/annotations", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: {
          targetType: "world_entry",
          targetId: ctx.state.entryID,
          field: "content",
          ...SETTING_ANNOTATION_SPAN,
          quote: SETTING_ANNOTATION_QUOTE,
          comment: "门中弟子数与后文描述矛盾",
        },
      }))
      .json(200, isObject),
    http.protected
      .patch("/api/novel/{novelID}/annotations/{annotationID}", "novel.update-annotation")
      .seeded((ctx) => seedWorldEntryAnnotation(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/annotations/{annotationID}", {
          novelID: ctx.state.novelID,
          annotationID: ctx.state.annotationID,
        }),
        headers: jsonHeaders(ctx),
        body: { status: "resolved" },
      }))
      .json(200, isObject),
    http.protected
      .delete("/api/novel/{novelID}/annotations/{annotationID}", "novel.delete-annotation")
      .seeded((ctx) => seedWorldEntryAnnotation(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/annotations/{annotationID}", {
          novelID: ctx.state.novelID,
          annotationID: ctx.state.annotationID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .post("/api/novel/{novelID}/annotation-rounds", "novel.create-annotation-round")
      .seeded((ctx) => seedSettingAnnotationsEntry(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/annotation-rounds", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: {
          targetType: "world_entry",
          targetId: ctx.state.entryID,
          annotationsSnapshot: [],
          status: "completed",
          resultSummary: "首轮整理完成，无遗留批注",
        },
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/annotation-rounds", "novel.annotation-rounds")
      .seeded((ctx) => seedWorldEntryAnnotationRound(ctx))
      .at((ctx) => ({
        path: `${route("/api/novel/{novelID}/annotation-rounds", { novelID: ctx.state.novelID })}?targetType=world_entry&targetId=${ctx.state.entryID}`,
        headers: ctx.headers(),
      }))
      .json(200, isArray),
    http.protected
      .patch("/api/novel/{novelID}/annotation-rounds/{roundID}", "novel.update-annotation-round")
      .seeded((ctx) => seedWorldEntryAnnotationRound(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/annotation-rounds/{roundID}", {
          novelID: ctx.state.novelID,
          roundID: ctx.state.roundID,
        }),
        headers: jsonHeaders(ctx),
        body: { status: "interrupted", resultSummary: "人工中断后的收尾" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/settings-organization/analyze", "novel.settings-organization.analyze")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/settings-organization/analyze", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { scope: "all" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/settings-organization/dry-run", "novel.settings-organization.dry-run")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/settings-organization/dry-run", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { planJson: JSON.stringify({ version: 2, operations: [] }) },
      }))
      .json(200, (body) => {
        object(body)
        check((body as Record<string, unknown>).valid === true, "空整理计划的 dry-run 应通过校验")
      }),
    http.protected
      .post("/api/novel/{novelID}/settings-organization/apply", "novel.settings-organization.apply")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/settings-organization/apply", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: {
          planJson: JSON.stringify({ version: 2, operations: [] }),
          planDigest: "digest-mismatch",
          confirmed: true,
        },
      }))
      .json(200, (body) => {
        object(body)
        check((body as Record<string, unknown>).ok === false, "摘要不匹配的 apply 应被拒绝")
      }),
    http.protected
      .get("/api/novel/{novelID}/review-inbox", "novel.review-inbox.items")
      .seeded((ctx) => seedReviewInbox(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        const record = body as Record<string, unknown>
        array(record.items)
        check((record.items as unknown[]).length === 3, "收件箱应聚合候选、冲突、暂存三类条目")
        const counts = record.counts as Record<string, number>
        check(counts.candidates === 1 && counts.conflicts === 1 && counts.staged === 1, "收件箱计数应与种子一致")
      }),
    http.protected
      .get("/api/novel/{novelID}/review-inbox/counts", "novel.review-inbox.counts")
      .seeded((ctx) => seedReviewInbox(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/counts", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        const counts = body as Record<string, number>
        check(counts.candidates === 1 && counts.conflicts === 1 && counts.staged === 1, "徽标计数应与种子一致")
        check(counts.total === 3, "总数应为三类之和")
      }),
    http.protected
      .post("/api/novel/{novelID}/review-inbox/candidates/{candidateID}/accept", "novel.review-inbox.candidate-accept")
      .seeded((ctx) => seedReviewInbox(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/candidates/{candidateID}/accept", {
          novelID: ctx.state.novelID,
          candidateID: ctx.state.pendingIDs[0]!,
        }),
        headers: jsonHeaders(ctx),
        body: {},
      }))
      .json(200, (body) => {
        object(body)
        const record = body as Record<string, unknown>
        check(record.ok === true, "接受合法候选应成功")
        check(record.candidateType === "world_entry", "候选类型应透传")
        check(typeof record.createdId === "string", "入库后应返回新实体 ID")
      }),
    http.protected
      .post("/api/novel/{novelID}/review-inbox/candidates/{candidateID}/reject", "novel.review-inbox.candidate-reject")
      .seeded((ctx) => seedReviewInbox(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/candidates/{candidateID}/reject", {
          novelID: ctx.state.novelID,
          candidateID: ctx.state.pendingIDs[0]!,
        }),
        headers: ctx.headers(),
      }))
      .json(200, (body, ctx) => {
        object(body)
        const record = body as Record<string, unknown>
        check(record.ok === true, "拒绝候选应成功")
        check(record.pendingId === ctx.state.pendingIDs[0], "应回显被拒绝的候选 ID")
      }),
    http.protected
      .post("/api/novel/{novelID}/review-inbox/candidates/merge", "novel.review-inbox.candidate-merge")
      .seeded((ctx) => seedReviewInbox(ctx, 2))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/candidates/merge", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { pendingIds: ctx.state.pendingIDs },
      }))
      .json(200, (body) => {
        object(body)
        const record = body as Record<string, unknown>
        check(record.ok === true, "合并同类候选应成功")
        check(typeof record.createdId === "string", "合并后应返回新实体 ID")
      }),
    http.protected
      .post("/api/novel/{novelID}/review-inbox/conflicts/{conflictID}/resolve", "novel.review-inbox.conflict-resolve")
      .seeded((ctx) => seedReviewInbox(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/conflicts/{conflictID}/resolve", {
          novelID: ctx.state.novelID,
          conflictID: ctx.state.conflictID,
        }),
        headers: jsonHeaders(ctx),
        body: { action: "keep_current", note: "现状描述正确，忽略冲突" },
      }))
      .json(200, (body) => {
        object(body)
        const record = body as Record<string, unknown>
        check(record.ok === true, "保留现状处理冲突应成功")
        check(record.action === "keep_current", "处理方式应回显")
      }),
    http.protected
      .post("/api/novel/{novelID}/review-inbox/staged/{stagedID}/accept", "novel.review-inbox.staged-accept")
      .seeded((ctx) => seedReviewInbox(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/staged/{stagedID}/accept", {
          novelID: ctx.state.novelID,
          stagedID: ctx.state.stagedID,
        }),
        headers: jsonHeaders(ctx),
        body: {},
      }))
      .json(200, (body) => {
        object(body)
        const record = body as Record<string, unknown>
        check(record.ok === true, "接受暂存草案应通过重校验并执行")
        const execution = record.execution as Record<string, unknown>
        check(execution.ok === true, "执行结果应为成功")
      }),
    http.protected
      .post("/api/novel/{novelID}/review-inbox/staged/{stagedID}/reject", "novel.review-inbox.staged-reject")
      .seeded((ctx) => seedReviewInbox(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/staged/{stagedID}/reject", {
          novelID: ctx.state.novelID,
          stagedID: ctx.state.stagedID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, (body, ctx) => {
        object(body)
        const record = body as Record<string, unknown>
        check(record.ok === true, "拒绝暂存草案应成功")
        check(record.stagedId === ctx.state.stagedID, "应回显被拒绝的草案 ID")
      }),
    http.protected
      .post("/api/novel/{novelID}/review-inbox/batch", "novel.review-inbox.batch")
      .seeded((ctx) => seedReviewInbox(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/review-inbox/batch", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: {
          planJson: JSON.stringify({
            version: 2,
            operations: [
              {
                action: "update",
                entity_type: "world_entry",
                id: ctx.state.entryID,
                fields: { content: `${REVIEW_INBOX_ENTRY_CONTENT}\n` },
                reason: "格式整理：仅调整分段",
              },
            ],
          }),
        },
      }))
      .json(200, (body) => {
        object(body)
        const record = body as Record<string, unknown>
        check(record.ok === true, "批处理应成功拆分计划")
        check(record.autoExecuted === 1, "纯格式修订应命中白名单直接执行")
        check((record.stagedIds as unknown[]).length === 0, "白名单操作不应产生暂存草案")
      }),
    // 覆盖新增的结构评审、技法、云盘同步与全局灵魂路由。
    http.protected.get("/api/novel/mode", "v2.novelMode.get").json(200, (body) => object(body)),
    http.protected
      .put("/api/novel/mode", "v2.novelMode.set")
      .mutating()
      .at((ctx) => ({ path: "/api/novel/mode", headers: ctx.headers(), body: { writing_mode: "review" } }))
      .json(200, (body) => object(body)),
    http.protected.get("/api/novel/session-bindings", "v2.novel.session-bindings").json(200, (body) => array(body)),
    http.protected
      .get("/api/novel/{novelID}/arcs", "v2.novel.arcs")
      .at((ctx) => ({ path: route("/api/novel/{novelID}/arcs", { novelID: "nov_missing" }), headers: ctx.headers() }))
      .json(200, (body) => array(body)),
    http.protected
      .post("/api/novel/{novelID}/arcs", "v2.novel.create-arc")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/arcs", { novelID: "nov_missing" }),
        headers: ctx.headers(),
        body: {},
      }))
      .json(400, object, "status"),
    http.protected
      .put("/api/novel/{novelID}/arcs/{arcID}", "v2.novel.update-arc")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/arcs/{arcID}", { novelID: "nov_missing", arcID: "arc_missing" }),
        headers: ctx.headers(),
        body: { status: "invalid" },
      }))
      .json(400, object, "status"),
    http.protected
      .delete("/api/novel/{novelID}/arcs/{arcID}", "v2.novel.delete-arc")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/arcs/{arcID}", { novelID: "nov_missing", arcID: "arc_missing" }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(body.deleted === true, "delete should return deleted: true")
      }),
    http.protected
      .get("/api/novel/{novelID}/arcs/{arcID}/beats", "v2.novel.arc-beats")
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/arcs/{arcID}/beats", { novelID: "nov_missing", arcID: "arc_missing" }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => array(body)),
    http.protected
      .post("/api/novel/{novelID}/beats", "v2.novel.create-beat")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/beats", { novelID: "nov_missing" }),
        headers: ctx.headers(),
        body: {},
      }))
      .json(400, object, "status"),
    http.protected
      .put("/api/novel/{novelID}/beats/{beatID}", "v2.novel.update-beat")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/beats/{beatID}", { novelID: "nov_missing", beatID: "beat_missing" }),
        headers: ctx.headers(),
        body: { status: "invalid" },
      }))
      .json(400, object, "status"),
    http.protected
      .delete("/api/novel/{novelID}/beats/{beatID}", "v2.novel.delete-beat")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/beats/{beatID}", { novelID: "nov_missing", beatID: "beat_missing" }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(body.deleted === true, "delete should return deleted: true")
      }),
    http.protected
      .get("/api/novel/{novelID}/volumes/{volumeID}/reviews", "v2.novel.volume-reviews")
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/volumes/{volumeID}/reviews", {
          novelID: "nov_missing",
          volumeID: "vol_missing",
        }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => array(body)),
    http.protected
      .post("/api/novel/{novelID}/volumes/{volumeID}/reviews", "v2.novel.create-volume-review")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/volumes/{volumeID}/reviews", {
          novelID: "nov_missing",
          volumeID: "vol_missing",
        }),
        headers: ctx.headers(),
        body: {},
      }))
      .json(400, object, "status"),
    http.protected
      .get("/api/novel/{novelID}/editorial-reports", "v2.novel.editorial-reports")
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/editorial-reports", { novelID: "nov_missing" }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => array(body)),
    http.protected
      .post("/api/novel/{novelID}/editorial-reports", "v2.novel.create-editorial-report")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/editorial-reports", { novelID: "nov_missing" }),
        headers: ctx.headers(),
        body: { scopeType: 1 },
      }))
      .json(400, object, "status"),
    http.protected
      .get("/api/novel/{novelID}/canvas-layout", "v2.novel.canvas-layout")
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/canvas-layout", { novelID: "nov_missing" }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => check(body === null, "missing canvas layout should return null")),
    http.protected
      .put("/api/novel/{novelID}/canvas-layout", "v2.novel.upsert-canvas-layout")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/canvas-layout", { novelID: "nov_missing" }),
        headers: ctx.headers(),
        body: { layout: {} },
      }))
      .json(400, object, "status"),
    http.protected
      .get("/api/novel/{novelID}/structure", "v2.novel.structure")
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/structure", { novelID: "nov_missing" }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        array(body.volumes)
        array(body.chapters)
      }),
    http.protected
      .get("/api/novel/{novelID}/soul", "v2.novel.soul")
      .at((ctx) => ({ path: route("/api/novel/{novelID}/soul", { novelID: "nov_missing" }), headers: ctx.headers() }))
      .json(404, object, "status"),
    http.protected
      .put("/api/novel/{novelID}/soul", "v2.novel.update-soul")
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/soul", { novelID: "nov_missing" }),
        headers: ctx.headers(),
        body: { content: "缺失小说灵魂" },
      }))
      .json(404, object, "status"),
    http.protected
      .get("/api/novel/{novelID}/maps/active", "v2.novel.active-world-map")
      .seeded((ctx) => seedActiveWorldMap(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/active", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        object(body.map)
        check(body.map.status === "active", "active map should be returned")
        array(body.features)
        array(body.pins)
      }),
    http.protected
      .get("/api/novel/{novelID}/maps/draft", "v2.novel.draft-world-map")
      .seeded((ctx) => seedDraftWorldMap(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/draft", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        object(body.map)
        check(body.map.status === "draft", "draft map should be returned")
        array(body.features)
        array(body.pins)
      }),
    http.protected
      .post("/api/novel/{novelID}/maps", "v2.novel.create-world-map")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { title: "新建地图", description: "路由演练地图", status: "draft" },
      }))
      .json(200, (body) => {
        object(body)
        check(body.title === "新建地图", "created map should return the input title")
        check(body.status === "draft", "created map should be a draft")
      }),
    http.protected
      .patch("/api/novel/{novelID}/maps/{mapID}", "v2.novel.update-world-map")
      .seeded((ctx) => seedDraftWorldMap(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}", { novelID: ctx.state.novelID, mapID: ctx.state.mapID }),
        headers: jsonHeaders(ctx),
        body: { title: "更新后的地图", description: "路由演练更新" },
      }))
      .json(200, (body) => {
        object(body)
        check(body.title === "更新后的地图", "map update should return the new title")
      }),
    http.protected
      .delete("/api/novel/{novelID}/maps/{mapID}", "v2.novel.delete-world-map")
      .seeded((ctx) => seedDraftWorldMap(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}", { novelID: ctx.state.novelID, mapID: ctx.state.mapID }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .post("/api/novel/{novelID}/maps/{mapID}/promote", "v2.novel.promote-world-map")
      .seeded((ctx) => seedDraftWorldMap(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}/promote", {
          novelID: ctx.state.novelID,
          mapID: ctx.state.mapID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(body.status === "active", "promoted draft should become active")
      }),
    http.protected
      .post("/api/novel/{novelID}/maps/{mapID}/features", "v2.novel.create-world-map-feature")
      .seeded((ctx) => seedDraftWorldMap(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}/features", {
          novelID: ctx.state.novelID,
          mapID: ctx.state.mapID,
        }),
        headers: jsonHeaders(ctx),
        body: {
          kind: "region",
          name: "青云山脉",
          polygon: [
            { x: 100, y: 100 },
            { x: 900, y: 100 },
            { x: 900, y: 900 },
          ],
        },
      }))
      .json(200, (body) => {
        object(body)
        check(body.kind === "region", `created map feature kind got ${JSON.stringify(body)}`)
        check(body.name === "青云山脉", "created map feature should return its name")
        array(body.polygon)
        check(body.polygon.length === 3, "created region should return its polygon")
      }),
    http.protected
      .patch("/api/novel/{novelID}/maps/{mapID}/features/{featureID}", "v2.novel.update-world-map-feature")
      .seeded((ctx) => seedWorldMapFeature(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}/features/{featureID}", {
          novelID: ctx.state.novelID,
          mapID: ctx.state.mapID,
          featureID: ctx.state.featureID,
        }),
        headers: jsonHeaders(ctx),
        body: {
          name: "更新后的区域",
          polygon: [
            { x: 200, y: 200 },
            { x: 800, y: 200 },
            { x: 800, y: 800 },
          ],
        },
      }))
      .json(200, (body) => {
        object(body)
        check(body.name === "更新后的区域", "map feature update should return the new name")
      }),
    http.protected
      .delete("/api/novel/{novelID}/maps/{mapID}/features/{featureID}", "v2.novel.delete-world-map-feature")
      .seeded((ctx) => seedWorldMapFeature(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}/features/{featureID}", {
          novelID: ctx.state.novelID,
          mapID: ctx.state.mapID,
          featureID: ctx.state.featureID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .post("/api/novel/{novelID}/maps/{mapID}/pins", "v2.novel.create-character-map-pin")
      .seeded((ctx) => seedMapCharacter(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}/pins", { novelID: ctx.state.novelID, mapID: ctx.state.mapID }),
        headers: jsonHeaders(ctx),
        body: { characterId: ctx.state.characterID, featureId: ctx.state.featureID, x: 500, y: 700 },
      }))
      .json(200, (body, ctx) => {
        object(body)
        check(body.characterId === ctx.state.characterID, "created pin should reference the character")
        check(body.x === 500 && body.y === 700, "created pin should return its coordinates")
      }),
    http.protected
      .patch("/api/novel/{novelID}/maps/{mapID}/pins/{pinID}", "v2.novel.update-character-map-pin")
      .seeded((ctx) => seedCharacterMapPin(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}/pins/{pinID}", {
          novelID: ctx.state.novelID,
          mapID: ctx.state.mapID,
          pinID: ctx.state.pinID,
        }),
        headers: jsonHeaders(ctx),
        body: { x: 1500, y: 1200 },
      }))
      .json(200, (body) => {
        object(body)
        check(body.x === 1500 && body.y === 1200, "pin update should return the new coordinates")
      }),
    http.protected
      .delete("/api/novel/{novelID}/maps/{mapID}/pins/{pinID}", "v2.novel.delete-character-map-pin")
      .seeded((ctx) => seedCharacterMapPin(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/maps/{mapID}/pins/{pinID}", {
          novelID: ctx.state.novelID,
          mapID: ctx.state.mapID,
          pinID: ctx.state.pinID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .get("/api/novel/{novelID}/sync-status", "v2.novel.sync-status")
      .at((ctx) => ({ path: route("/api/novel/{novelID}/sync-status", { novelID: "nov_missing" }), headers: ctx.headers() }))
      .json(404, object, "status"),
    http.protected
      .post("/api/novel/{novelID}/sync/retry", "v2.novel.sync-retry")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/sync/retry", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { entryIds: [] },
      }))
      .json(200, (body) => {
        object(body)
        check(body.retried === 0 && body.unchanged === 0, "empty retry should report zero counts")
      }),
    http.protected
      .get("/api/novel/{novelID}/upgrade/status", "v2.novel.upgrade-status")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/upgrade/status", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body: any) => {
        object(body)
        const b = body as Record<string, any>
        check(Array.isArray(b.tasks), "upgrade status should return a task list")
        check(typeof b.estimate?.deterministicTasks === "number", "estimate should count deterministic tasks")
        check(typeof b.estimate?.aiChapters === "number", "estimate should count AI chapters")
        check(b.gate === "open" || b.gate === "paused", "gate should be open or paused")
      }),
    http.protected
      .get("/api/novel/{novelID}/upgrade/status", "v2.novel.upgrade-status")
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/upgrade/status", { novelID: "nov_missing" }),
        headers: ctx.headers(),
      }))
      .json(404, object, "status"),
    http.protected
      .post("/api/novel/{novelID}/upgrade/start", "v2.novel.upgrade-start")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/upgrade/start", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body: any) => {
        object(body)
        const b = body as Record<string, any>
        object(b.phase1)
        check(typeof b.phase1.fingerprints === "number", "phase1 should report fingerprint baselines")
        check(typeof b.queuedChapters === "number", "start should report queued chapters")
      }),
    http.protected
      .get("/api/novel/{novelID}/upgrade/progress", "v2.novel.upgrade-progress")
      .seeded((ctx) => seedNovel(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/upgrade/progress", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body: any) => {
        object(body)
        const b = body as Record<string, any>
        check(typeof b.synced === "number" && typeof b.pending === "number", "progress should aggregate by status")
        check(Array.isArray(b.failures), "progress should list failures")
      }),
    http.protected
      .post("/api/novel/{novelID}/upgrade/pause", "v2.novel.upgrade-pause")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/upgrade/pause", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(body.gate === "paused", "pause should set gate to paused")
      }),
    http.protected
      .post("/api/novel/{novelID}/upgrade/resume", "v2.novel.upgrade-resume")
      .seeded((ctx) => seedNovel(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/upgrade/resume", { novelID: ctx.state.novelID }),
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(body.gate === "open", "resume should set gate to open")
      }),
    http.protected
      .put("/api/novel/{novelID}/book-meta", "v2.novel.save-book-meta")
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/book-meta", { novelID: "nov_missing" }),
        headers: ctx.headers(),
        body: { title: "HttpApi 联合保存", synopsis: "覆盖 save-book-meta 端点" },
      }))
      .json(404, object, "status"),
    http.protected.get("/api/techniques", "v2.technique.list").json(200, (body) => array(body)),
    http.protected
      .post("/api/techniques", "v2.technique.create")
      .mutating()
      .at((ctx) => ({
        path: "/api/techniques",
        headers: ctx.headers(),
        body: { name: "httpapi 技法", instruction: "用于路由演练" },
      }))
      .json(200, (body) => object(body)),
    http.protected.get("/api/techniques/config", "v2.technique.config.get").json(200, (body) => object(body)),
    http.protected
      .put("/api/techniques/config", "v2.technique.config.set")
      .mutating()
      .at((ctx) => ({ path: "/api/techniques/config", headers: ctx.headers(), body: { enabled: true } }))
      .json(200, (body) => object(body)),
    http.protected
      .get("/api/techniques/{techniqueID}", "v2.technique.detail")
      .at((ctx) => ({
        path: route("/api/techniques/{techniqueID}", { techniqueID: "tec_missing" }),
        headers: ctx.headers(),
      }))
      .json(404, object, "status"),
    http.protected
      .put("/api/techniques/{techniqueID}", "v2.technique.update")
      .mutating()
      .at((ctx) => ({
        path: route("/api/techniques/{techniqueID}", { techniqueID: "tec_missing" }),
        headers: ctx.headers(),
        body: { instruction: "缺失技法" },
      }))
      .json(404, object, "status"),
    http.protected
      .delete("/api/techniques/{techniqueID}", "v2.technique.delete")
      .mutating()
      .at((ctx) => ({
        path: route("/api/techniques/{techniqueID}", { techniqueID: "tec_missing" }),
        headers: ctx.headers(),
      }))
      .json(404, object, "status"),
    http.protected
      .get("/api/soul/global", "v2.soul.global")
      .global()
      .json(200, (body) => object(body)),
    http.protected
      .put("/api/soul/global", "v2.soul.update-global")
      .global()
      .mutating()
      .at((ctx) => ({ path: "/api/soul/global", headers: ctx.headers(), body: { content: "演练全局灵魂" } }))
      .json(200, (body) => object(body)),
    http.protected
      .post("/api/novel/{novelID}/setting-images", "v2.novel.setting-images.upload")
      .seeded((ctx) => seedSettingImageOwner(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/setting-images", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: {
          ownerType: "world_entry",
          ownerId: ctx.state.ownerID,
          filename: "gate.png",
          dataUrl: SETTING_IMAGE_DATA_URL,
        },
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/setting-images", "v2.novel.setting-images.image-list")
      .seeded((ctx) => seedSettingImage(ctx))
      .at((ctx) => ({
        path: `${route("/api/novel/{novelID}/setting-images", { novelID: ctx.state.novelID })}?${new URLSearchParams({ ownerType: "world_entry", ownerId: ctx.state.ownerID })}`,
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .get("/api/novel/{novelID}/setting-images/{imageID}", "v2.novel.setting-images.read")
      .seeded((ctx) => seedSettingImage(ctx))
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/setting-images/{imageID}", {
          novelID: ctx.state.novelID,
          imageID: ctx.state.imageID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isObject),
    http.protected
      .patch("/api/novel/{novelID}/setting-images/{imageID}", "v2.novel.setting-images.update-note")
      .seeded((ctx) => seedSettingImage(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/setting-images/{imageID}", {
          novelID: ctx.state.novelID,
          imageID: ctx.state.imageID,
        }),
        headers: jsonHeaders(ctx),
        body: { note: "山门正景" },
      }))
      .json(200, isObject),
    http.protected
      .post("/api/novel/{novelID}/setting-images/reorder", "v2.novel.setting-images.reorder")
      .seeded((ctx) => seedSettingImage(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/setting-images/reorder", { novelID: ctx.state.novelID }),
        headers: jsonHeaders(ctx),
        body: { ownerType: "world_entry", ownerId: ctx.state.ownerID, orderedIds: [ctx.state.imageID] },
      }))
      .json(200, isObject),
    http.protected
      .delete("/api/novel/{novelID}/setting-images/{imageID}", "v2.novel.setting-images.remove")
      .seeded((ctx) => seedSettingImage(ctx))
      .mutating()
      .at((ctx) => ({
        path: route("/api/novel/{novelID}/setting-images/{imageID}", {
          novelID: ctx.state.novelID,
          imageID: ctx.state.imageID,
        }),
        headers: ctx.headers(),
      }))
      .json(200, isDeleted),
    http.protected
      .get("/api/sync/status", "v2.sync.status")
      .global()
      .json(200, (body) => object(body)),
    http.protected
      .post("/api/sync/connection/test", "v2.sync.connection.test")
      .global()
      .at((ctx) => ({
        path: "/api/sync/connection/test",
        headers: ctx.headers(),
        body: { url: "http://127.0.0.1:9/dav", username: "httpapi", password: "httpapi" },
      }))
      .json(200, (body) => object(body)),
    http.protected
      .put("/api/sync/connection", "v2.sync.connection.save")
      .global()
      .mutating()
      .at((ctx) => ({
        path: "/api/sync/connection",
        headers: ctx.headers(),
        body: { url: "http://127.0.0.1:9/dav", username: "httpapi", password: "httpapi" },
      }))
      .json(400, object, "status"),
    http.protected
      .delete("/api/sync/connection", "v2.sync.connection.remove")
      .global()
      .mutating()
      .json(200, (body) => object(body)),
    http.protected
      .put("/api/sync/root", "v2.sync.root.set")
      .global()
      .mutating()
      .at((ctx) => ({
        path: "/api/sync/root",
        headers: ctx.headers(),
        body: { rootDir: "Z:/missing-opennovel-sync-root" },
      }))
      .json(400, object, "status"),
    http.protected.post("/api/sync/run", "v2.sync.run").global().mutating().json(400, object, "status"),
    http.protected
      .post("/api/sync/resolve", "v2.sync.resolve")
      .global()
      .mutating()
      .at((ctx) => ({
        path: "/api/sync/resolve",
        headers: ctx.headers(),
        body: { name: "missing-project", action: "skip" },
      }))
      .json(400, object, "status"),
  ]
}

const main = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.promise(() => disposeApps()).pipe(Effect.andThen(cleanupExercisePaths)))
  const options = parseOptions(Bun.argv.slice(2))
  const modules = yield* Effect.promise(() => runtime())
  const effectRoutes = routeKeys(OpenApi.fromApi(modules.PublicApi))
  const selected = selectedScenarios(options, scenarios)
  const missing = effectRoutes.filter((route) => !scenarios.some((scenario) => route === routeKey(scenario)))
  const extra = scenarios.filter((scenario) => !effectRoutes.includes(routeKey(scenario)))

  printHeader(options, effectRoutes, selected, missing, extra, {
    database: exerciseDatabasePath,
    global: exerciseGlobalRoot,
  })

  const results =
    options.mode === "coverage"
      ? selected.map(coverageResult)
      : yield* Effect.forEach(
          selected,
          (scenario) =>
            Effect.gen(function* () {
              if (options.progress) console.log(`${color.dim}RUN ${routeKey(scenario)} ${scenario.name}${color.reset}`)
              return yield* runScenario(options)(scenario)
            }),
          { concurrency: 1 },
        )
  printResults(results, missing, extra)

  if (results.some((result) => result.status === "fail"))
    return yield* Effect.fail(new Error("one or more scenarios failed"))
  if (options.failOnSkip && results.some((result) => result.status === "skip"))
    return yield* Effect.fail(new Error("one or more scenarios are skipped"))
  if (options.failOnMissing && missing.length > 0)
    return yield* Effect.fail(new Error("one or more routes have no scenario"))
  return undefined
})

Effect.runPromise(main.pipe(Effect.scoped)).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`${color.red}${message(error)}${color.reset}`)
    process.exit(1)
  },
)
