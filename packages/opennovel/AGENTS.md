# packages/opennovel — Main Application & CLI Entry

## Purpose

The main application package (published as `opennovel`, bin `opennovel`). Hosts the
session runtime, agent/tool orchestration, provider integration, plugin loading, and
the HTTP server bootstrap. Both the TUI and the `serve` command start from
`src/index.ts`; the Web UI (`packages/app`) connects to the server this package runs.

## Dependencies

- `@opennovel-ai/core` — business logic, database, file system, permissions.
- `@opennovel-ai/server` — Hono `HttpApi` used by `serve` mode.
- `@opennovel-ai/tui` — terminal UI used by interactive mode.
- `@opennovel-ai/plugin` — plugin SDK types plus the built-in novel-writer plugin.
- `@opennovel-ai/llm` — native route-based LLM runtime (alternative to AI SDK).
- `@opennovel-ai/protocol`, `@opennovel-ai/schema`, `@opennovel-ai/sdk` — wire contracts.
- AI SDK providers (`@ai-sdk/*`) — default provider integration path.

## Source Layout

- `src/index.ts` — CLI entrypoint (interactive TUI / `serve` / run command).
- `src/session/` — session runtime: prompt admission, provider turns, `session/llm/*`
  adapters that choose between AI SDK and the native `@opennovel-ai/llm` route runtime.
- `src/agent/`, `src/command/`, `src/skill/` — agent definitions, slash commands, skills.
- `src/tool/` — built-in tool implementations and the tool registry.
- `src/provider/`, `src/auth/`, `src/account/` — provider catalog, auth, accounts.
- `src/plugin/` — plugin loading and lifecycle (hooks, tools, permissions).
- `src/server/` — server bootstrap wiring around `@opennovel-ai/server`.
- `src/config/` — config loading; new config modules follow the self-export pattern
  (e.g. `export * as ConfigAgent from "./agent"`).
- `src/storage/` — database access; the `#db` import resolves to `db.bun.ts` under Bun
  and `db.node.ts` under Node (see `package.json` `imports`). The Drizzle schema and
  migrations themselves live in `packages/core` (`src/**/*.sql.ts`).
- `src/mcp/`, `src/lsp/`, `src/snapshot/`, `src/worktree/`, `src/git/`, `src/patch/` —
  integration subsystems.

## Conventions

### Module shape

Do not use `export namespace Foo { ... }` for module organization. It is not
standard ESM, it prevents tree-shaking, and it breaks Node's native TypeScript
runner. Use flat top-level exports combined with a self-reexport at the bottom
of the file:

```ts
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@opennovel/Foo") {}
export const layer = Layer.effect(Service, ...)
export const defaultLayer = layer.pipe(...)

export * as Foo from "./foo"
```

Consumers import the namespace projection:

```ts
import { Foo } from "@/foo/foo"

yield * Foo.Service
Foo.layer
```

Namespace-private helpers stay as non-exported top-level declarations in the
same file — they remain inaccessible to consumers (they are not projected by
`export * as`) but are usable by the file's own code.

- If the module is `foo/index.ts` (single-namespace directory), use `"."` for
  the self-reexport source rather than `"./index"`.
- For directories with several independent modules (e.g. `src/session/`,
  `src/config/`), keep each sibling as its own file with its own self-reexport,
  and do not add a barrel `index.ts`. Barrels in multi-sibling directories force
  every import through the barrel to evaluate every sibling, which defeats
  tree-shaking and slows module load.

### Effect rules

Use these rules when writing or migrating Effect code.
See `specs/effect/migration.md` for the compact pattern reference and examples.

- Use `Effect.gen(function* () { ... })` for composition.
- Use `Effect.fn("Domain.method")` for named/traced effects and `Effect.fnUntraced` for internal helpers.
- `Effect.fn` / `Effect.fnUntraced` accept pipeable operators as extra arguments, so avoid unnecessary outer `.pipe()` wrappers.
- Use `Effect.callback` for callback-based APIs.
- Use `Effect.void` instead of `Effect.succeed(undefined)` or `Effect.succeed(void 0)`.
- Prefer `DateTime.nowAsDate` over `new Date(yield* Clock.currentTimeMillis)` when you need a `Date`.
- Use `Schema.Class` for multi-field data; branded schemas (`Schema.brand`) for single-value types.
- Use `Schema.TaggedErrorClass` for typed errors; `Schema.Defect` instead of `unknown` for defect-like causes.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)` over `yield* Effect.fail(new MyError(...))`.

### Runtime vs InstanceState

- Use `makeRuntime` (from `src/effect/run-service.ts`) for all services. It returns `{ runPromise, runFork, runCallback }` backed by a shared `memoMap` that deduplicates layers.
- Use `InstanceState` (from `src/effect/instance-state.ts`) for per-directory or per-project state that needs per-instance cleanup. It uses `ScopedCache` keyed by directory — each open project gets its own state, automatically cleaned up on disposal.
- If two open directories should not share one copy of the service, it needs `InstanceState`.
- Do the work directly in the `InstanceState.make` closure — `ScopedCache` handles run-once semantics. Don't add fibers, `ensure()` callbacks, or `started` flags on top.
- Use `Effect.addFinalizer` or `Effect.acquireRelease` inside the `InstanceState.make` closure for cleanup (subscriptions, process teardown, etc.).
- Use `Effect.forkScoped` inside the closure for background stream consumers — the fiber is interrupted when the instance is disposed.
- To make a service's `init()` non-blocking, fork `InstanceState.get(state)` at the `init()` call site (e.g. `Effect.forkIn(scope)`), not by forking work inside the `InstanceState.make` closure. Forking inside the closure leaves state incomplete for other methods that read it.
- `src/project/bootstrap.ts` already wraps every service `init()` in `Effect.forkDetach`, so `init()` is fire-and-forget in production. Keep `init()` methods synchronous internally; the caller controls concurrency.

### Effect v4 beta API

- `Effect.fork` and `Effect.forkDaemon` do not exist. Use `Effect.forkIn(scope)` to fork a fiber into a specific scope.

### Preferred Effect services

- In effectified services, prefer yielding existing Effect services over dropping down to ad hoc platform APIs.
- Prefer `FileSystem.FileSystem` instead of raw `fs/promises` for effectful file I/O.
- Prefer `ChildProcessSpawner.ChildProcessSpawner` with `ChildProcess.make(...)` instead of custom process wrappers.
- Prefer `HttpClient.HttpClient` instead of raw `fetch`.
- Prefer `Path.Path`, `Config`, `Clock`, and `DateTime` when those concerns are already inside Effect code.
- For background loops or scheduled tasks, use `Effect.repeat` or `Effect.schedule` with `Effect.forkScoped` in the layer definition.
- Use `Effect.cached` when multiple concurrent callers should share a single in-flight computation rather than storing `Fiber | undefined` or `Promise | undefined` manually. See `specs/effect/migration.md` for the full pattern.

### Callback boundaries

Use `EffectBridge` for native or external callbacks (`@parcel/watcher`, `node-pty`, native `fs.watch`, plugin callbacks, etc.) that need to re-enter Effect services with instance/workspace context. Plain async code should pass explicit context or stay inside an Effect fiber; do not add ambient instance context shims.

## Pitfalls

- `bun dev` in this package starts the live interactive TUI. Do not run it as a
  blocking foreground command when you need to inspect the result; run the
  process in the background instead.
- For Web UI work, start the backend in server mode and the app dev server
  separately:
  - Backend (from `packages/opennovel`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
  - App (from `packages/app`): `bun dev -- --port 4444` → open `http://localhost:4444`
- The `#db` import is runtime-conditional. Do not import `db.bun.ts` /
  `db.node.ts` directly; always import `#db` so the Electron sidecar (Node) and
  the Bun server resolve the correct driver.

## Build & Verify

```bash
bun typecheck      # tsgo --noEmit from packages/opennovel
bun test           # run tests from this package dir (never from repo root)
bun run test:httpapi  # HttpApi exercise suite (coverage/auth/effect modes)
bun run build      # production build via script/build.ts
```

Never run `tsc` directly.
